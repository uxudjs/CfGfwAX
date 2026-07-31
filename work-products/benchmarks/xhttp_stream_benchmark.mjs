import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIB = 1024;
const DEFAULT_TOTAL_BYTES = 16 * 1024 * 1024;
const DEFAULT_WARMUP = 2;
const DEFAULT_ROUNDS = 7;
const TARGET_SAMPLE_CPU_MS = 2000;
const MIN_SAMPLE_CPU_MS = 1500;
const MAX_SAMPLE_CPU_MS = 3500;
const CALIBRATION_SAMPLES = 3;
const MAX_CALIBRATION_STAGES = 8;
const MAX_CALIBRATION_ITERATIONS = 65536;
const STEADY_STATE_WINDOW = 5;
const REQUIRED_STEADY_STATE_WINDOWS = 3;
const MIN_STEADY_STATE_ROUNDS = 12;
const MAX_STEADY_STATE_ROUNDS = 24;
const MAX_STEADY_STATE_RECALIBRATIONS = 2;
const MAX_ISOLATED_PROFILE_ATTEMPTS = 2;
const MAX_MEASUREMENT_ROUND_MULTIPLIER = 2;
const CPU_STABILITY_LIMIT = 0.10;
const STEADY_STATE_CV_LIMIT = CPU_STABILITY_LIMIT;
const STEADY_STATE_TREND_LIMIT = CPU_STABILITY_LIMIT;
const CHUNK_SIZES = new Map([
	['64b', 64],
	['128b', 128],
	['256b', 256],
	['512b', 512],
	['1kib', KIB],
	['16kib', 16 * KIB],
	['64kib', 64 * KIB],
]);
const DIRECTIONS = ['uplink', 'downlink', 'bidirectional'];
const ALL_PROFILES = DIRECTIONS.flatMap(direction => [...CHUNK_SIZES.keys()].map(size => `${direction}-${size}`));
const FIXTURE_SEED = 0x9e3779b9;
const LEGACY_GRAIN_COPY = 'const output = pendingBuffer.subarray(0, pendingBytes).slice();';
const GRAIN_COPY_OBSERVER = '__xhttpBenchmarkGrainCopyObserver';

const workerInternalsPromises = new Map();

function sha256(data) {
	return createHash('sha256').update(data).digest('hex');
}

function positiveInteger(value, name) {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
	return parsed;
}

export function parseBenchmarkOptions(argv) {
	const options = {
		profile: 'all',
		warmup: DEFAULT_WARMUP,
		rounds: DEFAULT_ROUNDS,
		output: null,
		totalBytes: DEFAULT_TOTAL_BYTES,
		uplinkStrategy: 'auto',
		downlinkStrategy: 'auto',
		workerSource: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const value = argv[++i];
		if (value === undefined) throw new Error(`Missing value for ${flag}`);
		if (flag === '--profile') options.profile = value;
		else if (flag === '--warmup') options.warmup = positiveInteger(value, '--warmup');
		else if (flag === '--rounds') options.rounds = positiveInteger(value, '--rounds');
		else if (flag === '--output') options.output = value;
		else if (flag === '--total-bytes') options.totalBytes = positiveInteger(value, '--total-bytes');
		else if (flag === '--uplink-strategy') options.uplinkStrategy = value;
		else if (flag === '--downlink-strategy') options.downlinkStrategy = value;
		else if (flag === '--worker-source') options.workerSource = value;
		else throw new Error(`Unknown option: ${flag}`);
	}
	if (options.profile !== 'all' && !DIRECTIONS.includes(options.profile) && !ALL_PROFILES.includes(options.profile)) {
		throw new Error(`Unknown profile: ${options.profile}`);
	}
	if (!['auto', 'legacy', 'stream-pump', 'native'].includes(options.uplinkStrategy)) throw new Error(`Unknown uplink strategy: ${options.uplinkStrategy}`);
	if (!['auto', 'shared-grain', 'stream-pump', 'native'].includes(options.downlinkStrategy)) throw new Error(`Unknown downlink strategy: ${options.downlinkStrategy}`);
	return options;
}

export function instrumentLegacyGrainCopies(source) {
	if (!source.includes(LEGACY_GRAIN_COPY)) return source;
	return source.replace(
		LEGACY_GRAIN_COPY,
		`const outputView = pendingBuffer.subarray(0, pendingBytes); globalThis.${GRAIN_COPY_OBSERVER}?.(outputView.byteLength); const output = outputView.slice();`,
	);
}

export function createDeterministicFixture(totalBytes) {
	const bytes = new Uint8Array(positiveInteger(totalBytes, 'totalBytes'));
	let state = FIXTURE_SEED;
	for (let i = 0; i < bytes.byteLength; i++) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		bytes[i] = state & 0xff;
	}
	return { bytes, seed: FIXTURE_SEED, sha256: sha256(bytes) };
}

async function loadWorkerInternals(workerSource = null) {
	const sourceUrl = workerSource ? pathToFileURL(resolve(workerSource)) : new URL('../../_worker.js', import.meta.url);
	if (!workerInternalsPromises.has(sourceUrl.href)) {
		workerInternalsPromises.set(sourceUrl.href, (async () => {
			if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };
			const source = await readFile(sourceUrl, 'utf8');
			const exportNames = '创建上行写入队列, 创建下行Grain发送器, 转发XHTTP上行请求体, connectStreams';
			const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { ${exportNames} };`).toString('base64')}`;
			const instrumentedSource = instrumentLegacyGrainCopies(source);
			const proxyModuleUrl = `data:text/javascript;base64,${Buffer.from(`${instrumentedSource}\nexport { ${exportNames} };`).toString('base64')}`;
			return {
				source,
				module: await import(moduleUrl),
				proxyModule: instrumentedSource === source ? await import(moduleUrl) : await import(proxyModuleUrl),
			};
		})());
	}
	return workerInternalsPromises.get(sourceUrl.href);
}

function parseProfile(profile) {
	const separator = profile.lastIndexOf('-');
	if (separator < 0) throw new Error(`Unknown profile: ${profile}`);
	const direction = profile.slice(0, separator);
	const sizeName = profile.slice(separator + 1);
	const chunkBytes = CHUNK_SIZES.get(sizeName);
	if (!DIRECTIONS.includes(direction) || !chunkBytes) throw new Error(`Unknown profile: ${profile}`);
	return { direction, chunkBytes };
}

function createSink(expectedBytes, inputBuffer, { captureOutput, trackProxy }) {
	const captured = captureOutput ? new Uint8Array(expectedBytes) : null;
	const seenForeignBuffers = new WeakSet();
	const initialArrayBuffers = process.memoryUsage().arrayBuffers;
	let arrayBuffersPeakBytes = 0;
	let totalBytes = 0;
	let sends = 0;
	let orderToken = 0;
	let allocatedBuffersProxy = 0;
	let copiedBytesProxy = 0;

	const sampleMemory = () => {
		if (!trackProxy) return;
		arrayBuffersPeakBytes = Math.max(arrayBuffersPeakBytes, process.memoryUsage().arrayBuffers - initialArrayBuffers);
	};

	return {
		write(data) {
			const chunk = data instanceof Uint8Array
				? data
				: (data instanceof ArrayBuffer
					? new Uint8Array(data)
					: new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
			if (totalBytes + chunk.byteLength > expectedBytes) throw new Error('benchmark sink overflow');
			if (captured) captured.set(chunk, totalBytes);
			totalBytes += chunk.byteLength;
			sends++;
			orderToken = Math.imul(orderToken ^ chunk.byteLength, 16777619) >>> 0;
			if (chunk.byteLength) {
				orderToken = Math.imul(orderToken ^ chunk[0], 16777619) >>> 0;
				orderToken = Math.imul(orderToken ^ chunk[chunk.byteLength - 1], 16777619) >>> 0;
			}
			if (trackProxy && chunk.buffer !== inputBuffer) {
				copiedBytesProxy += chunk.byteLength;
				if (!seenForeignBuffers.has(chunk.buffer)) {
					seenForeignBuffers.add(chunk.buffer);
					allocatedBuffersProxy++;
				}
			}
			if ((sends & 63) === 0) sampleMemory();
		},
		finalize() {
			sampleMemory();
			if (totalBytes !== expectedBytes) throw new Error(`benchmark byte length mismatch: ${totalBytes}/${expectedBytes}`);
			return {
				output: captured ? { totalBytes, sha256: sha256(captured) } : { totalBytes, orderToken },
				proxy: { sends, allocatedBuffersProxy, copiedBytesProxy, arrayBuffersPeakBytes: Math.max(0, arrayBuffersPeakBytes) },
			};
		},
	};
}

function createChunkedReadable(bytes, chunkBytes, onRead) {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			onRead();
			if (offset >= bytes.byteLength) {
				controller.close();
				return;
			}
			const chunk = bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.byteLength));
			offset += chunk.byteLength;
			controller.enqueue(chunk);
		},
	});
}

async function pumpReadableToWritable(readable, writable) {
	const reader = readable.getReader();
	const writer = writable.getWriter();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value?.byteLength) await writer.write(value);
		}
		await writer.close();
	} finally {
		try { reader.releaseLock() } catch (e) { }
		try { writer.releaseLock() } catch (e) { }
	}
}

async function pipeNativeStreams(requestBody, remoteSocket, responseWritable) {
	await Promise.all([
		requestBody.pipeTo(remoteSocket.writable),
		remoteSocket.readable.pipeTo(responseWritable),
	]);
}

async function executeStreamPumpUplink(chunkBytes, fixture, options) {
	const sink = createSink(fixture.bytes.byteLength, fixture.bytes.buffer, options);
	let readerReadsProxy = 0;
	const requestBody = createChunkedReadable(fixture.bytes, chunkBytes, () => { readerReadsProxy++ });
	await pumpReadableToWritable(requestBody, new WritableStream({ write(chunk) { sink.write(chunk) } }));
	const result = sink.finalize();
	return {
		...result,
		proxy: {
			...result.proxy,
			handlerPath: 'worker-xhttp-stream-pump',
			inputViews: Math.ceil(fixture.bytes.byteLength / chunkBytes),
			readerReadsProxy,
			pumpWriteAwaitsProxy: Math.ceil(fixture.bytes.byteLength / chunkBytes),
			syncEnqueuesProxy: 0,
			completionPromisesProxy: 0,
			backpressureWaitsProxy: 0,
			flushAwaitsProxy: 0,
			nativePipe: false,
		},
	};
}

async function executeNativeUplink(chunkBytes, fixture, options) {
	const sink = createSink(fixture.bytes.byteLength, fixture.bytes.buffer, options);
	let readerReadsProxy = 0;
	const requestBody = createChunkedReadable(fixture.bytes, chunkBytes, () => { readerReadsProxy++ });
	await requestBody.pipeTo(new WritableStream({ write(chunk) { sink.write(chunk) } }));
	const result = sink.finalize();
	return {
		...result,
		proxy: {
			...result.proxy,
			handlerPath: 'worker-xhttp-native-pipe',
			inputViews: Math.ceil(fixture.bytes.byteLength / chunkBytes),
			readerReadsProxy,
			pumpWriteAwaitsProxy: 0,
			syncEnqueuesProxy: 0,
			completionPromisesProxy: 0,
			backpressureWaitsProxy: 0,
			flushAwaitsProxy: 0,
			nativePipe: true,
		},
	};
}

async function executeUplink(chunkBytes, fixture, options) {
	if (options.uplinkStrategy === 'stream-pump') return executeStreamPumpUplink(chunkBytes, fixture, options);
	if (options.uplinkStrategy === 'native') return executeNativeUplink(chunkBytes, fixture, options);
	const { 创建上行写入队列, 转发XHTTP上行请求体 } = (await loadWorkerInternals(options.workerSource)).module;
	const sink = createSink(fixture.bytes.byteLength, fixture.bytes.buffer, options);
	const writer = {
		write(data) {
			sink.write(data);
			return Promise.resolve();
		},
	};
	let closeError = null;
	const queue = 创建上行写入队列({
		获取写入器: () => writer,
		释放写入器() { },
		重试连接: null,
		关闭连接: error => { closeError = error },
		名称: 'XHTTP基准上行',
	});
	let inputViews = 0;
	let readerReadsProxy = 0;
	let pumpWriteAwaitsProxy = 0;
	let syncEnqueuesProxy = 0;
	let completionPromisesProxy = 0;
	let backpressureWaitsProxy = 0;
	let flushAwaitsProxy = 0;
	const usesBufferedXhttpPath = options.uplinkStrategy !== 'legacy'
		&& typeof queue.达到高水位 === 'function'
		&& typeof queue.等待低水位 === 'function';
	let offset = 0;
	const reader = {
		async read() {
			readerReadsProxy++;
			if (offset >= fixture.bytes.byteLength) return { done: true, value: undefined };
			const chunk = fixture.bytes.subarray(offset, Math.min(offset + chunkBytes, fixture.bytes.byteLength));
			offset += chunk.byteLength;
			inputViews++;
			return { done: false, value: chunk };
		},
	};
	const 写入远端 = chunk => {
		if (usesBufferedXhttpPath && chunk.byteLength < 64 * KIB) {
			if (!queue.写入(chunk, false)) throw new Error('benchmark queue rejected chunk');
			syncEnqueuesProxy++;
			if (queue.达到高水位()) {
				backpressureWaitsProxy++;
				pumpWriteAwaitsProxy++;
				return queue.等待低水位().then(() => true);
			}
			return true;
		}
		pumpWriteAwaitsProxy++;
		completionPromisesProxy++;
		return (typeof queue.直接写入并等待 === 'function'
			? queue.直接写入并等待(chunk, false)
			: queue.写入并等待(chunk, false));
	};
	await 转发XHTTP上行请求体(reader, 写入远端);
	flushAwaitsProxy++;
	await queue.等待空();
	if (closeError) throw closeError;
	const result = sink.finalize();
	return {
		...result,
		proxy: {
					...result.proxy,
					handlerPath: 'worker-xhttp-stream-one',
					inputViews,
					readerReadsProxy,
					pumpWriteAwaitsProxy,
					syncEnqueuesProxy,
					completionPromisesProxy,
					backpressureWaitsProxy,
					flushAwaitsProxy,
				},
	};
}

async function executeStreamPumpDownlink(chunkBytes, fixture, options) {
	const sink = createSink(fixture.bytes.byteLength, fixture.bytes.buffer, options);
	let readerReadsProxy = 0;
	const remoteReadable = createChunkedReadable(fixture.bytes, chunkBytes, () => { readerReadsProxy++ });
	await pumpReadableToWritable(remoteReadable, new WritableStream({ write(chunk) { sink.write(chunk) } }));
	const result = sink.finalize();
	return {
		...result,
		proxy: {
			...result.proxy,
			handlerPath: 'worker-xhttp-stream-pump',
			inputViews: Math.ceil(fixture.bytes.byteLength / chunkBytes),
			readerReadsProxy,
			pumpSendAwaitsProxy: Math.ceil(fixture.bytes.byteLength / chunkBytes),
			flushAwaitsProxy: 0,
			grainCopiedBytesProxy: 0,
			bufferReuseCapabilityProxy: false,
			downlinkStrategy: 'stream-pump',
			nativePipe: false,
		},
	};
}

async function executeNativeDownlink(chunkBytes, fixture, options) {
	const sink = createSink(fixture.bytes.byteLength, fixture.bytes.buffer, options);
	let readerReadsProxy = 0;
	const remoteReadable = createChunkedReadable(fixture.bytes, chunkBytes, () => { readerReadsProxy++ });
	await remoteReadable.pipeTo(new WritableStream({ write(chunk) { sink.write(chunk) } }));
	const result = sink.finalize();
	return {
		...result,
		proxy: {
			...result.proxy,
			handlerPath: 'worker-xhttp-native-pipe',
			inputViews: Math.ceil(fixture.bytes.byteLength / chunkBytes),
			readerReadsProxy,
			pumpSendAwaitsProxy: 0,
			flushAwaitsProxy: 0,
			grainCopiedBytesProxy: 0,
			bufferReuseCapabilityProxy: false,
			downlinkStrategy: 'native',
			nativePipe: true,
		},
	};
}

async function executeNativeBidirectional(chunkBytes, fixture, options) {
	const uplinkSink = createSink(fixture.bytes.byteLength, fixture.bytes.buffer, options);
	const downlinkSink = createSink(fixture.bytes.byteLength, fixture.bytes.buffer, options);
	let uplinkReads = 0;
	let downlinkReads = 0;
	const requestBody = createChunkedReadable(fixture.bytes, chunkBytes, () => { uplinkReads++ });
	const remoteSocket = {
		writable: new WritableStream({ write(chunk) { uplinkSink.write(chunk) } }),
		readable: createChunkedReadable(fixture.bytes, chunkBytes, () => { downlinkReads++ }),
	};
	await pipeNativeStreams(
		requestBody,
		remoteSocket,
		new WritableStream({ write(chunk) { downlinkSink.write(chunk) } }),
	);
	const uplink = uplinkSink.finalize();
	const downlink = downlinkSink.finalize();
	return {
		output: { uplink: uplink.output, downlink: downlink.output },
		proxy: {
			uplink: {
				...uplink.proxy,
				handlerPath: 'worker-xhttp-native-pipe',
				inputViews: Math.ceil(fixture.bytes.byteLength / chunkBytes),
				readerReadsProxy: uplinkReads,
				pumpWriteAwaitsProxy: 0,
				syncEnqueuesProxy: 0,
				completionPromisesProxy: 0,
				backpressureWaitsProxy: 0,
				flushAwaitsProxy: 0,
				nativePipe: true,
			},
			downlink: {
				...downlink.proxy,
				handlerPath: 'worker-xhttp-native-pipe',
				inputViews: Math.ceil(fixture.bytes.byteLength / chunkBytes),
				readerReadsProxy: downlinkReads,
				pumpSendAwaitsProxy: 0,
				flushAwaitsProxy: 0,
				grainCopiedBytesProxy: 0,
				bufferReuseCapabilityProxy: false,
				downlinkStrategy: 'native',
				nativePipe: true,
			},
		},
	};
}

async function executeDownlink(chunkBytes, fixture, options) {
	if (options.downlinkStrategy === 'stream-pump') return executeStreamPumpDownlink(chunkBytes, fixture, options);
	if (options.downlinkStrategy === 'native') return executeNativeDownlink(chunkBytes, fixture, options);
	const internals = await loadWorkerInternals(options.workerSource);
	const { connectStreams } = options.trackProxy ? internals.proxyModule : internals.module;
	const sink = createSink(fixture.bytes.byteLength, fixture.bytes.buffer, options);
	const webSocket = {
		readyState: WebSocket.OPEN,
		send: data => sink.write(data),
		close() { this.readyState = WebSocket.CLOSED },
	};
	let inputViews = 0;
	let readerReadsProxy = 0;
	let pumpSendAwaitsProxy = 0;
	let flushAwaitsProxy = 0;
	let grainCopiedBytesProxy = 0;
	let offset = 0;
	const reader = {
		async read(view) {
			readerReadsProxy++;
			if (offset >= fixture.bytes.byteLength) return { done: true, value: undefined };
			const byteLength = Math.min(chunkBytes, fixture.bytes.byteLength - offset);
			const chunk = fixture.bytes.subarray(offset, offset + byteLength);
			const value = view instanceof Uint8Array ? view.subarray(0, byteLength) : chunk;
			if (view instanceof Uint8Array) value.set(chunk);
			offset += byteLength;
			inputViews++;
			return { done: false, value };
		},
		async cancel() { },
		releaseLock() { },
	};
	const remoteSocket = {
		readable: { getReader: () => reader },
		close() { },
	};
	if (options.trackProxy) globalThis[GRAIN_COPY_OBSERVER] = bytes => { grainCopiedBytesProxy += bytes };
	try {
		const inboundTransport = options.downlinkStrategy === 'shared-grain' ? 'websocket' : 'xhttp';
		await connectStreams(remoteSocket, webSocket, null, null, 'direct', () => { }, inboundTransport);
		flushAwaitsProxy++;
	} finally {
		if (options.trackProxy) delete globalThis[GRAIN_COPY_OBSERVER];
	}
	const result = sink.finalize();
	return {
		...result,
		proxy: {
			...result.proxy,
			handlerPath: 'worker-xhttp-stream-one',
			inputViews,
			readerReadsProxy,
			pumpSendAwaitsProxy,
			flushAwaitsProxy,
			grainCopiedBytesProxy,
			bufferReuseCapabilityProxy: webSocket.发送后可复用缓冲 === true,
			downlinkStrategy: options.downlinkStrategy,
		},
	};
}

async function executeProfile(profile, fixture, options) {
	const { direction, chunkBytes } = parseProfile(profile);
	if (direction === 'uplink') return executeUplink(chunkBytes, fixture, options);
	if (direction === 'downlink') return executeDownlink(chunkBytes, fixture, options);
	if (options.uplinkStrategy === 'native' && options.downlinkStrategy === 'native') {
		return executeNativeBidirectional(chunkBytes, fixture, options);
	}
	const [uplink, downlink] = await Promise.all([
		executeUplink(chunkBytes, fixture, options),
		executeDownlink(chunkBytes, fixture, options),
	]);
	return {
		output: { uplink: uplink.output, downlink: downlink.output },
		proxy: { uplink: uplink.proxy, downlink: downlink.proxy },
	};
}

export async function runProfileOnce(profile, fixture, { trackProxy = false, workerSource = null, uplinkStrategy = 'auto', downlinkStrategy = 'auto' } = {}) {
	return executeProfile(profile, fixture, { captureOutput: true, trackProxy, workerSource, uplinkStrategy, downlinkStrategy });
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeRounds(rounds) {
	const cpuValues = rounds.map(round => round.cpuMs);
	const wallValues = rounds.map(round => round.wallMs);
	const cpuMeanMs = cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length;
	const variance = cpuValues.reduce((sum, value) => sum + ((value - cpuMeanMs) ** 2), 0) / cpuValues.length;
	return {
		cpuMedianMs: Number(median(cpuValues).toFixed(6)),
		cpuMeanMs: Number(cpuMeanMs.toFixed(6)),
		cpuCv: Number((Math.sqrt(variance) / cpuMeanMs).toFixed(6)),
		wallMedianMs: Number(median(wallValues).toFixed(6)),
	};
}

function calculateTrendRatio(values) {
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const meanIndex = (values.length - 1) / 2;
	const indexVariance = values.reduce((sum, _, index) => sum + ((index - meanIndex) ** 2), 0);
	const slope = values.reduce((sum, value, index) => sum + ((index - meanIndex) * (value - mean)), 0) / indexVariance;
	return Math.abs(slope * (values.length - 1) / mean);
}

export function planMeasurementWindow(rounds, requiredRounds = DEFAULT_ROUNDS, maxRounds = requiredRounds * MAX_MEASUREMENT_ROUND_MULTIPLIER) {
	if (!Array.isArray(rounds) || rounds.length < requiredRounds) {
		return { status: 'continue', reason: 'insufficient-measurement-rounds' };
	}
	const selectedStart = rounds.length - requiredRounds;
	const window = rounds.slice(selectedStart);
	const summary = summarizeRounds(window);
	const trendRatio = calculateTrendRatio(window.map(round => Number(round.cpuMs)));
	const result = {
		cpuCv: summary.cpuCv,
		trendRatio: Number(trendRatio.toFixed(6)),
		selectedStart,
		discardedRounds: selectedStart,
		windowSize: requiredRounds,
		cvLimit: CPU_STABILITY_LIMIT,
		trendLimit: STEADY_STATE_TREND_LIMIT,
	};
	const instabilityReason = trendRatio > STEADY_STATE_TREND_LIMIT
		? 'measurement-trend'
		: (summary.cpuCv > CPU_STABILITY_LIMIT ? 'measurement-variation' : null);
	if (!instabilityReason) return { ...result, status: 'ready', reason: null };
	if (rounds.length >= maxRounds) {
		return { ...result, status: 'limited', reason: 'max-measurement-rounds-reached', instabilityReason };
	}
	return { ...result, status: 'continue', reason: instabilityReason };
}

export function planSteadyStateWindow(samples, iterations, stableWindows = 0, maxRounds = MAX_STEADY_STATE_ROUNDS) {
	if (!Array.isArray(samples) || samples.length < STEADY_STATE_WINDOW) {
		return { status: 'continue', reason: 'insufficient-steady-state-samples', stableWindows: 0 };
	}
	const window = samples.slice(-STEADY_STATE_WINDOW);
	const cpuValues = window.map(sample => Number(sample.sampleCpuMs));
	const sampleCpuMeanMs = cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length;
	const variance = cpuValues.reduce((sum, value) => sum + ((value - sampleCpuMeanMs) ** 2), 0) / cpuValues.length;
	const cpuCv = Math.sqrt(variance) / sampleCpuMeanMs;
	const trendRatio = calculateTrendRatio(cpuValues);
	const sampleCpuMedianMs = median(cpuValues);
	const result = {
		cpuCv: Number(cpuCv.toFixed(6)),
		trendRatio: Number(trendRatio.toFixed(6)),
		sampleCpuMedianMs,
		windowSize: STEADY_STATE_WINDOW,
		cvLimit: STEADY_STATE_CV_LIMIT,
		trendLimit: STEADY_STATE_TREND_LIMIT,
	};
	const reason = trendRatio > STEADY_STATE_TREND_LIMIT
		? 'steady-state-trend'
		: (cpuCv > STEADY_STATE_CV_LIMIT ? 'steady-state-variation' : null);
	if (reason) {
		if (samples.length >= maxRounds) {
			return { ...result, status: 'limited', reason: 'max-steady-state-rounds-reached', stableWindows: 0 };
		}
		return { ...result, status: 'continue', reason, stableWindows: 0 };
	}
	const nextStableWindows = stableWindows + 1;
	if (nextStableWindows < REQUIRED_STEADY_STATE_WINDOWS) {
		return { ...result, status: 'continue', reason: 'confirming-steady-state', stableWindows: nextStableWindows };
	}
	if (sampleCpuMedianMs < MIN_SAMPLE_CPU_MS || sampleCpuMedianMs > MAX_SAMPLE_CPU_MS) {
		const nextIterations = Math.min(MAX_CALIBRATION_ITERATIONS, selectMeasurementIterations({
			sampleCpuMs: sampleCpuMedianMs,
			sampleWallMs: median(window.map(sample => Number(sample.sampleWallMs))),
		}, iterations));
		return {
			...result,
			status: 'recalibrate',
			reason: 'steady-state-outside-cpu-window',
			stableWindows: nextStableWindows,
			selectedIterations: iterations,
			nextIterations,
		};
	}
	return {
		...result,
		status: 'ready',
		reason: null,
		stableWindows: nextStableWindows,
		selectedIterations: iterations,
	};
}

export function summarizeStability(results, limit = CPU_STABILITY_LIMIT) {
	const profiles = results.map(({ profile, summary }) => ({
		profile,
		cpuCv: summary.cpuCv,
		passed: summary.cpuCv <= limit,
	}));
	const failedProfiles = profiles.filter(result => !result.passed);
	return {
		profile: profiles.length === 1 ? profiles[0].profile : 'all-selected',
		cpuCv: Math.max(...profiles.map(result => result.cpuCv)),
		limit,
		passed: failedProfiles.length === 0,
		profiles,
		failedProfiles: failedProfiles.map(result => result.profile),
	};
}

export function selectMeasurementIterations(calibration, currentIterations = 1) {
	const cpuMs = Number(calibration.sampleCpuMs);
	const wallMs = Number(calibration.sampleWallMs);
	const observedMs = cpuMs > 0 ? cpuMs : Math.max(wallMs, 0.001);
	return Math.max(1, Math.ceil(currentIterations * TARGET_SAMPLE_CPU_MS / observedMs));
}

export function planCalibrationStage(samples, iterations) {
	if (!Array.isArray(samples) || samples.length === 0) throw new Error('calibration samples are required');
	const sampleCpuMedianMs = median(samples.map(sample => Number(sample.sampleCpuMs)));
	const sampleWallMedianMs = median(samples.map(sample => Number(sample.sampleWallMs)));
	const result = {
		iterations,
		sampleCpuMedianMs,
		sampleWallMedianMs,
		targetCpuMs: TARGET_SAMPLE_CPU_MS,
		minCpuMs: MIN_SAMPLE_CPU_MS,
		maxCpuMs: MAX_SAMPLE_CPU_MS,
	};

	if (sampleCpuMedianMs >= MIN_SAMPLE_CPU_MS && sampleCpuMedianMs <= MAX_SAMPLE_CPU_MS) {
		return { ...result, status: 'ready', reason: null, selectedIterations: iterations };
	}
	if (sampleCpuMedianMs > MAX_SAMPLE_CPU_MS) {
		if (iterations === 1) {
			return { ...result, status: 'limited', reason: 'single-iteration-over-target', selectedIterations: 1 };
		}
		const nextIterations = Math.max(1, Math.floor(iterations * TARGET_SAMPLE_CPU_MS / sampleCpuMedianMs));
		return { ...result, status: 'continue', reason: null, nextIterations };
	}
	if (iterations >= MAX_CALIBRATION_ITERATIONS) {
		return {
			...result,
			status: 'limited',
			reason: 'max-iterations-reached',
			selectedIterations: MAX_CALIBRATION_ITERATIONS,
		};
	}

	const estimatedIterations = selectMeasurementIterations({
		sampleCpuMs: sampleCpuMedianMs,
		sampleWallMs: sampleWallMedianMs,
	}, iterations);
	return {
		...result,
		status: 'continue',
		reason: estimatedIterations > MAX_CALIBRATION_ITERATIONS ? 'max-iterations-selected' : null,
		nextIterations: Math.min(MAX_CALIBRATION_ITERATIONS, Math.max(iterations + 1, estimatedIterations)),
	};
}

async function measureRound(profile, fixture, iterations = 1, uplinkStrategy = 'auto', workerSource = null, downlinkStrategy = 'auto') {
	const cpuStart = process.cpuUsage();
	const wallStart = performance.now();
	let result;
	for (let i = 0; i < iterations; i++) {
		result = await executeProfile(profile, fixture, { captureOutput: false, trackProxy: false, uplinkStrategy, workerSource, downlinkStrategy });
	}
	const sampleWallMs = performance.now() - wallStart;
	const cpu = process.cpuUsage(cpuStart);
	const sampleCpuMs = (cpu.user + cpu.system) / 1000;
	return {
		cpuMs: Number((sampleCpuMs / iterations).toFixed(6)),
		wallMs: Number((sampleWallMs / iterations).toFixed(6)),
		sampleCpuMs: Number(sampleCpuMs.toFixed(6)),
		sampleWallMs: Number(sampleWallMs.toFixed(6)),
		iterations,
		downlinkStrategy,
		output: result.output,
	};
}

async function calibrateMeasurementIterations(profile, fixture, uplinkStrategy, workerSource, downlinkStrategy) {
	let iterations = 1;
	const stages = [];
	for (let stage = 0; stage < MAX_CALIBRATION_STAGES; stage++) {
		const samples = [];
		for (let i = 0; i < CALIBRATION_SAMPLES; i++) {
			samples.push(await measureRound(profile, fixture, iterations, uplinkStrategy, workerSource, downlinkStrategy));
		}
		const decision = planCalibrationStage(samples, iterations);
		stages.push({ ...decision, samples });
		if (decision.status !== 'continue') {
			return {
				status: decision.status,
				reason: decision.reason,
				targetCpuMs: TARGET_SAMPLE_CPU_MS,
				minCpuMs: MIN_SAMPLE_CPU_MS,
				maxCpuMs: MAX_SAMPLE_CPU_MS,
				selectedIterations: decision.selectedIterations,
				sampleCpuMs: decision.sampleCpuMedianMs,
				sampleWallMs: decision.sampleWallMedianMs,
				iterations: decision.selectedIterations,
				output: samples[samples.length - 1].output,
				stages,
			};
		}
		iterations = decision.nextIterations;
	}

	const lastStage = stages[stages.length - 1];
	return {
		status: 'limited',
		reason: 'max-calibration-stages-reached',
		targetCpuMs: TARGET_SAMPLE_CPU_MS,
		minCpuMs: MIN_SAMPLE_CPU_MS,
		maxCpuMs: MAX_SAMPLE_CPU_MS,
		selectedIterations: lastStage.iterations,
		sampleCpuMs: lastStage.sampleCpuMedianMs,
		sampleWallMs: lastStage.sampleWallMedianMs,
		iterations: lastStage.iterations,
		output: lastStage.samples[lastStage.samples.length - 1].output,
		stages,
	};
}

async function stabilizeMeasurementIterations(profile, fixture, iterations, minimumWarmups, uplinkStrategy, workerSource, downlinkStrategy) {
	const maxRounds = Math.max(MAX_STEADY_STATE_ROUNDS, minimumWarmups);
	const requiredRounds = Math.max(MIN_STEADY_STATE_ROUNDS, minimumWarmups);
	const warmups = [];
	let stableWindows = 0;
	let decision = null;
	for (let round = 0; round < maxRounds; round++) {
		warmups.push(await measureRound(profile, fixture, iterations, uplinkStrategy, workerSource, downlinkStrategy));
		if (warmups.length < requiredRounds) continue;
		decision = planSteadyStateWindow(warmups, iterations, stableWindows, maxRounds);
		stableWindows = decision.stableWindows;
		if (decision.status !== 'continue') return { ...decision, warmups };
	}
	return {
		...(decision || {}),
		status: 'limited',
		reason: 'max-steady-state-rounds-reached',
		stableWindows,
		warmups,
	};
}

function selectedProfiles(profile) {
	if (profile === 'all') return ALL_PROFILES;
	if (DIRECTIONS.includes(profile)) return ALL_PROFILES.filter(candidate => candidate.startsWith(`${profile}-`));
	return [profile];
}

export function selectProfileExecutionMode(profile) {
	return selectedProfiles(profile).length === 1 ? 'in-process' : 'isolated-processes';
}

export function planIsolatedProfileAttempt(exitStatus, stderr, attempt) {
	if (exitStatus === 0) return { status: 'complete', reason: null };
	const steadyStateUnavailable = String(stderr || '').includes('steady state unavailable: max-steady-state-rounds-reached');
	const reason = steadyStateUnavailable ? 'steady-state-unavailable' : 'child-process-failed';
	return {
		status: steadyStateUnavailable && attempt < MAX_ISOLATED_PROFILE_ATTEMPTS ? 'retry' : 'failed',
		reason,
	};
}

export function validateIsolatedFingerprints(results) {
	if (!Array.isArray(results) || results.length === 0) throw new Error('isolated benchmark results are required');
	const profileProcesses = [];
	const processIds = new Set();
	let environmentFingerprint = null;
	for (const result of results) {
		const fingerprint = result.environmentFingerprint || {};
		const processId = fingerprint.processId;
		if (!Number.isSafeInteger(processId) || processId <= 0) throw new Error(`${result.profile}: invalid process id`);
		if (processIds.has(processId)) throw new Error(`${result.profile}: profiles must use a distinct process`);
		processIds.add(processId);
		profileProcesses.push({ profile: result.profile, processId });
		const comparable = { ...fingerprint };
		delete comparable.processId;
		if (!environmentFingerprint) environmentFingerprint = comparable;
		else if (JSON.stringify(comparable) !== JSON.stringify(environmentFingerprint)) {
			throw new Error(`${result.profile}: environment fingerprint mismatch`);
		}
	}
	return { environmentFingerprint, profileProcesses };
}

function readPowerMode() {
	if (platform() !== 'win32') return 'unavailable';
	const result = spawnSync('powercfg', ['/getactivescheme'], { encoding: 'utf8', windowsHide: true });
	if (result.status !== 0) return 'unavailable';
	const guid = result.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase();
	if (!guid) return 'unavailable';
	const knownModes = {
		'381b4222-f694-41f0-9685-ff5bb260df2e': 'balanced',
		'8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c': 'high-performance',
		'a1841308-3541-4fab-bc81-f71556f20b4a': 'power-saver',
		'e9a42b02-d5df-448d-aa00-03f14749eb61': 'ultimate-performance',
	};
	return `${knownModes[guid] || 'custom'}:${guid}`;
}

async function environmentFingerprint(fixture, workerSource) {
	const benchmarkSource = await readFile(new URL('./xhttp_stream_benchmark.mjs', import.meta.url));
	const cpuList = cpus();
	return {
		node: process.version,
		platform: platform(),
		arch: arch(),
		cpuModel: cpuList[0]?.model || 'unknown',
		logicalCores: cpuList.length || 'unknown',
		powerMode: readPowerMode(),
		processId: process.pid,
		benchmarkSha256: sha256(benchmarkSource),
		fixtureSha256: fixture.sha256,
		workerSourceSha256: sha256(workerSource),
	};
}

function normalizeBenchmarkOptions(options) {
	return {
		...parseBenchmarkOptions([]),
		...options,
		warmup: positiveInteger(options.warmup ?? DEFAULT_WARMUP, 'warmup'),
		rounds: positiveInteger(options.rounds ?? DEFAULT_ROUNDS, 'rounds'),
		totalBytes: positiveInteger(options.totalBytes ?? DEFAULT_TOTAL_BYTES, 'totalBytes'),
	};
}

async function runBenchmarkInProcess(normalized) {
	const profiles = selectedProfiles(normalized.profile);
	const fixture = createDeterministicFixture(normalized.totalBytes);
	const { source: workerSource } = await loadWorkerInternals(normalized.workerSource);
	const results = [];

	for (const profile of profiles) {
		await measureRound(profile, fixture, 1, normalized.uplinkStrategy, normalized.workerSource, normalized.downlinkStrategy);
		const calibration = await calibrateMeasurementIterations(profile, fixture, normalized.uplinkStrategy, normalized.workerSource, normalized.downlinkStrategy);
		let measurementIterations = calibration.selectedIterations;
		const steadyStatePhases = [];
		let steadyState = null;
		for (let attempt = 0; attempt <= MAX_STEADY_STATE_RECALIBRATIONS; attempt++) {
			steadyState = await stabilizeMeasurementIterations(
				profile,
				fixture,
				measurementIterations,
				normalized.warmup,
				normalized.uplinkStrategy,
				normalized.workerSource,
				normalized.downlinkStrategy,
			);
			steadyStatePhases.push({ ...steadyState, iterations: measurementIterations });
			if (steadyState.status === 'ready') break;
			if (steadyState.status !== 'recalibrate') {
				throw Object.assign(new Error(`${profile}: steady state unavailable: ${steadyState.reason}`), { steadyState });
			}
			if (attempt === MAX_STEADY_STATE_RECALIBRATIONS) {
				throw Object.assign(new Error(`${profile}: steady state unavailable: max-steady-state-recalibrations-reached`), {
					steadyState: { ...steadyState, status: 'limited', reason: 'max-steady-state-recalibrations-reached' },
				});
			}
			measurementIterations = steadyState.nextIterations;
		}
		const warmups = steadyStatePhases.flatMap(phase => phase.warmups);
		const measurementRounds = [];
		const enforceMeasurementStability = normalized.enforceMeasurementStability !== false;
		const maxMeasurementRounds = enforceMeasurementStability
			? normalized.rounds * MAX_MEASUREMENT_ROUND_MULTIPLIER
			: normalized.rounds;
		let measurement = null;
		while (measurementRounds.length < maxMeasurementRounds) {
			measurementRounds.push(await measureRound(profile, fixture, measurementIterations, normalized.uplinkStrategy, normalized.workerSource, normalized.downlinkStrategy));
			if (!enforceMeasurementStability && measurementRounds.length >= normalized.rounds) {
				measurement = {
					status: 'disabled',
					reason: 'explicitly-disabled',
					selectedStart: 0,
					discardedRounds: 0,
					windowSize: normalized.rounds,
				};
				break;
			}
			measurement = planMeasurementWindow(measurementRounds, normalized.rounds, maxMeasurementRounds);
			if (measurement.status === 'ready') break;
			if (measurement.status === 'limited') {
				throw Object.assign(new Error(`${profile}: measurement state unavailable: ${measurement.reason}`), { measurement, measurementRounds });
			}
		}
		const rounds = measurementRounds.slice(measurement.selectedStart);
		const proxyRun = await executeProfile(profile, fixture, { captureOutput: false, trackProxy: true, uplinkStrategy: normalized.uplinkStrategy, workerSource: normalized.workerSource, downlinkStrategy: normalized.downlinkStrategy });
		const correctnessRun = await executeProfile(profile, fixture, { captureOutput: true, trackProxy: false, uplinkStrategy: normalized.uplinkStrategy, workerSource: normalized.workerSource, downlinkStrategy: normalized.downlinkStrategy });
		const outputList = profile.startsWith('bidirectional')
			? [correctnessRun.output.uplink, correctnessRun.output.downlink]
			: [correctnessRun.output];
		for (const output of outputList) {
			if (output.totalBytes !== fixture.bytes.byteLength || output.sha256 !== fixture.sha256) {
				throw new Error(`${profile} output mismatch`);
			}
		}
		results.push({
			profile,
			chunkBytes: parseProfile(profile).chunkBytes,
			calibration,
			steadyState: {
				status: steadyState.status,
				reason: steadyState.reason,
				stableWindows: steadyState.stableWindows,
				cpuCv: steadyState.cpuCv,
				trendRatio: steadyState.trendRatio,
				sampleCpuMedianMs: steadyState.sampleCpuMedianMs,
				phases: steadyStatePhases,
			},
			measurementIterations,
			warmups,
			measurement,
			measurementRounds,
			rounds,
			summary: summarizeRounds(rounds),
			output: correctnessRun.output,
			proxy: proxyRun.proxy,
			processId: process.pid,
		});
	}

	const stability = summarizeStability(results);
	const result = {
		schemaVersion: 1,
		capturedAt: new Date().toISOString(),
		config: {
			profile: normalized.profile,
			warmup: normalized.warmup,
			rounds: normalized.rounds,
			totalBytesPerDirection: normalized.totalBytes,
			chunkBytes: [...CHUNK_SIZES.values()],
			cpuMeasurementObserver: 'off',
			forcedGcBetweenRounds: false,
			cpuSampleTargetMs: TARGET_SAMPLE_CPU_MS,
			cpuSampleWindowMs: [MIN_SAMPLE_CPU_MS, MAX_SAMPLE_CPU_MS],
			steadyStateWindow: STEADY_STATE_WINDOW,
			minSteadyStateRounds: MIN_STEADY_STATE_ROUNDS,
			requiredSteadyStateWindows: REQUIRED_STEADY_STATE_WINDOWS,
			maxSteadyStateRounds: MAX_STEADY_STATE_ROUNDS,
			maxMeasurementRoundMultiplier: MAX_MEASUREMENT_ROUND_MULTIPLIER,
			measurementStability: normalized.enforceMeasurementStability === false ? 'disabled' : 'required',
			steadyStateCvLimit: STEADY_STATE_CV_LIMIT,
			steadyStateTrendLimit: STEADY_STATE_TREND_LIMIT,
			uplinkStrategy: normalized.uplinkStrategy,
			downlinkStrategy: normalized.downlinkStrategy,
			workerSource: normalized.workerSource ? 'provided' : 'default',
			profileIsolation: 'in-process',
		},
		environmentFingerprint: await environmentFingerprint(fixture, workerSource),
		stability,
		profiles: results,
	};
	if (normalized.enforceStability !== false && !stability.passed) {
		const failures = stability.profiles
			.filter(profile => !profile.passed)
			.map(profile => `${profile.profile}=${profile.cpuCv}`)
			.join(', ');
		throw Object.assign(new Error(`CPU coefficient of variation exceeds ${stability.limit}: ${failures}`), { benchmarkResult: result });
	}
	return result;
}

function runIsolatedProfile(profile, normalized) {
	const scriptPath = fileURLToPath(import.meta.url);
	const args = [
		scriptPath,
		'--profile', profile,
		'--warmup', `${normalized.warmup}`,
		'--rounds', `${normalized.rounds}`,
		'--total-bytes', `${normalized.totalBytes}`,
		'--uplink-strategy', normalized.uplinkStrategy,
		'--downlink-strategy', normalized.downlinkStrategy,
	];
	if (normalized.workerSource) args.push('--worker-source', normalized.workerSource);
	for (let attempt = 1; attempt <= MAX_ISOLATED_PROFILE_ATTEMPTS; attempt++) {
		const child = spawnSync(process.execPath, args, {
			encoding: 'utf8',
			env: { ...process.env, XHTTP_BENCHMARK_CHILD: '1' },
			maxBuffer: 16 * 1024 * 1024,
			windowsHide: true,
		});
		const decision = planIsolatedProfileAttempt(child.status, child.stderr, attempt);
		if (decision.status === 'retry') continue;
		if (decision.status === 'failed') {
			const failure = [child.stderr, child.error?.message].filter(Boolean).join('\n').trim();
			throw new Error(`${profile}: isolated benchmark failed: ${failure || `exit ${child.status ?? 'unknown'}`}`);
		}
		const result = JSON.parse(child.stdout);
		if (result.profiles.length !== 1 || result.profiles[0].profile !== profile) {
			throw new Error(`${profile}: isolated benchmark returned unexpected profile`);
		}
		return { ...result, isolationAttempts: attempt };
	}
	throw new Error(`${profile}: isolated benchmark attempts exhausted`);
}

async function runBenchmarkIsolated(normalized) {
	const profiles = selectedProfiles(normalized.profile);
	const childResults = profiles.map(profile => ({
		profile,
		...runIsolatedProfile(profile, normalized),
	}));
	const { environmentFingerprint, profileProcesses } = validateIsolatedFingerprints(childResults);
	const results = childResults.map(result => result.profiles[0]);
	const stability = summarizeStability(results);
	const result = {
		schemaVersion: 1,
		capturedAt: new Date().toISOString(),
		config: {
			...childResults[0].config,
			profile: normalized.profile,
			profileIsolation: 'isolated-processes',
			maxIsolatedProfileAttempts: MAX_ISOLATED_PROFILE_ATTEMPTS,
		},
		environmentFingerprint,
		profileProcesses,
		profileAttempts: childResults.map(result => ({ profile: result.profile, attempts: result.isolationAttempts })),
		stability,
		profiles: results,
	};
	if (normalized.enforceStability !== false && !stability.passed) {
		const failures = stability.profiles
			.filter(profile => !profile.passed)
			.map(profile => `${profile.profile}=${profile.cpuCv}`)
			.join(', ');
		throw Object.assign(new Error(`CPU coefficient of variation exceeds ${stability.limit}: ${failures}`), { benchmarkResult: result });
	}
	return result;
}

export async function runBenchmark(options) {
	const normalized = normalizeBenchmarkOptions(options);
	return selectProfileExecutionMode(normalized.profile) === 'isolated-processes'
		? runBenchmarkIsolated(normalized)
		: runBenchmarkInProcess(normalized);
}

async function main() {
	const options = parseBenchmarkOptions(process.argv.slice(2));
	if (process.env.XHTTP_BENCHMARK_CHILD === '1') options.enforceStability = false;
	let result;
	try {
		result = await runBenchmark(options);
	} catch (error) {
		if (options.output && error.benchmarkResult) {
			await writeFile(options.output, `${JSON.stringify(error.benchmarkResult, null, 2)}\n`);
		}
		throw error;
	}
	if (options.output) await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`);
	const display = options.output
		? {
			output: options.output,
			stability: result.stability,
			profiles: result.profiles.map(({ profile, summary }) => ({ profile, summary })),
		}
		: result;
	process.stdout.write(`${JSON.stringify(display, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(error => {
		process.stderr.write(`${error?.stack || error}\n`);
		process.exitCode = 1;
	});
}
