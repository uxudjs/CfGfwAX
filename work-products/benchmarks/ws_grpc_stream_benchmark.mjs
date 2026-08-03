import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { arch, cpus, platform } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIB = 1024;
const DEFAULT_TOTAL_BYTES = 1024 * KIB;
const DEFAULT_WARMUP = 2;
const DEFAULT_ROUNDS = 7;
const CPU_CV_LIMIT = 0.10;
const CPU_TREND_LIMIT = 0.10;
const TARGET_SAMPLE_CPU_MS = 2000;
const MIN_SAMPLE_CPU_MS = 1500;
const MAX_SAMPLE_CPU_MS = 3500;
const CALIBRATION_CORRECTION_FLOOR_CPU_MS = 100;
const CALIBRATION_GROWTH_FACTOR = 4;
const CALIBRATION_SAMPLES_PER_STAGE = 3;
const MAX_CALIBRATION_STAGES = 12;
const MAX_CALIBRATION_ITERATIONS = 1024 * 1024;
const STEADY_MIN_ROUNDS = 12;
const STEADY_MAX_ROUNDS = 24;
const STEADY_WINDOW_SIZE = 5;
const STEADY_WINDOWS_REQUIRED = 3;
const FORMAL_WINDOW_SIZE = 7;
const FORMAL_MAX_ROUNDS = 14;
const MAX_RECALIBRATIONS = 2;
export const PROFILE_TIMEOUT_MS = 15 * 60 * 1000;
const CHILD_RUN_TIMEOUT_MS = 45 * 60 * 1000;
const PARENT_RUN_TIMEOUT_MS = 95 * 60 * 1000;
const CHILD_KILL_GRACE_MS = 5000;
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024 * 1024;
const METRIC_DEFINITION_VERSION = 1;
const WORKER_METRIC_PROBE_KEY = '__cfgfwaxWsGrpcMetricProbe';
const UUID = '11111111-1111-4111-8111-111111111111';
const CHUNK_SIZES = [64, 256, KIB, 16 * KIB, 64 * KIB];
const workerModuleCache = new Map();

export const PROFILE_MATRIX = Object.freeze([
	...['ws', 'grpc'].flatMap(protocol => ['upload', 'download', 'bidirectional'].flatMap(direction => CHUNK_SIZES.map(chunkBytes => ({
		id: `${protocol}-${direction}-${chunkBytes < KIB ? `${chunkBytes}b` : `${chunkBytes / KIB}kib`}`,
		protocol,
		direction,
		chunkBytes,
		variant: 'stream',
	})))),
	{ id: 'grpc-upload-fragmented-64b', protocol: 'grpc', direction: 'upload', chunkBytes: 64, variant: 'fragmented' },
	{ id: 'grpc-upload-multiframe-256b', protocol: 'grpc', direction: 'upload', chunkBytes: 256, variant: 'multiframe' },
]);
export const PROFILE_MANIFEST = Object.freeze(PROFILE_MATRIX.map(
	({ id, protocol, direction, chunkBytes, variant }) => Object.freeze({ id, protocol, direction, chunkBytes, variant }),
));


const ids = (...values) => values.flatMap(value => PROFILE_MATRIX.filter(profile => value(profile)).map(profile => profile.id));
const protocolDirectionLarge = (protocol, directions) => ids(profile => profile.protocol === protocol
	&& directions.includes(profile.direction)
	&& profile.variant === 'stream'
	&& profile.chunkBytes >= KIB);
const protocolDirectionAll = (protocol, directions) => ids(profile => profile.protocol === protocol && directions.includes(profile.direction));

export const CANDIDATE_MATRIX = Object.freeze([
	{
		id: 'grpc-parser',
		primary: 'grpc-upload-fragmented-64b',
		supporting: 'grpc-upload-multiframe-256b',
		nonTargets: [...protocolDirectionLarge('grpc', ['upload', 'bidirectional']), ...protocolDirectionAll('grpc', ['download'])],
		probePattern: /function\s+创建GRPC增量帧解析器\s*\([^)]*\)\s*\{/,
		instrument(match, counter) { return `${match}\n\t${counter};` },
	},
	{
		id: 'grpc-uplink-watermark',
		primary: 'grpc-bidirectional-64b',
		supporting: 'grpc-upload-64b',
		nonTargets: [...protocolDirectionLarge('grpc', ['upload', 'bidirectional']), ...protocolDirectionAll('grpc', ['download'])],
		probePattern: /GRPC上行写入队列\.写入\(payload(?:,\s*[^)]*)?\)/,
		instrument(match, counter) { return `(${counter}, ${match})` },
	},
	{
		id: 'grpc-buffer-reuse',
		primary: 'grpc-bidirectional-64b',
		supporting: 'grpc-download-64b',
		nonTargets: [...protocolDirectionLarge('grpc', ['download', 'bidirectional']), ...protocolDirectionAll('grpc', ['upload'])],
		probePattern: /grpcBridge\.发送后可复用缓冲\s*=\s*true/,
		instrument(match, counter) { return `(${counter}, ${match})` },
	},
	{
		id: 'ws-uplink-watermark',
		primary: 'ws-bidirectional-64b',
		supporting: 'ws-upload-64b',
		nonTargets: [...protocolDirectionLarge('ws', ['upload', 'bidirectional']), ...protocolDirectionAll('ws', ['download'])],
		probePattern: /WS上行写入队列\.写入\(payload(?:,\s*[^)]*)?\)/,
		instrument(match, counter) { return `(${counter}, ${match})` },
	},
]);

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function positiveInteger(value, name) {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
	return parsed;
}

export async function calibrateMeasurementIterations(measure, {
	targetCpuMs = TARGET_SAMPLE_CPU_MS,
	minCpuMs = MIN_SAMPLE_CPU_MS,
	maxCpuMs = MAX_SAMPLE_CPU_MS,
	correctionFloorCpuMs = CALIBRATION_CORRECTION_FLOOR_CPU_MS,
	growthFactor = CALIBRATION_GROWTH_FACTOR,
	maxStages = MAX_CALIBRATION_STAGES,
	maxIterations = MAX_CALIBRATION_ITERATIONS,
	samplesPerStage = CALIBRATION_SAMPLES_PER_STAGE,
} = {}) {
	let iterations = 1;
	const trace = [];
	const visited = new Set();
	for (let stage = 0; stage < maxStages; stage++) {
		const samples = [];
		for (let sampleIndex = 0; sampleIndex < samplesPerStage; sampleIndex++) {
			const { cpuTotalMs, wallTotalMs } = await measure(iterations);
			samples.push({ cpuTotalMs, wallTotalMs });
		}
		const cpuMedianMs = median(samples.map(sample => sample.cpuTotalMs));
		const wallMedianMs = median(samples.map(sample => sample.wallTotalMs));
		const entry = { stage, iterations, samples, cpuMedianMs, wallMedianMs, decision: '' };
		trace.push(entry);
		visited.add(iterations);
		const step = calculateCalibrationStep(cpuMedianMs, iterations, visited, {
			targetCpuMs,
			minCpuMs,
			maxCpuMs,
			correctionFloorCpuMs,
			growthFactor,
			maxIterations,
		});
		entry.decision = stage === maxStages - 1 && !step.terminal ? 'limited' : step.decision;
		if (entry.decision === 'ready') return { status: 'ready', selectedIterations: iterations, trace };
		if (entry.decision === 'limited') return { status: 'limited', selectedIterations: iterations, trace };
		iterations = step.nextIterations;
	}
	return { status: 'limited', selectedIterations: trace.at(-1)?.iterations || iterations, trace };
}

function calculateCalibrationStep(cpuMedianMs, iterations, visited, {
	targetCpuMs = TARGET_SAMPLE_CPU_MS,
	minCpuMs = MIN_SAMPLE_CPU_MS,
	maxCpuMs = MAX_SAMPLE_CPU_MS,
	correctionFloorCpuMs = CALIBRATION_CORRECTION_FLOOR_CPU_MS,
	growthFactor = CALIBRATION_GROWTH_FACTOR,
	maxIterations = MAX_CALIBRATION_ITERATIONS,
} = {}) {
	if (cpuMedianMs >= minCpuMs && cpuMedianMs <= maxCpuMs) return { decision: 'ready', nextIterations: null, terminal: true };
	const decision = cpuMedianMs < minCpuMs && cpuMedianMs < correctionFloorCpuMs ? 'grow' : 'scale';
	const proposedIterations = decision === 'grow'
		? iterations * growthFactor
		: Math.round(iterations * targetCpuMs / Math.max(cpuMedianMs, 0.001));
	const nextIterations = Math.max(1, Math.min(maxIterations, proposedIterations));
	if (nextIterations === iterations || visited.has(nextIterations)) return { decision: 'limited', nextIterations: null, terminal: true };
	return { decision, nextIterations, terminal: false };
}

export async function withTimeout(label, timeoutMs, operation) {
	const controller = new AbortController();
	let timer;
	let timedOut = false;
	const operationPromise = Promise.resolve().then(() => operation(controller.signal));
	try {
		return await Promise.race([
			operationPromise,
			new Promise((_, reject) => {
				timer = setTimeout(() => {
					timedOut = true;
					controller.abort();
					reject(new Error(`${label} timed out after ${timeoutMs} ms`));
				}, timeoutMs);
			}),
		]);
	} catch (error) {
		if (timedOut) {
			try { await operationPromise }
			catch (_) { }
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

export function parseBenchmarkOptions(argv) {
	const options = {
		profile: 'all',
		totalBytes: DEFAULT_TOTAL_BYTES,
		warmup: DEFAULT_WARMUP,
		rounds: DEFAULT_ROUNDS,
		runs: 2,
		candidate: null,
		phase: null,
		output: null,
		evidence: null,
		workerSource: null,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === '--help') {
			options.help = true;
			continue;
		}
		if (flag === '--calibrate') throw new Error('Unknown option: --calibrate');
		const value = argv[++i];
		if (value === undefined) throw new Error(`Missing value for ${flag}`);
		if (flag === '--profile') options.profile = value;
		else if (flag === '--total-bytes') options.totalBytes = positiveInteger(value, '--total-bytes');
		else if (flag === '--warmup') options.warmup = positiveInteger(value, '--warmup');
		else if (flag === '--rounds') options.rounds = positiveInteger(value, '--rounds');
		else if (flag === '--runs') options.runs = positiveInteger(value, '--runs');
		else if (flag === '--candidate') options.candidate = value;
		else if (flag === '--phase') options.phase = value;
		else if (flag === '--output') options.output = value;
		else if (flag === '--evidence') options.evidence = value;
		else if (flag === '--worker-source') options.workerSource = value;
		else throw new Error(`Unknown option: ${flag}`);
	}
	if (options.runs !== 2) throw new Error('--runs must be 2');
	if (options.profile !== 'all' && !PROFILE_MATRIX.some(profile => profile.id === options.profile)) throw new Error(`Unknown profile: ${options.profile}`);
	if (options.candidate && !CANDIDATE_MATRIX.some(candidate => candidate.id === options.candidate)) throw new Error(`Unknown candidate: ${options.candidate}`);
	if (options.candidate && !['predecessor', 'candidate'].includes(options.phase)) throw new Error('--phase must be predecessor or candidate');
	if (!options.candidate && options.phase) throw new Error('--phase requires --candidate');
	if (options.profile !== 'all' && (options.output || options.evidence || options.candidate || options.phase)) {
		throw new Error('--profile is diagnostic-only and cannot write formal evidence');
	}
	if (options.profile === 'all' && (options.totalBytes !== DEFAULT_TOTAL_BYTES || options.warmup !== DEFAULT_WARMUP || options.rounds !== DEFAULT_ROUNDS)) {
		throw new Error('formal benchmark config is fixed');
	}
	return options;
}

export function createDeterministicFixture(totalBytes) {
	const bytes = new Uint8Array(positiveInteger(totalBytes, 'totalBytes'));
	let state = 0x9e3779b9;
	for (let i = 0; i < bytes.byteLength; i++) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		bytes[i] = state & 0xff;
	}
	return { bytes, sha256: sha256(bytes), seed: 0x9e3779b9 };
}

function parseUuid(uuid) {
	return Uint8Array.from(uuid.replaceAll('-', '').match(/../g), byte => Number.parseInt(byte, 16));
}

function createVlessHeader() {
	return new Uint8Array([0, ...parseUuid(UUID), 0, 1, 1, 187, 1, 192, 0, 2, 1]);
}

function encodeVarint(value) {
	const bytes = [];
	let remaining = value >>> 0;
	do {
		let byte = remaining & 0x7f;
		remaining >>>= 7;
		if (remaining) byte |= 0x80;
		bytes.push(byte);
	} while (remaining);
	return Uint8Array.from(bytes);
}

function encodeGrpcFrame(payload) {
	const length = encodeVarint(payload.byteLength);
	const protobufLength = 1 + length.byteLength + payload.byteLength;
	const frame = new Uint8Array(5 + protobufLength);
	frame[0] = 0;
	new DataView(frame.buffer).setUint32(1, protobufLength);
	frame[5] = 0x0a;
	frame.set(length, 6);
	frame.set(payload, 6 + length.byteLength);
	return frame;
}

function splitBytes(bytes, chunkBytes) {
	const chunks = [];
	for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) chunks.push(bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.byteLength)));
	return chunks;
}

function concatBytes(chunks) {
	const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function createGrpcInput(profile, fixture) {
	const frames = [encodeGrpcFrame(createVlessHeader()), ...splitBytes(fixture.bytes, profile.chunkBytes).map(encodeGrpcFrame)];
	const stream = concatBytes(frames);
	if (profile.variant === 'fragmented') {
		const chunks = [];
		const sizes = [1, 2, 3, 4, 64];
		for (let offset = 0, index = 0; offset < stream.byteLength; index++) {
			const size = sizes[index % sizes.length];
			chunks.push(stream.subarray(offset, Math.min(offset + size, stream.byteLength)));
			offset += size;
		}
		return chunks;
	}
	if (profile.variant === 'multiframe') return splitBytes(stream, 256);
	return frames;
}

function decodeGrpcOutput(chunks) {
	const bytes = concatBytes(chunks);
	const payloads = [];
	for (let offset = 0; offset + 5 <= bytes.byteLength;) {
		const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 5).getUint32(1);
		if (offset + 5 + length > bytes.byteLength) throw new Error('truncated gRPC output');
		let cursor = offset + 5;
		if (bytes[cursor++] !== 0x0a) throw new Error('unexpected protobuf field');
		let payloadLength = 0, shift = 0;
		while (cursor < offset + 5 + length) {
			const current = bytes[cursor++];
			payloadLength |= (current & 0x7f) << shift;
			if ((current & 0x80) === 0) break;
			shift += 7;
		}
		payloads.push(bytes.slice(cursor, cursor + payloadLength));
		offset += 5 + length;
	}
	if (payloads[0]?.byteLength === 2 && payloads[0][0] === 0 && payloads[0][1] === 0) payloads.shift();
	return concatBytes(payloads);
}

function grpcPayloadByteLength(chunks) {
	const bytes = concatBytes(chunks);
	let total = 0, frameIndex = 0;
	for (let offset = 0; offset + 5 <= bytes.byteLength;) {
		const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 5).getUint32(1);
		if (offset + 5 + length > bytes.byteLength) break;
		let cursor = offset + 6;
		let payloadLength = 0, shift = 0;
		while (cursor < offset + 5 + length) {
			const current = bytes[cursor++];
			payloadLength |= (current & 0x7f) << shift;
			if ((current & 0x80) === 0) break;
			shift += 7;
		}
		total += frameIndex === 0 && payloadLength >= 2 && bytes[cursor] === 0 && bytes[cursor + 1] === 0 ? payloadLength - 2 : payloadLength;
		frameIndex++;
		offset += 5 + length;
	}
	return total;
}

async function loadWorker(workerSource = null, workerSourceText = null) {
	const sourceUrl = workerSource ? pathToFileURL(resolve(workerSource)) : new URL('../../_worker.js', import.meta.url);
	const cacheKey = workerSourceText === null ? sourceUrl.href : `inline:${sha256(workerSourceText)}`;
	if (!workerModuleCache.has(cacheKey)) {
		workerModuleCache.set(cacheKey, (async () => {
			if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };
			const source = workerSourceText === null ? await readFile(sourceUrl, 'utf8') : workerSourceText;
			const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { 处理WS请求, 处理gRPC请求 };`).toString('base64')}`;
			return { source, module: await import(moduleUrl) };
		})());
	}
	return workerModuleCache.get(cacheKey);
}

function replaceMetricPoint(source, { id, search, replacement, expected = 1, firstOnly = false }) {
	const count = source.split(search).length - 1;
	if (count !== expected) throw new Error(`metric instrumentation point ${id} expected ${expected}, found ${count}`);
	return firstOnly ? source.replace(search, replacement) : source.split(search).join(replacement);
}

export function instrumentWorkerMetrics(workerSource) {
	if (workerSource.includes(WORKER_METRIC_PROBE_KEY)) throw new Error('metric probe key collides with Worker source');
	const metric = `globalThis.${WORKER_METRIC_PROBE_KEY}`;
	const points = [
		{ id: 'grpc-pending-allocation', search: 'const merged = new Uint8Array(pending.length + 当前块.length);', replacement: `const merged = ${metric}.allocate(new Uint8Array(pending.length + 当前块.length));` },
		{ id: 'grpc-pending-copy', search: 'merged.set(pending, 0);', replacement: `${metric}.copy(pending); merged.set(pending, 0);` },
		{ id: 'grpc-current-copy', search: 'merged.set(当前块, pending.length);', replacement: `${metric}.copy(当前块); merged.set(当前块, pending.length);` },
		{ id: 'grpc-remainder-slice', search: 'pending = pending.slice(frameSize);', replacement: `pending = ${metric}.slice(pending, frameSize);` },
		{ id: 'grpc-length-allocation', search: 'const lenBytes = new Uint8Array(lenBytes数组);', replacement: `const lenBytes = ${metric}.allocate(new Uint8Array(lenBytes数组));` },
		{ id: 'grpc-frame-allocation', search: 'const frame = new Uint8Array(5 + protobufLen);', replacement: `const frame = ${metric}.allocate(new Uint8Array(5 + protobufLen));` },
		{ id: 'grpc-frame-length-copy', search: 'frame.set(lenBytes, 6);', replacement: `${metric}.copy(lenBytes); frame.set(lenBytes, 6);` },
		{ id: 'grpc-frame-payload-copy', search: 'frame.set(chunk, 6 + lenBytes.length);', replacement: `${metric}.copy(chunk); frame.set(chunk, 6 + lenBytes.length);` },
		{ id: 'grpc-output-allocation', search: 'const out = new Uint8Array(队列字节数);', replacement: `const out = ${metric}.allocate(new Uint8Array(队列字节数));` },
		{ id: 'grpc-output-copy', search: 'out.set(item, offset);', replacement: `${metric}.copy(item); out.set(item, offset);` },
		{ id: 'uplink-bundle-allocation', search: 'const output = (bundleBuffer ||= new Uint8Array(上行合包目标字节));', replacement: `const output = (bundleBuffer ||= ${metric}.allocate(new Uint8Array(上行合包目标字节)));` },
		{ id: 'uplink-bundle-first-copy', search: 'output.set(first.chunk);', replacement: `${metric}.copy(first.chunk); output.set(first.chunk);` },
		{ id: 'uplink-bundle-next-copy', search: 'output.set(next.chunk, offset);', replacement: `${metric}.copy(next.chunk); output.set(next.chunk, offset);` },
		{ id: 'grain-buffer-allocation', search: 'const 获取填充缓冲 = () => reusableBuffers.pop() || new Uint8Array(packetCap);', replacement: `const 获取填充缓冲 = () => reusableBuffers.pop() || ${metric}.allocate(new Uint8Array(packetCap));` },
		{ id: 'grain-header-allocation', search: 'const merged = new Uint8Array(header.length + chunk.byteLength);', replacement: `const merged = ${metric}.allocate(new Uint8Array(header.length + chunk.byteLength));`, expected: 2, firstOnly: true },
		{ id: 'grain-header-copy', search: 'merged.set(header, 0);', replacement: `${metric}.copy(header); merged.set(header, 0);`, expected: 2, firstOnly: true },
		{ id: 'grain-header-payload-copy', search: 'merged.set(chunk, header.length);', replacement: `${metric}.copy(chunk); merged.set(chunk, header.length);`, expected: 2, firstOnly: true },
		{ id: 'grain-payload-copy', search: 'pendingBuffer.set(chunk.subarray(offset, offset + copyBytes), pendingBytes);', replacement: `${metric}.copy(chunk.subarray(offset, offset + copyBytes)); pendingBuffer.set(chunk.subarray(offset, offset + copyBytes), pendingBytes);` },
		{ id: 'response-header-allocation', search: 'const respHeader = new Uint8Array([version, 0]);', replacement: `const respHeader = ${metric}.allocate(new Uint8Array([version, 0]));`, expected: 2 },
		{ id: 'tcp-write', search: 'await writer.write(item.chunk);', replacement: `${metric}.write(); await writer.write(item.chunk);`, expected: 2 },
		{ id: 'ws-send', search: 'const sendResult = webSocket.send(payload);', replacement: `${metric}.send(); const sendResult = webSocket.send(payload);` },
		{ id: 'grpc-send', search: 'controller.enqueue(out);', replacement: `${metric}.send(); controller.enqueue(out);` },
		{ id: 'uplink-queued-bytes', search: 'queuedBytes += chunk.byteLength;', replacement: `queuedBytes += chunk.byteLength; ${metric}.queue(currentBytes());` },
		{ id: 'uplink-drain-active-bytes', search: 'activeBytes = item.chunk.byteLength;', replacement: `activeBytes = item.chunk.byteLength; ${metric}.queue(currentBytes());` },
		{ id: 'uplink-direct-active-bytes', search: 'activeBytes = chunk.byteLength;', replacement: `activeBytes = chunk.byteLength; ${metric}.queue(currentBytes());` },
		{ id: 'grpc-queued-bytes', search: '队列字节数 += frame.byteLength;', replacement: `队列字节数 += frame.byteLength; ${metric}.queue(队列字节数);` },
		{ id: 'grain-queued-bytes', search: 'pendingBytes += copyBytes;', replacement: `pendingBytes += copyBytes; ${metric}.queue(pendingBytes);` },
	];
	return points.reduce(replaceMetricPoint, workerSource);
}

function resetWorkerMetricProbe() {
	const metrics = {
		sourceBytes: 0,
		copiedBytes: 0,
		copyOperations: 0,
		allocatedBytes: 0,
		writes: 0,
		sends: 0,
		peakQueuedBytes: 0,
	};
	globalThis[WORKER_METRIC_PROBE_KEY] = {
		metrics,
		allocate(value) {
			metrics.allocatedBytes += value.byteLength;
			return value;
		},
		copy(value) {
			const bytes = value?.byteLength || 0;
			if (bytes > 0) {
				metrics.copiedBytes += bytes;
				metrics.copyOperations++;
			}
		},
		slice(value, start, end) {
			const output = value.slice(start, end);
			if (output.byteLength > 0) {
				metrics.allocatedBytes += output.byteLength;
				metrics.copiedBytes += output.byteLength;
				metrics.copyOperations++;
			}
			return output;
		},
		write() { metrics.writes++ },
		send() { metrics.sends++ },
		queue(bytes) { metrics.peakQueuedBytes = Math.max(metrics.peakQueuedBytes, bytes) },
	};
	return globalThis[WORKER_METRIC_PROBE_KEY];
}


function createDeferred() {
	let resolvePromise;
	const promise = new Promise(resolve => { resolvePromise = resolve });
	return { promise, resolve: resolvePromise };
}

function createSocket(fixture, profile, uploadChunks) {
	const uploaded = [];
	let uploadedBytes = 0;
	let readOffset = 0;
	let readableController = null;
	let readableClosed = false;
	const downlinkDone = createDeferred();
	const uploadDone = createDeferred();
	const expectedUploadBytes = uploadChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const readable = new ReadableStream({
		async pull(controller) {
			readableController = controller;
			if (profile.direction === 'upload') {
				return;
			}
			if (!['download', 'bidirectional'].includes(profile.direction) || readOffset >= fixture.bytes.byteLength) {
				if (profile.direction === 'bidirectional' && uploadedBytes < expectedUploadBytes) await uploadDone.promise;
				readableClosed = true;
				controller.close();
				downlinkDone.resolve();
				return;
			}
			const chunk = fixture.bytes.subarray(readOffset, Math.min(readOffset + profile.chunkBytes, fixture.bytes.byteLength));
			readOffset += chunk.byteLength;
			controller.enqueue(chunk);
		},
	});
	const writable = new WritableStream({
		write(chunk) {
			const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
			uploaded.push(bytes.slice());
			uploadedBytes += bytes.byteLength;
			if (uploadedBytes >= expectedUploadBytes) uploadDone.resolve();
		},
	});
	return {
		socket: {
			readable,
			writable,
			opened: Promise.resolve(),
			close() {
				if (readableClosed || !readableController) return;
				readableClosed = true;
				readableController.error(new Error('benchmark socket closed'));
			},
		},
		uploaded,
		downlinkDone,
		get uploadedBytes() { return uploadedBytes },
		expectedUploadBytes,
	};
}

async function waitFor(predicate, message) {
	const deadline = performance.now() + 5000;
	while (!predicate()) {
		if (performance.now() > deadline) throw new Error(message);
		await new Promise(resolvePromise => setImmediate(resolvePromise));
	}
}

function summarizeOutput(bytes) {
	return { totalBytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function runGrpcProfile(profile, fixture, workerSource, workerSourceText) {
	const { module } = await loadWorker(workerSource, workerSourceText);
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	globalThis.setInterval = () => 1;
	globalThis.clearInterval = () => { };
	const uploadChunks = ['upload', 'bidirectional'].includes(profile.direction) ? splitBytes(fixture.bytes, profile.chunkBytes) : [];
	const inputChunks = createGrpcInput(profile, { ...fixture, bytes: uploadChunks.length ? fixture.bytes : new Uint8Array(0) });
	const remote = createSocket(fixture, profile, uploadChunks);
	const responseComplete = createDeferred();
	let inputIndex = 0;
	const body = new ReadableStream({
		async pull(controller) {
			if (inputIndex < inputChunks.length) {
				controller.enqueue(inputChunks[inputIndex++]);
				return;
			}
			if (['download', 'bidirectional'].includes(profile.direction)) await responseComplete.promise;
			controller.close();
		},
	});
	const request = { body, fetcher: { connect: () => remote.socket } };
	try {
		const response = await module.处理gRPC请求(request, UUID);
		const responseChunks = [];
		const reader = response.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value?.byteLength) {
				responseChunks.push(value);
				if (grpcPayloadByteLength(responseChunks) >= fixture.bytes.byteLength) responseComplete.resolve();
			}
		}
		const uploaded = concatBytes(remote.uploaded);
		const downloaded = decodeGrpcOutput(responseChunks);
		const normalizedDownloaded = downloaded.byteLength >= 2 && downloaded[0] === 0 && downloaded[1] === 0 ? downloaded.subarray(2) : downloaded;
		const output = profile.direction === 'upload' ? uploaded : (profile.direction === 'download' ? normalizedDownloaded : { upload: summarizeOutput(uploaded), download: summarizeOutput(normalizedDownloaded) });
		return {
			actualWorkerHotPath: true,
			output: profile.direction === 'bidirectional' ? output : summarizeOutput(output),
		};
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
}

async function runWsProfile(profile, fixture, workerSource, workerSourceText) {
	const { module } = await loadWorker(workerSource, workerSourceText);
	const uploadChunks = ['upload', 'bidirectional'].includes(profile.direction) ? splitBytes(fixture.bytes, profile.chunkBytes) : [];
	const remote = createSocket(fixture, profile, uploadChunks);
	const downloaded = [];
	const listeners = new Map();
	const client = { side: 'client' };
	const server = {
		readyState: WebSocket.OPEN,
		binaryType: 'blob',
		accept() { },
		addEventListener(type, listener) { listeners.set(type, listener) },
		send(data) { downloaded.push((data instanceof Uint8Array ? data : new Uint8Array(data)).slice()) },
		close() { this.readyState = WebSocket.CLOSED },
	};
	const originalPair = globalThis.WebSocketPair;
	const originalResponse = globalThis.Response;
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	globalThis.WebSocketPair = class WebSocketPairMock { constructor() { return { 0: client, 1: server } } };
	globalThis.Response = class ResponseMock { constructor(body, init) { this.body = body; Object.assign(this, init) } };
	globalThis.setInterval = () => 1;
	globalThis.clearInterval = () => { };
	try {
		const request = new Request('https://worker.invalid/ws');
		Object.defineProperty(request, 'fetcher', { value: { connect: () => remote.socket } });
		const response = await module.处理WS请求(request, UUID, new URL(request.url));
		if (response.status !== 101 || response.webSocket !== client) throw new Error('WS upgrade contract mismatch');
		listeners.get('message')({ data: createVlessHeader().buffer });
		let sentBytes = 0;
		for (let index = 0; index < uploadChunks.length; index++) {
			const chunk = uploadChunks[index];
			listeners.get('message')({ data: chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) });
			sentBytes += chunk.byteLength;
			if ((index + 1) % 64 === 0 || sentBytes - remote.uploadedBytes >= 64 * KIB) {
				const expectedBytes = sentBytes;
				await waitFor(() => remote.uploadedBytes >= expectedBytes, 'WS upload batch did not complete');
			}
		}
		if (uploadChunks.length) await waitFor(() => remote.uploadedBytes === fixture.bytes.byteLength, 'WS upload did not complete');
		if (['download', 'bidirectional'].includes(profile.direction)) {
			await remote.downlinkDone.promise;
			await waitFor(() => downloaded.reduce((sum, chunk) => sum + chunk.byteLength, 0) >= fixture.bytes.byteLength + 2, 'WS download did not complete');
		}
		if (profile.direction === 'upload') remote.socket.close();
		listeners.get('close')?.({});
		const uploaded = concatBytes(remote.uploaded);
		const downlinkBytes = concatBytes(downloaded);
		const normalizedDownlink = downlinkBytes.byteLength >= 2 && downlinkBytes[0] === 0 && downlinkBytes[1] === 0 ? downlinkBytes.subarray(2) : downlinkBytes;
		return {
			actualWorkerHotPath: true,
			output: profile.direction === 'upload'
				? summarizeOutput(uploaded)
				: (profile.direction === 'download' ? summarizeOutput(normalizedDownlink) : { upload: summarizeOutput(uploaded), download: summarizeOutput(normalizedDownlink) }),
		};
	} finally {
		globalThis.WebSocketPair = originalPair;
		globalThis.Response = originalResponse;
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
}

export async function runProfileOnce(profileId, fixture, { workerSource = null, workerSourceText = null } = {}) {
	const profile = PROFILE_MATRIX.find(candidate => candidate.id === profileId);
	if (!profile) throw new Error(`Unknown profile: ${profileId}`);
	return profile.protocol === 'ws'
		? runWsProfile(profile, fixture, workerSource, workerSourceText)
		: runGrpcProfile(profile, fixture, workerSource, workerSourceText);
}

export async function measureProfileMetrics(profileId, fixture, { workerSource = null, workerSourceText = null } = {}) {
	const profile = PROFILE_MATRIX.find(candidate => candidate.id === profileId);
	if (!profile) throw new Error(`Unknown profile: ${profileId}`);
	const source = workerSourceText ?? (await loadWorker(workerSource)).source;
	const probe = resetWorkerMetricProbe();
	const result = await runProfileOnce(profileId, fixture, { workerSourceText: instrumentWorkerMetrics(source) });
	if (result.actualWorkerHotPath !== true) throw new Error(`${profileId}: metric run missed Worker hot path`);
	probe.metrics.sourceBytes = fixture.bytes.byteLength * (profile.direction === 'bidirectional' ? 2 : 1);
	return { ...probe.metrics };
}


export async function verifyCandidateHotPath(candidateId, { workerSource = null, workerSourceText = null } = {}) {
	const candidate = CANDIDATE_MATRIX.find(item => item.id === candidateId);
	if (!candidate) throw new Error(`Unknown candidate: ${candidateId}`);
	const source = workerSourceText ?? (await loadWorker(workerSource)).source;
	const probeKey = `__cfgfwaxCandidateProbe_${randomUUID().replaceAll('-', '')}`;
	const counter = `globalThis[${JSON.stringify(probeKey)}] = (globalThis[${JSON.stringify(probeKey)}] || 0) + 1`;
	if (!candidate.probePattern.test(source)) throw new Error(`${candidateId}: candidate hot path marker is missing`);
	const instrumentedSource = source.replace(candidate.probePattern, match => candidate.instrument(match, counter));
	globalThis[probeKey] = 0;
	try {
		await runProfileOnce(candidate.primary, createDeterministicFixture(4096), { workerSourceText: instrumentedSource });
		const hits = globalThis[probeKey];
		if (!Number.isSafeInteger(hits) || hits <= 0) throw new Error(`${candidateId}: candidate hot path was not executed`);
		return { candidate: candidateId, profile: candidate.primary, hits, workerSha256: sha256(source) };
	} finally {
		delete globalThis[probeKey];
	}
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function coefficientOfVariation(values) {
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	if (mean === 0) return 0;
	const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance) / mean;
}

export function calculateMeasurementWindow(rounds, {
	minCpuMs = MIN_SAMPLE_CPU_MS,
	maxCpuMs = MAX_SAMPLE_CPU_MS,
	cpuCvLimit = CPU_CV_LIMIT,
	trendLimit = CPU_TREND_LIMIT,
} = {}) {
	const cpuValues = rounds.map(round => round.cpuTotalMs);
	const half = Math.floor(cpuValues.length / 2);
	const startMedianCpuMs = half ? median(cpuValues.slice(0, half)) : Number.NaN;
	const endMedianCpuMs = half ? median(cpuValues.slice(-half)) : Number.NaN;
	const cpuMedianMs = cpuValues.length ? median(cpuValues) : Number.NaN;
	const cpuCv = cpuValues.length ? coefficientOfVariation(cpuValues) : Number.POSITIVE_INFINITY;
	const cpuTrend = Number.isFinite(startMedianCpuMs) && startMedianCpuMs > 0 && Number.isFinite(endMedianCpuMs)
		? Math.abs(endMedianCpuMs - startMedianCpuMs) / startMedianCpuMs
		: Number.POSITIVE_INFINITY;
	const inTimeWindow = Number.isFinite(cpuMedianMs) && cpuMedianMs >= minCpuMs && cpuMedianMs <= maxCpuMs;
	const failures = [];
	if (!Number.isFinite(cpuCv) || cpuCv > cpuCvLimit) failures.push('cpu CV exceeded 10%');
	if (!Number.isFinite(cpuTrend) || cpuTrend > trendLimit) failures.push('cpu trend exceeded 10%');
	if (!inTimeWindow) failures.push('cpu median outside target window');
	return {
		status: failures.length ? 'limited' : 'ready',
		cpuMedianMs,
		cpuCv,
		cpuTrend,
		startMedianCpuMs,
		endMedianCpuMs,
		inTimeWindow,
		failures,
	};
}

export function analyzeSteadyState(rounds, {
	minRounds = STEADY_MIN_ROUNDS,
	maxRounds = STEADY_MAX_ROUNDS,
	windowSize = STEADY_WINDOW_SIZE,
	windowsRequired = STEADY_WINDOWS_REQUIRED,
	...windowOptions
} = {}) {
	if (rounds.length < minRounds) return { status: 'pending', examinedRounds: rounds.length, windows: [] };
	const windows = [];
	for (let offset = windowsRequired - 1; offset >= 0; offset--) {
		const startIndex = rounds.length - windowSize - offset;
		const endIndex = startIndex + windowSize - 1;
		windows.push({ startIndex, endIndex, ...calculateMeasurementWindow(rounds.slice(startIndex, endIndex + 1), windowOptions) });
	}
	const shapeStable = windows.every(window => Number.isFinite(window.cpuCv)
		&& window.cpuCv <= (windowOptions.cpuCvLimit ?? CPU_CV_LIMIT)
		&& Number.isFinite(window.cpuTrend)
		&& window.cpuTrend <= (windowOptions.trendLimit ?? CPU_TREND_LIMIT));
	if (shapeStable && !windows.at(-1).inTimeWindow) return { status: 'recalibrate', examinedRounds: rounds.length, windows };
	if (shapeStable) return { status: 'ready', examinedRounds: rounds.length, windows };
	return { status: rounds.length >= maxRounds ? 'limited' : 'pending', examinedRounds: rounds.length, windows };
}

export function selectFormalMeasurement(rounds, {
	windowSize = FORMAL_WINDOW_SIZE,
	maxRounds = FORMAL_MAX_ROUNDS,
	...windowOptions
} = {}) {
	const discardedWindows = [];
	for (let end = windowSize; end <= Math.min(rounds.length, maxRounds); end++) {
		const startIndex = end - windowSize;
		const selectedWindow = calculateMeasurementWindow(rounds.slice(startIndex, end), windowOptions);
		if (selectedWindow.status === 'ready') {
			const indexedWindow = { startIndex, endIndex: end - 1, ...selectedWindow };
			return {
				status: 'ready',
				examinedRounds: end,
				selectedStartIndex: startIndex,
				selectedEndIndex: end - 1,
				selectedWindow: indexedWindow,
				discardedWindows,
			};
		}
		discardedWindows.push({ startIndex, endIndex: end - 1, failures: selectedWindow.failures });
	}
	return {
		status: rounds.length >= maxRounds ? 'limited' : 'pending',
		examinedRounds: Math.min(rounds.length, maxRounds),
		selectedStartIndex: null,
		selectedEndIndex: null,
		selectedWindow: null,
		discardedWindows,
	};
}

export async function runSteadyMeasurement(measure, {
	calibrate = calibrateMeasurementIterations,
	calibrationOptions,
	maxRecalibrations = MAX_RECALIBRATIONS,
	steadyOptions,
	formalOptions,
} = {}) {
	const attempts = [];
	for (let attemptIndex = 0; attemptIndex <= maxRecalibrations; attemptIndex++) {
		const calibration = await calibrate(measure, calibrationOptions);
		const attempt = { attemptIndex, calibration, steadyRounds: [], steadyState: null, formalRounds: [], formalMeasurement: null };
		attempts.push(attempt);
		if (calibration.status !== 'ready') return { status: 'limited', attempts, calibration, formalRounds: [], selectedWindow: null };

		const steadyMaxRounds = steadyOptions?.maxRounds ?? STEADY_MAX_ROUNDS;
		for (let roundIndex = 0; roundIndex < steadyMaxRounds; roundIndex++) {
			attempt.steadyRounds.push(await measure(calibration.selectedIterations));
			attempt.steadyState = analyzeSteadyState(attempt.steadyRounds, steadyOptions);
			if (attempt.steadyState.status !== 'pending') break;
		}
		if (attempt.steadyState.status === 'recalibrate') continue;
		if (attempt.steadyState.status !== 'ready') return { status: 'limited', attempts, calibration, formalRounds: [], selectedWindow: null };

		const formalMaxRounds = formalOptions?.maxRounds ?? FORMAL_MAX_ROUNDS;
		for (let roundIndex = 0; roundIndex < formalMaxRounds; roundIndex++) {
			attempt.formalRounds.push(await measure(calibration.selectedIterations));
			attempt.formalMeasurement = selectFormalMeasurement(attempt.formalRounds, formalOptions);
			if (attempt.formalMeasurement.status !== 'pending') break;
		}
		if (attempt.formalMeasurement.status === 'ready') {
			const { selectedStartIndex, selectedEndIndex, selectedWindow } = attempt.formalMeasurement;
			return {
				status: 'ready',
				attempts,
				calibration,
				formalRounds: attempt.formalRounds,
				selectedRounds: attempt.formalRounds.slice(selectedStartIndex, selectedEndIndex + 1),
				selectedWindow,
			};
		}
		return { status: 'limited', attempts, calibration, formalRounds: attempt.formalRounds, selectedWindow: null };
	}
	return { status: 'limited', attempts, calibration: attempts.at(-1)?.calibration, formalRounds: [], selectedWindow: null };
}

async function measureProfile(profile, fixture, iterations, workerSource, signal = null) {
	const cpuStart = process.cpuUsage();
	const wallStart = performance.now();
	let result;
	for (let i = 0; i < iterations; i++) {
		if (signal?.aborted) throw new Error(`${profile}: measurement cancelled`);
		result = await runProfileOnce(profile, fixture, { workerSource });
	}
	const cpu = process.cpuUsage(cpuStart);
	const cpuTotalMs = (cpu.user + cpu.system) / 1000;
	const wallTotalMs = performance.now() - wallStart;
	return {
		iterations,
		cpuTotalMs,
		wallTotalMs,
		cpuMs: cpuTotalMs / iterations,
		wallMs: wallTotalMs / iterations,
		output: result.output,
		actualWorkerHotPath: result.actualWorkerHotPath,
	};
}

function assertOutput(profile, output, fixture) {
	const values = profile.direction === 'bidirectional' ? [output.upload, output.download] : [output];
	for (const value of values) {
		if (value.totalBytes !== fixture.bytes.byteLength || value.sha256 !== fixture.sha256) throw new Error(`${profile.id} output mismatch`);
	}
}

async function runCalibratedProfile(profile, fixture, options) {
	for (let i = 0; i < options.warmup; i++) {
		if (options.signal?.aborted) throw new Error(`${profile.id}: profile cancelled`);
		await runProfileOnce(profile.id, fixture, { workerSource: options.workerSource });
	}
	const measure = iterations => measureProfile(profile.id, fixture, iterations, options.workerSource, options.signal);
	let measurement;
	if (options.profile === 'all' || options.formalProfileChild) {
		measurement = await runSteadyMeasurement(measure);
	} else {
		const calibration = await calibrateMeasurementIterations(measure);
		const formalRounds = [];
		for (let roundIndex = 0; roundIndex < options.rounds; roundIndex++) formalRounds.push(await measure(calibration.selectedIterations));
		const roundsInWindow = formalRounds.every(round => round.cpuTotalMs >= MIN_SAMPLE_CPU_MS && round.cpuTotalMs <= MAX_SAMPLE_CPU_MS);
		measurement = {
			status: calibration.status === 'ready' && roundsInWindow && coefficientOfVariation(formalRounds.map(round => round.cpuMs)) <= CPU_CV_LIMIT ? 'ready' : 'limited',
			calibration,
			attempts: [{ attemptIndex: 0, calibration, steadyRounds: [], steadyState: null, formalRounds, formalMeasurement: null }],
			formalRounds,
			selectedRounds: formalRounds,
			selectedWindow: null,
		};
	}
	const finalAttempt = measurement.attempts.at(-1);
	const measuredRounds = measurement.selectedRounds?.length
		? measurement.selectedRounds
		: (finalAttempt?.formalRounds.length ? finalAttempt.formalRounds : finalAttempt?.steadyRounds.slice(-FORMAL_WINDOW_SIZE));
	const rawRounds = (measuredRounds || []).map(({ output, actualWorkerHotPath, ...round }) => round);
	const cpuCv = coefficientOfVariation(rawRounds.map(round => round.cpuMs));
	const correctness = await runProfileOnce(profile.id, fixture, { workerSource: options.workerSource });
	assertOutput(profile, correctness.output, fixture);
	const metrics = await measureProfileMetrics(profile.id, fixture, { workerSource: options.workerSource });
	const summary = {
		cpuMedianMs: median(rawRounds.map(round => round.cpuMs)),
		wallMedianMs: median(rawRounds.map(round => round.wallMs)),
		...metrics,
	};
	return {
		profile: profile.id,
		status: measurement.status,
		calibration: measurement.calibration,
		cpuCv,
		rawRounds,
		measurementAttempts: measurement.attempts.map(attempt => ({
			...attempt,
			steadyRounds: attempt.steadyRounds.map(({ output, actualWorkerHotPath, ...round }) => round),
			formalRounds: attempt.formalRounds.map(({ output, actualWorkerHotPath, ...round }) => round),
		})),
		formalMeasurement: finalAttempt?.formalMeasurement,
		summary,
		metrics,
		output: correctness.output,
	};
}

export function currentEnvironment({
	readPowerMode = () => {
		if (platform() !== 'win32') return 'unknown';
		return execFileSync('powercfg', ['/getactivescheme'], { encoding: 'utf8', windowsHide: true, timeout: 2000 }).trim();
	},
} = {}) {
	let powerMode = 'unknown';
	try { powerMode = readPowerMode() || 'unknown' }
	catch (_) { }
	return {
		node: process.version,
		platform: platform(),
		arch: arch(),
		cpuModel: cpus()[0]?.model || 'unknown',
		logicalCores: cpus().length,
		powerMode,
	};
}

async function fingerprints(fixture, workerSource) {
	return {
		benchmarkSha256: sha256(await readFile(new URL('./ws_grpc_stream_benchmark.mjs', import.meta.url))),
		fixtureSha256: fixture.sha256,
		profileMatrixSha256: sha256(JSON.stringify(PROFILE_MANIFEST)),
		metricDefinitionSha256: sha256(JSON.stringify({
			version: METRIC_DEFINITION_VERSION,
			fields: ['sourceBytes', 'copiedBytes', 'copyOperations', 'allocatedBytes', 'writes', 'sends', 'peakQueuedBytes'],
		})),
		workerSha256: sha256(workerSource),
	};
}

async function runOne(options, phase, pairId) {
	const fixture = createDeterministicFixture(options.totalBytes);
	const { source } = await loadWorker(options.workerSource);
	const selected = options.profile === 'all' ? PROFILE_MATRIX : PROFILE_MATRIX.filter(profile => profile.id === options.profile);
	const candidateHotPath = phase === 'candidate' && selected.some(profile => profile.id === CANDIDATE_MATRIX.find(candidate => candidate.id === options.candidate)?.primary)
		? await verifyCandidateHotPath(options.candidate, { workerSource: options.workerSource })
		: null;
	const profiles = [];
	for (const profile of selected) {
		const measured = await withTimeout(profile.id, PROFILE_TIMEOUT_MS, signal => runCalibratedProfile(profile, fixture, { ...options, signal }));
		profiles.push(measured);
	}
	const status = profiles.every(profile => profile.status === 'ready') ? 'ready' : 'limited';
	return {
		runId: randomUUID(),
		pairId,
		phase,
		status,
		workerSha256: sha256(source),
		actualWorkerHotPath: true,
		candidateHotPath,
		environment: currentEnvironment(),
		calibration: {
			status,
			selectedIterations: Object.fromEntries(profiles.map(profile => [profile.profile, profile.calibration.selectedIterations])),
			traces: Object.fromEntries(profiles.map(profile => [profile.profile, profile.calibration.trace])),
		},
		profiles,
		fingerprints: await fingerprints(fixture, source),
	};
}

async function runProfileChild(options, phase, pairId, executionOrder) {
	const run = await runOne({ ...options, formalProfileChild: true }, phase, pairId);
	if (run.profiles.length !== 1) throw new Error('profile child must execute exactly one profile');
	return {
		schemaVersion: 2,
		kind: 'ws-grpc-profile-child',
		pairId,
		phase,
		processId: process.pid,
		executionOrder,
		environment: run.environment,
		workerSha256: run.workerSha256,
		fingerprints: run.fingerprints,
		actualWorkerHotPath: run.actualWorkerHotPath,
		candidateHotPath: run.candidateHotPath,
		profile: run.profiles[0],
	};
}

function assertSha(value, name) {
	if (!/^[0-9a-f]{64}$/.test(String(value || ''))) throw new Error(`${name} must be SHA-256`);
}

function assertFiniteNumbers(value, location = 'evidence') {
	if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${location} must contain finite numbers`);
	if (!value || typeof value !== 'object') return;
	for (const [key, child] of Object.entries(value)) assertFiniteNumbers(child, `${location}.${key}`);
}

function assertNoSensitiveFields(value, location = 'evidence') {
	if (!value || typeof value !== 'object') return;
	for (const [key, child] of Object.entries(value)) {
		if (/^(host|hostname|domain|uuid|token|credentials?|proxyCredentials?|url|uri|requestPath)$/i.test(key)) throw new Error(`${location}.${key}: sensitive field is forbidden`);
		assertNoSensitiveFields(child, `${location}.${key}`);
	}
}

function validateCalibrationTrace(calibration, profileId) {
	if (!calibration || !Array.isArray(calibration.trace) || calibration.trace.length === 0) throw new Error(`${profileId}: calibration trace required`);
	if (calibration.trace.length > MAX_CALIBRATION_STAGES) throw new Error(`${profileId}: calibration stage mismatch`);
	const visited = new Set();
	for (const [stage, entry] of calibration.trace.entries()) {
		if (entry.stage !== stage || !Number.isSafeInteger(entry.iterations) || entry.iterations <= 0) throw new Error(`${profileId}: calibration stage mismatch`);
		if (stage === 0 && entry.iterations !== 1) throw new Error(`${profileId}: calibration transition mismatch`);
		if (!Array.isArray(entry.samples) || entry.samples.length !== CALIBRATION_SAMPLES_PER_STAGE) throw new Error(`${profileId}: calibration samples mismatch`);
		const cpuMedianMs = median(entry.samples.map(sample => sample.cpuTotalMs));
		const wallMedianMs = median(entry.samples.map(sample => sample.wallTotalMs));
		if (entry.cpuMedianMs !== cpuMedianMs || entry.wallMedianMs !== wallMedianMs) throw new Error(`${profileId}: calibration median mismatch`);
		visited.add(entry.iterations);
		const step = calculateCalibrationStep(cpuMedianMs, entry.iterations, visited);
		const isLast = stage === calibration.trace.length - 1;
		const expectedDecision = isLast && !step.terminal && calibration.trace.length === MAX_CALIBRATION_STAGES ? 'limited' : step.decision;
		if (entry.decision !== expectedDecision) throw new Error(`${profileId}: calibration decision mismatch`);
		if (!isLast) {
			if (step.terminal || calibration.trace[stage + 1].iterations !== step.nextIterations) throw new Error(`${profileId}: calibration transition mismatch`);
		} else if (!step.terminal && calibration.trace.length < MAX_CALIBRATION_STAGES) {
			throw new Error(`${profileId}: calibration decision mismatch`);
		}
	}
	const finalDecision = calibration.trace.at(-1).decision;
	const expectedStatus = finalDecision === 'ready' ? 'ready' : 'limited';
	if (calibration.status !== expectedStatus || calibration.selectedIterations !== calibration.trace.at(-1).iterations) throw new Error(`${profileId}: calibration status mismatch`);
}

function validateMeasurementAttempts(profile) {
	if (!Array.isArray(profile.measurementAttempts) || profile.measurementAttempts.length === 0
		|| profile.measurementAttempts.length > MAX_RECALIBRATIONS + 1) throw new Error(`${profile.profile}: measurement attempts required`);
	let expectedStatus = 'limited';
	let expectedFormalMeasurement = null;
	for (const [attemptIndex, attempt] of profile.measurementAttempts.entries()) {
		if (attempt.attemptIndex !== attemptIndex) throw new Error(`${profile.profile}: measurement attempt order mismatch`);
		validateCalibrationTrace(attempt.calibration, profile.profile);
		if (attempt.calibration.status !== 'ready') {
			if (attempt.steadyRounds.length || attempt.formalRounds.length || attempt.steadyState || attempt.formalMeasurement) throw new Error(`${profile.profile}: limited calibration has rounds`);
			continue;
		}
		const steadyState = analyzeSteadyState(attempt.steadyRounds);
		if (JSON.stringify(attempt.steadyState) !== JSON.stringify(steadyState)) throw new Error(`${profile.profile}: steady state mismatch`);
		const formalMeasurement = attempt.formalRounds.length ? selectFormalMeasurement(attempt.formalRounds) : null;
		if (JSON.stringify(attempt.formalMeasurement) !== JSON.stringify(formalMeasurement)) throw new Error(`${profile.profile}: formal measurement mismatch`);
		if (attemptIndex < profile.measurementAttempts.length - 1 && steadyState.status !== 'recalibrate') throw new Error(`${profile.profile}: invalid recalibration transition`);
		if (attemptIndex === profile.measurementAttempts.length - 1) {
			expectedFormalMeasurement = formalMeasurement;
			expectedStatus = formalMeasurement?.status === 'ready' ? 'ready' : 'limited';
		}
	}
	if (JSON.stringify(profile.calibration) !== JSON.stringify(profile.measurementAttempts.at(-1).calibration)) throw new Error(`${profile.profile}: final calibration mismatch`);
	if (JSON.stringify(profile.formalMeasurement) !== JSON.stringify(expectedFormalMeasurement)) throw new Error(`${profile.profile}: final formal measurement mismatch`);
	if (expectedStatus === 'ready') {
		const attempt = profile.measurementAttempts.at(-1);
		const selectedRounds = attempt.formalRounds.slice(expectedFormalMeasurement.selectedStartIndex, expectedFormalMeasurement.selectedEndIndex + 1);
		if (JSON.stringify(profile.rawRounds) !== JSON.stringify(selectedRounds)) throw new Error(`${profile.profile}: selected rounds mismatch`);
	}
	return expectedStatus;
}

function validateRuns(runs, phase, profileIds, runIds, processIds, evidence) {
	const allowRunDrift = phase === 'baseline';
	const schemaV2 = evidence.schemaVersion === 2;
	if (!Array.isArray(runs)) throw new Error(`${phase} runs must contain exactly two runs`);
	const allowIncomplete = allowRunDrift && evidence.executionFailure !== undefined;
	if (allowIncomplete ? runs.length > 2 : (allowRunDrift ? runs.length !== 2 : (runs.length !== 0 && runs.length !== 2))) throw new Error(`${phase} runs must contain exactly two runs`);
	const pairIds = new Set();
	for (const [runIndex, run] of runs.entries()) {
		if (!run.runId || runIds.has(run.runId)) throw new Error('runId must be globally unique');
		runIds.add(run.runId);
		if (run.phase !== phase) throw new Error(`${phase} run phase mismatch`);
		if (![1, 2].includes(run.pairId) || pairIds.has(run.pairId)) throw new Error(`${phase} pairId must be unique 1/2`);
		pairIds.add(run.pairId);
		assertSha(run.workerSha256, `${phase}.workerSha256`);
		if ((!allowRunDrift || runIndex === 0) && JSON.stringify(run.environment) !== JSON.stringify(evidence.environment)) throw new Error(`${phase} environment drift`);
		for (const name of schemaV2 ? ['benchmarkSha256', 'fixtureSha256', 'profileMatrixSha256', 'metricDefinitionSha256'] : ['benchmarkSha256', 'fixtureSha256', 'profileMatrixSha256']) {
			assertSha(run.fingerprints?.[name], `${phase}.${name}`);
			if ((!allowRunDrift || runIndex === 0) && run.fingerprints[name] !== evidence.fingerprints[name]) throw new Error(`${phase} ${name} drift`);
		}
		if (run.fingerprints?.workerSha256 !== run.workerSha256) throw new Error(`${phase} worker fingerprint drift`);
		if (run.actualWorkerHotPath !== true) throw new Error(`${phase} must execute actual Worker hot path`);
		const expectedProfileIds = schemaV2 && run.pairId === 2 ? [...profileIds].reverse() : profileIds;
		if (!Array.isArray(run.profiles) || JSON.stringify(run.profiles.map(profile => profile.profile)) !== JSON.stringify(expectedProfileIds)) throw new Error(`${phase} profile matrix mismatch`);
		if (schemaV2) {
			if (!Array.isArray(run.processes) || run.processes.length !== expectedProfileIds.length) throw new Error(`${phase} process manifest mismatch`);
			for (const [executionOrder, processEntry] of run.processes.entries()) {
				if (processEntry.executionOrder !== executionOrder || processEntry.profile !== expectedProfileIds[executionOrder]
					|| !Number.isSafeInteger(processEntry.processId) || processEntry.processId <= 0 || processIds.has(processEntry.processId)) {
					throw new Error(`${phase} process/order mismatch`);
				}
				processIds.add(processEntry.processId);
			}
		}
		for (const profile of run.profiles) {
			if (!['ws', 'grpc'].includes(profile.profile.split('-')[0])) throw new Error('unknown protocol');
			const definition = PROFILE_MATRIX.find(item => item.id === profile.profile);
			if (!Array.isArray(profile.rawRounds) || profile.rawRounds.length === 0) throw new Error(`${profile.profile}: rawRounds required`);
			const iterations = profile.rawRounds[0].iterations;
			if (!Number.isSafeInteger(iterations) || iterations <= 0 || profile.rawRounds.some(round => round.iterations !== iterations)) throw new Error(`${profile.profile}: calibration iterations mismatch`);
			if (run.calibration?.selectedIterations?.[profile.profile] !== iterations) throw new Error(`${profile.profile}: recorded iterations mismatch`);
			const metricNames = ['sourceBytes', 'copiedBytes', 'copyOperations', 'allocatedBytes', 'writes', 'sends', 'peakQueuedBytes'];
			if (profile.rawRounds.some(round => metricNames.some(name => Object.hasOwn(round, name)))) throw new Error(`${profile.profile}: timed rounds must not contain instrumented metrics`);
			if (!profile.metrics || JSON.stringify(Object.keys(profile.metrics).sort()) !== JSON.stringify([...metricNames].sort())) {
				throw new Error(`${profile.profile}: metric set mismatch`);
			}
			for (const name of metricNames) {
				if (!Number.isSafeInteger(profile.metrics[name]) || profile.metrics[name] < 0) throw new Error(`${profile.profile}: invalid ${name}`);
			}
			const expectedSourceBytes = DEFAULT_TOTAL_BYTES * (definition.direction === 'bidirectional' ? 2 : 1);
			if (profile.metrics.sourceBytes !== expectedSourceBytes) throw new Error(`${profile.profile}: sourceBytes mismatch`);
			const cpuCv = coefficientOfVariation(profile.rawRounds.map(round => round.cpuMs));
			if (profile.rawRounds.some(round => round.cpuMs !== round.cpuTotalMs / round.iterations
				|| round.wallMs !== round.wallTotalMs / round.iterations)) {
				throw new Error(`${profile.profile}: raw total mismatch`);
			}
			if (profile.cpuCv !== cpuCv) throw new Error(`${profile.profile}: cpuCv mismatch`);
			let expectedStatus;
			if (schemaV2 || profile.measurementAttempts) {
				expectedStatus = validateMeasurementAttempts(profile);
			} else {
				const roundsInWindow = profile.rawRounds.every(round => round.cpuTotalMs >= MIN_SAMPLE_CPU_MS && round.cpuTotalMs <= MAX_SAMPLE_CPU_MS);
				expectedStatus = cpuCv <= CPU_CV_LIMIT && roundsInWindow && profile.calibration?.status !== 'limited' ? 'ready' : 'limited';
			}
			if (profile.status !== expectedStatus) throw new Error(`${profile.profile}: profile status mismatch`);
			const expectedSummary = {
				cpuMedianMs: median(profile.rawRounds.map(round => round.cpuMs)),
				wallMedianMs: median(profile.rawRounds.map(round => round.wallMs)),
				...profile.metrics,
			};
			if (JSON.stringify(profile.summary) !== JSON.stringify(expectedSummary)) throw new Error(`${profile.profile}: summary mismatch`);
		}
		const expectedRunStatus = run.profiles.every(profile => profile.status === 'ready') ? 'ready' : 'limited';
		if (run.status !== expectedRunStatus || run.calibration?.status !== expectedRunStatus) throw new Error(`${phase} calibration status mismatch`);
		if (schemaV2) {
			const expectedCalibration = {
				status: expectedRunStatus,
				selectedIterations: Object.fromEntries(run.profiles.map(profile => [profile.profile, profile.calibration.selectedIterations])),
				traces: Object.fromEntries(run.profiles.map(profile => [profile.profile, profile.calibration.trace])),
			};
			if (JSON.stringify(run.calibration) !== JSON.stringify(expectedCalibration)) throw new Error(`${phase} run calibration mismatch`);
		}
		if (phase === 'candidate') {
			const probe = run.candidateHotPath;
			if (probe?.candidate !== evidence.candidate || probe.profile !== CANDIDATE_MATRIX.find(item => item.id === evidence.candidate)?.primary
				|| probe.workerSha256 !== run.workerSha256 || !Number.isSafeInteger(probe.hits) || probe.hits <= 0) {
				throw new Error('candidate hot path evidence is missing or invalid');
			}
		}
	}
}

export function validateEvidence(evidence, { requireCompleteCandidate = true, expectedEnvironment = null } = {}) {
	if (![1, 2].includes(evidence?.schemaVersion) || evidence.kind !== 'ws-grpc-benchmark') throw new Error('unsupported evidence schema');
	const schemaV2 = evidence.schemaVersion === 2;
	assertFiniteNumbers(evidence);
	assertNoSensitiveFields(evidence);
	for (const name of schemaV2 ? ['benchmarkSha256', 'fixtureSha256', 'profileMatrixSha256', 'metricDefinitionSha256'] : ['benchmarkSha256', 'fixtureSha256', 'profileMatrixSha256']) assertSha(evidence.fingerprints?.[name], name);
	const profileIds = PROFILE_MANIFEST.map(profile => profile.id);
	if (JSON.stringify(evidence.config?.profileManifest) !== JSON.stringify(PROFILE_MANIFEST)) throw new Error('profile matrix mismatch');
	if (evidence.config?.totalBytesPerDirection !== DEFAULT_TOTAL_BYTES || evidence.config?.cpuCvLimit !== CPU_CV_LIMIT
		|| evidence.config?.metricDefinitionVersion !== METRIC_DEFINITION_VERSION) throw new Error('fixed benchmark config mismatch');
	if (schemaV2) {
		const expectedV2Config = {
			cpuTrendLimit: CPU_TREND_LIMIT,
			calibrationSamplesPerStage: CALIBRATION_SAMPLES_PER_STAGE,
			steadyMinRounds: STEADY_MIN_ROUNDS,
			steadyMaxRounds: STEADY_MAX_ROUNDS,
			steadyWindowSize: STEADY_WINDOW_SIZE,
			steadyWindowsRequired: STEADY_WINDOWS_REQUIRED,
			formalWindowSize: FORMAL_WINDOW_SIZE,
			formalMaxRounds: FORMAL_MAX_ROUNDS,
			maxRecalibrations: MAX_RECALIBRATIONS,
		};
		for (const [name, value] of Object.entries(expectedV2Config)) {
			if (evidence.config?.[name] !== value) throw new Error('fixed benchmark config mismatch');
		}
		if (!Number.isSafeInteger(evidence.environment?.logicalCores) || evidence.environment.logicalCores <= 0
			|| typeof evidence.environment?.powerMode !== 'string' || !evidence.environment.powerMode) throw new Error('environment fingerprint incomplete');
	}
	if (expectedEnvironment && JSON.stringify(evidence.environment) !== JSON.stringify(expectedEnvironment)) throw new Error('environment drift');
	const runIds = new Set();
	const processIds = new Set();
	if (evidence.mode === 'baseline') {
		validateRuns(evidence.runs, 'baseline', profileIds, runIds, processIds, evidence);
		if (evidence.executionFailure !== undefined && !['benchmark timed out', 'benchmark execution failed'].includes(evidence.executionFailure)) throw new Error('invalid baseline execution failure');
		const expectedDecision = calculateBaselineDecision(evidence.runs, evidence.executionFailure);
		const actualDecision = { baselineStatus: evidence.baselineStatus, failures: evidence.failures };
		if (JSON.stringify(actualDecision) !== JSON.stringify(expectedDecision)) throw new Error('baseline decision mismatch');
	}
	else if (evidence.mode === 'candidate') {
		if (!CANDIDATE_MATRIX.some(candidate => candidate.id === evidence.candidate)) throw new Error('unknown candidate');
		validateRuns(evidence.predecessorRuns, 'predecessor', profileIds, runIds, processIds, evidence);
		validateRuns(evidence.candidateRuns, 'candidate', profileIds, runIds, processIds, evidence);
		for (const phaseRuns of [evidence.predecessorRuns, evidence.candidateRuns]) {
			if (phaseRuns.length === 2 && phaseRuns[0].workerSha256 !== phaseRuns[1].workerSha256) throw new Error('worker hash drift within phase');
		}
		if (requireCompleteCandidate && (evidence.predecessorRuns.length !== 2 || evidence.candidateRuns.length !== 2 || !evidence.decision)) throw new Error('candidate evidence is incomplete');
		if (evidence.candidateRuns.length === 2) {
			const expectedDecision = calculateCandidateDecision(evidence.candidate, evidence.predecessorRuns, evidence.candidateRuns);
			if (JSON.stringify(evidence.decision) !== JSON.stringify(expectedDecision)) throw new Error('candidate decision mismatch');
		} else if (evidence.decision !== undefined) throw new Error('candidate decision exists before candidate runs');
	} else throw new Error('unknown evidence mode');
	return evidence;
}

function appendCrossRunFailures(label, runs, failures) {
	if (runs.length !== 2) return;
	const first = new Map(runs[0].profiles.map(profile => [profile.profile, profile.summary.cpuMedianMs]));
	const second = new Map(runs[1].profiles.map(profile => [profile.profile, profile.summary.cpuMedianMs]));
	for (const { id } of PROFILE_MANIFEST) {
		const low = Math.min(first.get(id), second.get(id));
		const high = Math.max(first.get(id), second.get(id));
		if (!(low > 0) || high / low > 1.10) failures.push(`${label} cross-run: ${id} CPU median differs over 10%`);
	}
}

export function calculateBaselineDecision(runs, executionFailure = null) {
	const failures = [];
	if (executionFailure) failures.push(executionFailure);
	if (!Array.isArray(runs) || runs.length !== 2) failures.push('baseline requires exactly two runs');
	for (const run of Array.isArray(runs) ? runs : []) {
		if (run.status !== 'ready') failures.push(`run ${run.pairId}: not ready`);
	}
	if (Array.isArray(runs) && runs.length === 2) {
		if (runs[0].workerSha256 !== runs[1].workerSha256) failures.push('worker hash drift');
		if (JSON.stringify(runs[0].environment) !== JSON.stringify(runs[1].environment)) failures.push('environment drift');
		for (const name of ['benchmarkSha256', 'fixtureSha256', 'profileMatrixSha256', 'metricDefinitionSha256']) {
			if (runs[0].fingerprints?.[name] !== runs[1].fingerprints?.[name]) failures.push(`${name} drift`);
		}
		appendCrossRunFailures('baseline', runs, failures);
	}
	return { baselineStatus: failures.length ? 'INCONCLUSIVE' : 'frozen', failures };
}


export function calculateCandidateDecision(candidateId, predecessorRuns, candidateRuns) {
	const candidate = CANDIDATE_MATRIX.find(item => item.id === candidateId);
	if (!candidate) throw new Error(`Unknown candidate: ${candidateId}`);
	const failures = [];
	if (predecessorRuns[0]?.workerSha256 === candidateRuns[0]?.workerSha256) failures.push('candidate worker hash matches predecessor');
	appendCrossRunFailures('predecessor', predecessorRuns, failures);
	appendCrossRunFailures('candidate', candidateRuns, failures);
	const pairs = [1, 2].map(pairId => {
		const predecessor = predecessorRuns.find(run => run.pairId === pairId);
		const current = candidateRuns.find(run => run.pairId === pairId);
		if (!predecessor || !current || predecessor.status !== 'ready' || current.status !== 'ready') {
			failures.push(`pair ${pairId}: run not ready`);
			return { pairId, passed: false };
		}
		const previousByProfile = new Map(predecessor.profiles.map(profile => [profile.profile, profile]));
		const currentByProfile = new Map(current.profiles.map(profile => [profile.profile, profile]));
		const primaryRatio = currentByProfile.get(candidate.primary).summary.cpuMedianMs / previousByProfile.get(candidate.primary).summary.cpuMedianMs;
		if (primaryRatio > 0.90) failures.push(`pair ${pairId}: primary CPU improvement below 10%`);
		for (const profileId of [candidate.supporting, ...candidate.nonTargets]) {
			const before = previousByProfile.get(profileId).summary;
			const after = currentByProfile.get(profileId).summary;
			if (after.cpuMedianMs / before.cpuMedianMs > 1.05 || after.wallMedianMs / before.wallMedianMs > 1.05) failures.push(`pair ${pairId}: ${profileId} regressed over 5%`);
		}
		return { pairId, primaryCpuRatio: primaryRatio, passed: failures.every(failure => !failure.startsWith(`pair ${pairId}:`)) };
	});
	return { status: failures.length ? 'NO-GO' : 'GO', pairs, failures };
}

export function appendCandidatePhase(evidence, phase, runs, { expectedEnvironment = null } = {}) {
	validateEvidence(evidence, { requireCompleteCandidate: false, expectedEnvironment });
	const next = structuredClone(evidence);
	if (phase === 'predecessor') {
		if (next.predecessorRuns.length) throw new Error('predecessor evidence already exists');
		next.predecessorRuns = runs;
	} else if (phase === 'candidate') {
		if (!next.predecessorRuns.length) throw new Error('predecessor evidence is required');
		if (next.candidateRuns.length) throw new Error('candidate evidence already exists');
		next.candidateRuns = runs;
		next.decision = calculateCandidateDecision(next.candidate, next.predecessorRuns, next.candidateRuns);
	} else throw new Error('unknown candidate phase');
	validateEvidence(next, { requireCompleteCandidate: phase === 'candidate', expectedEnvironment });
	return next;
}

export function runChildProcess(command, args, {
	spawnProcess = spawn,
	timeoutMs = CHILD_RUN_TIMEOUT_MS,
	signal,
	maxOutputBytes = MAX_CHILD_OUTPUT_BYTES,
} = {}) {
	if (signal?.aborted) return Promise.reject(new Error('benchmark child cancelled'));
	return new Promise((resolvePromise, rejectPromise) => {
		let child;
		try {
			child = spawnProcess(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
		} catch (error) {
			rejectPromise(error);
			return;
		}
		const stdout = [];
		const stderr = [];
		let outputBytes = 0;
		let settled = false;
		let terminalError = null;
		let forceKillTimer = null;
		let timeoutTimer = null;
		const cleanup = () => {
			if (timeoutTimer) clearTimeout(timeoutTimer);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			signal?.removeEventListener('abort', onAbort);
			child.stdout?.off('data', onStdout);
			child.stderr?.off('data', onStderr);
			child.off('error', onError);
			child.off('close', onClose);
		};
		const settle = (error, value) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (error) rejectPromise(error);
			else resolvePromise(value);
		};
		const terminate = error => {
			if (terminalError || settled) return;
			terminalError = error;
			try {
				child.kill('SIGTERM');
			} catch {
				settle(terminalError);
				return;
			}
			forceKillTimer = setTimeout(() => {
				try {
					child.kill('SIGKILL');
				} finally {
					settle(terminalError);
				}
			}, CHILD_KILL_GRACE_MS);
		};
		const collect = (chunks, chunk) => {
			const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
			outputBytes += value.byteLength;
			if (outputBytes > maxOutputBytes) {
				terminate(new Error('benchmark child output exceeded limit'));
				return;
			}
			chunks.push(value);
		};
		const onStdout = chunk => collect(stdout, chunk);
		const onStderr = chunk => collect(stderr, chunk);
		const onError = error => settle(error);
		const onClose = (code, closeSignal) => {
			if (terminalError) {
				settle(terminalError);
				return;
			}
			if (code === 0) {
				settle(null, Buffer.concat(stdout).toString('utf8'));
				return;
			}
			const message = Buffer.concat(stderr).toString('utf8').trim();
			settle(new Error(message || `benchmark child failed with code ${code}, signal ${closeSignal || 'none'}`));
		};
		const onAbort = () => terminate(new Error('benchmark child cancelled'));
		child.stdout?.on('data', onStdout);
		child.stderr?.on('data', onStderr);
		child.once('error', onError);
		child.once('close', onClose);
		signal?.addEventListener('abort', onAbort, { once: true });
		timeoutTimer = setTimeout(() => terminate(new Error(`benchmark child timed out after ${timeoutMs} ms`)), timeoutMs);
	});
}

export async function writeEvidenceAtomic(output, contents, {
	writeData = writeFile,
	renameFile = rename,
	removeFile = unlink,
} = {}) {
	const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeData(temporary, contents, { flag: 'wx' });
		await renameFile(temporary, output);
	} catch (error) {
		try {
			await removeFile(temporary);
		} catch {
			// 保留原始写入/替换错误。
		}
		throw error;
	}
}

function assembleProfileRun(pairId, phase, children) {
	if (children.length !== PROFILE_MANIFEST.length) throw new Error(`run ${pairId}: missing profile child`);
	const first = children[0];
	for (const [executionOrder, child] of children.entries()) {
		const expectedProfile = pairId === 1 ? PROFILE_MANIFEST[executionOrder].id : PROFILE_MANIFEST.at(-executionOrder - 1).id;
		if (child.schemaVersion !== 2 || child.kind !== 'ws-grpc-profile-child'
			|| child.pairId !== pairId || child.phase !== phase || child.executionOrder !== executionOrder
			|| child.profile?.profile !== expectedProfile) throw new Error('profile child identity mismatch');
		if (!Number.isSafeInteger(child.processId) || child.processId <= 0) throw new Error('profile child processId invalid');
		if (JSON.stringify(child.environment) !== JSON.stringify(first.environment)) throw new Error('profile child environment drift');
		if (JSON.stringify(child.fingerprints) !== JSON.stringify(first.fingerprints)) throw new Error('profile child fingerprints drift');
		if (child.workerSha256 !== first.workerSha256 || child.fingerprints?.workerSha256 !== child.workerSha256) throw new Error('profile child worker drift');
		if (child.actualWorkerHotPath !== true) throw new Error('profile child must execute actual Worker hot path');
	}
	const profiles = children.map(child => child.profile);
	const status = profiles.every(profile => profile.status === 'ready') ? 'ready' : 'limited';
	return {
		runId: randomUUID(),
		pairId,
		phase,
		status,
		workerSha256: first.workerSha256,
		actualWorkerHotPath: true,
		candidateHotPath: children.find(child => child.candidateHotPath)?.candidateHotPath || null,
		environment: first.environment,
		fingerprints: first.fingerprints,
		processes: children.map(child => ({
			processId: child.processId,
			executionOrder: child.executionOrder,
			profile: child.profile.profile,
		})),
		calibration: {
			status,
			selectedIterations: Object.fromEntries(profiles.map(profile => [profile.profile, profile.calibration.selectedIterations])),
			traces: Object.fromEntries(profiles.map(profile => [profile.profile, profile.calibration.trace])),
		},
		profiles,
	};
}

function preserveCompletedRuns(error, runs) {
	const failure = error instanceof Error ? error : new Error('benchmark execution failed');
	failure.completedRuns = [...runs];
	return failure;
}

export async function runTwoProcesses(options, phase, { signal = null, runChild = runChildProcess } = {}) {
	const script = fileURLToPath(import.meta.url);
	const deadline = Date.now() + PARENT_RUN_TIMEOUT_MS;
	const runs = [];
	const processIds = new Set();
	for (const pairId of [1, 2]) {
		const profileIds = PROFILE_MANIFEST.map(profile => profile.id);
		if (pairId === 2) profileIds.reverse();
		const children = [];
		for (const [executionOrder, profileId] of profileIds.entries()) {
			const remainingMs = deadline - Date.now();
			if (remainingMs <= 0) throw new Error(`benchmark parent timed out after ${PARENT_RUN_TIMEOUT_MS} ms`);
			const args = [script, '--profile-child', '--child-run', `${pairId}`, '--profile-order', `${executionOrder}`, '--total-bytes', `${options.totalBytes}`, '--warmup', `${options.warmup}`, '--rounds', `${options.rounds}`, '--profile', profileId];
			if (options.candidate) args.push('--candidate', options.candidate, '--phase', phase);
			if (options.workerSource) args.push('--worker-source', options.workerSource);
			let stdout;
			try {
				stdout = await runChild(process.execPath, args, {
					signal,
					timeoutMs: Math.min(CHILD_RUN_TIMEOUT_MS, remainingMs),
				});
			} catch (error) {
				throw preserveCompletedRuns(error, runs);
			}
			let child;
			try { child = JSON.parse(stdout) }
			catch (error) {
				throw preserveCompletedRuns(new Error(`profile child invalid JSON: ${error.message}`), runs);
			}
			if (child.pairId !== pairId || child.phase !== phase || child.executionOrder !== executionOrder || child.profile?.profile !== profileId) {
				throw preserveCompletedRuns(new Error('profile child identity mismatch'), runs);
			}
			if (processIds.has(child.processId)) throw preserveCompletedRuns(new Error('profile child processId must be unique'), runs);
			processIds.add(child.processId);
			children.push(child);
		}
		try { runs.push(assembleProfileRun(pairId, phase, children)) }
		catch (error) { throw preserveCompletedRuns(error, runs) }
	}
	return runs;
}

function baseConfig(fingerprint, environment = currentEnvironment()) {
	return {
		config: {
			totalBytesPerDirection: DEFAULT_TOTAL_BYTES,
			profileManifest: PROFILE_MANIFEST,
			cpuCvLimit: CPU_CV_LIMIT,
			cpuTrendLimit: CPU_TREND_LIMIT,
			calibrationSamplesPerStage: CALIBRATION_SAMPLES_PER_STAGE,
			steadyMinRounds: STEADY_MIN_ROUNDS,
			steadyMaxRounds: STEADY_MAX_ROUNDS,
			steadyWindowSize: STEADY_WINDOW_SIZE,
			steadyWindowsRequired: STEADY_WINDOWS_REQUIRED,
			formalWindowSize: FORMAL_WINDOW_SIZE,
			formalMaxRounds: FORMAL_MAX_ROUNDS,
			maxRecalibrations: MAX_RECALIBRATIONS,
			metricDefinitionVersion: METRIC_DEFINITION_VERSION,
		},
		environment,
		fingerprints: {
			benchmarkSha256: fingerprint.benchmarkSha256,
			fixtureSha256: fingerprint.fixtureSha256,
			profileMatrixSha256: fingerprint.profileMatrixSha256,
			metricDefinitionSha256: fingerprint.metricDefinitionSha256,
		},
	};
}

async function main() {
	const rawArgs = process.argv.slice(2);
	const childIndex = rawArgs.indexOf('--child-run');
	const profileChildIndex = rawArgs.indexOf('--profile-child');
	if (profileChildIndex !== -1) {
		if (childIndex === -1) throw new Error('--profile-child requires --child-run');
		const orderIndex = rawArgs.indexOf('--profile-order');
		if (orderIndex === -1) throw new Error('--profile-child requires --profile-order');
		const pairId = positiveInteger(rawArgs[childIndex + 1], '--child-run');
		const executionOrder = Number(rawArgs[orderIndex + 1]);
		if (!Number.isSafeInteger(executionOrder) || executionOrder < 0) throw new Error('--profile-order must be a non-negative integer');
		const internalIndexes = new Set([profileChildIndex, childIndex, childIndex + 1, orderIndex, orderIndex + 1]);
		const options = parseBenchmarkOptions(rawArgs.filter((_, index) => !internalIndexes.has(index)));
		if (options.profile === 'all') throw new Error('--profile-child requires one profile');
		const child = await runProfileChild(options, options.phase || 'baseline', pairId, executionOrder);
		process.stdout.write(`${JSON.stringify(child)}\n`);
		return;
	}
	if (childIndex !== -1) {
		const pairId = positiveInteger(rawArgs[childIndex + 1], '--child-run');
		const childArgs = rawArgs.filter((_, index) => index !== childIndex && index !== childIndex + 1);
		const options = parseBenchmarkOptions([...childArgs, '--runs', '2']);
		const run = await runOne(options, options.phase || 'baseline', pairId);
		process.stdout.write(`${JSON.stringify(run)}\n`);
		return;
	}
	const options = parseBenchmarkOptions(rawArgs);
	if (options.help) {
		process.stdout.write('Usage: node ws_grpc_stream_benchmark.mjs [--profile PROFILE] | [--runs 2 --output FILE] | [--candidate ID --phase predecessor|candidate --output FILE [--evidence FILE]]\n');
		return;
	}
	if (options.profile !== 'all') {
		const fixture = createDeterministicFixture(options.totalBytes);
		const profile = PROFILE_MATRIX.find(item => item.id === options.profile);
		const result = await runProfileOnce(options.profile, fixture, { workerSource: options.workerSource });
		assertOutput(profile, result.output, fixture);
		const metrics = await measureProfileMetrics(options.profile, fixture, { workerSource: options.workerSource });
		process.stdout.write(`${JSON.stringify({ mode: 'diagnostic', profile: options.profile, metrics, output: result.output }, null, 2)}\n`);
		return;
	}
	if (!options.output && !(options.phase === 'candidate' && options.evidence)) throw new Error('--output is required');
	const phase = options.phase || 'baseline';
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.once('SIGINT', cancel);
	process.once('SIGTERM', cancel);
	let runs;
	let executionFailure = null;
	try {
		runs = await runTwoProcesses(options, phase, { signal: controller.signal });
	} catch (error) {
		if (options.candidate || /cancelled/.test(error?.message || '')) throw error;
		runs = error?.completedRuns || [];
		executionFailure = /timed out/.test(error?.message || '') ? 'benchmark timed out' : 'benchmark execution failed';
	} finally {
		process.removeListener('SIGINT', cancel);
		process.removeListener('SIGTERM', cancel);
	}
	let evidence;
	if (!options.candidate) {
		let baselineFingerprints = runs[0]?.fingerprints;
		if (!baselineFingerprints) {
			const fixture = createDeterministicFixture(DEFAULT_TOTAL_BYTES);
			const { source } = await loadWorker(options.workerSource);
			baselineFingerprints = await fingerprints(fixture, source);
		}
		const baselineDecision = calculateBaselineDecision(runs, executionFailure);
		evidence = { schemaVersion: 2, kind: 'ws-grpc-benchmark', mode: 'baseline', ...baseConfig(baselineFingerprints, runs[0]?.environment), runs, ...(executionFailure ? { executionFailure } : {}), ...baselineDecision };
		validateEvidence(evidence);
	} else if (phase === 'predecessor') {
		evidence = {
			schemaVersion: 2,
			kind: 'ws-grpc-benchmark',
			mode: 'candidate',
			candidate: options.candidate,
			...baseConfig(runs[0].fingerprints, runs[0].environment),
			predecessorRuns: [],
			candidateRuns: [],
		};
		evidence = appendCandidatePhase(evidence, phase, runs, { workerSource: (await loadWorker(options.workerSource)).source });
	} else {
		const evidencePath = options.evidence || options.output;
		evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
		if (evidence.candidate !== options.candidate) throw new Error('candidate drift');
		if (JSON.stringify(evidence.environment) !== JSON.stringify(currentEnvironment())) throw new Error('environment drift');
		for (const name of ['benchmarkSha256', 'fixtureSha256', 'profileMatrixSha256', 'metricDefinitionSha256']) {
			if (evidence.fingerprints[name] !== runs[0].fingerprints[name]) throw new Error(`${name} drift`);
		}
		evidence = appendCandidatePhase(evidence, phase, runs, { workerSource: (await loadWorker(options.workerSource)).source, expectedEnvironment: evidence.environment });
	}
	const output = options.evidence || options.output;
	await writeEvidenceAtomic(output, `${JSON.stringify(evidence, null, 2)}\n`);
	process.stdout.write(`${JSON.stringify({ output, mode: evidence.mode, candidate: evidence.candidate || null, status: evidence.baselineStatus || evidence.decision?.status }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(error => {
		process.stderr.write(`${error?.stack || error}\n`);
		process.exitCode = 1;
	});
}
