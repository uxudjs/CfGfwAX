import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import * as benchmarkModule from '../benchmarks/ws_grpc_stream_benchmark.mjs';

const {
	CANDIDATE_MATRIX,
	PROFILE_TIMEOUT_MS,
	PROFILE_MATRIX,
	PROFILE_MANIFEST,
	appendCandidatePhase,
	analyzeSteadyState,
	calibrateMeasurementIterations,
	calculateBaselineDecision,
	calculateCandidateDecision,
	calculateMeasurementWindow,
	createDeterministicFixture,
	currentEnvironment,
	instrumentWorkerMetrics,
	measureProfileMetrics,
	parseBenchmarkOptions,
	runChildProcess,
	runProfileOnce,
	runSteadyMeasurement,
	runTwoProcesses,
	selectFormalMeasurement,
	validateEvidence,
	withTimeout,
	writeEvidenceAtomic,
} = benchmarkModule;

const sha = char => char.repeat(64);

function profileResult(profile, cpuMs = 100, wallMs = 100, cpuCv = 0) {
	const metrics = {
		sourceBytes: profile.includes('-bidirectional-') ? 2 * 1024 * 1024 : 1024 * 1024,
		copiedBytes: 1024,
		copyOperations: 4,
		allocatedBytes: 2048,
		writes: 4,
		sends: 4,
		peakQueuedBytes: 1024,
	};
	return {
		profile,
		status: 'ready',
		calibration: { status: 'ready', selectedIterations: 20, trace: [] },
		cpuCv,
		rawRounds: [
			{ cpuMs: cpuMs * (1 - cpuCv), wallMs, cpuTotalMs: cpuMs * (1 - cpuCv) * 20, wallTotalMs: wallMs * 20, iterations: 20 },
			{ cpuMs: cpuMs * (1 + cpuCv), wallMs, cpuTotalMs: cpuMs * (1 + cpuCv) * 20, wallTotalMs: wallMs * 20, iterations: 20 },
		],
		metrics,
		summary: { cpuMedianMs: cpuMs, wallMedianMs: wallMs, ...metrics },
	};
}

function run(phase, pairId, workerSha256, overrides = {}) {
	const profiles = PROFILE_MATRIX.map(({ id }) => profileResult(id, overrides[id]?.cpu ?? 100, overrides[id]?.wall ?? 100, overrides[id]?.cv ?? 0));
	return {
		runId: `${phase}-${pairId}-unique`,
		pairId,
		phase,
		status: 'ready',
		workerSha256,
		actualWorkerHotPath: true,
		candidateHotPath: phase === 'candidate'
			? { candidate: 'grpc-parser', profile: 'grpc-upload-fragmented-64b', hits: 1, workerSha256 }
			: null,
		environment: { node: process.version, platform: process.platform, arch: process.arch, cpuModel: 'synthetic-test-cpu' },
		fingerprints: { benchmarkSha256: sha('a'), fixtureSha256: sha('b'), profileMatrixSha256: sha('c'), workerSha256 },
		calibration: { status: 'ready', selectedIterations: Object.fromEntries(profiles.map(profile => [profile.profile, 20])) },
		profiles,
	};
}

function baseEvidence(candidate = 'grpc-parser') {
	return {
		schemaVersion: 1,
		kind: 'ws-grpc-benchmark',
		mode: 'candidate',
		candidate,
		config: {
			totalBytesPerDirection: 1024 * 1024,
			profileManifest: PROFILE_MANIFEST,
			cpuCvLimit: 0.1,
			metricDefinitionVersion: 1,
		},
		environment: { node: process.version, platform: process.platform, arch: process.arch, cpuModel: 'synthetic-test-cpu' },
		fingerprints: { benchmarkSha256: sha('a'), fixtureSha256: sha('b'), profileMatrixSha256: sha('c') },
		predecessorRuns: [],
		candidateRuns: [],
	};
}

test('profile 与候选矩阵固定协议、方向、块大小及判定范围', () => {
	const normal = PROFILE_MATRIX.filter(profile => profile.variant === 'stream');
	assert.equal(PROFILE_MANIFEST.length, 32);
	assert.deepEqual(PROFILE_MANIFEST, PROFILE_MATRIX.map(({ id, protocol, direction, chunkBytes, variant }) => ({ id, protocol, direction, chunkBytes, variant })));
	assert.deepEqual([...new Set(normal.map(profile => profile.protocol))], ['ws', 'grpc']);
	for (const protocol of ['ws', 'grpc']) {
		for (const direction of ['upload', 'download', 'bidirectional']) {
			assert.deepEqual(
				normal.filter(profile => profile.protocol === protocol && profile.direction === direction).map(profile => profile.chunkBytes),
				[64, 256, 1024, 16 * 1024, 64 * 1024],
			);
		}
	}
	assert.ok(PROFILE_MATRIX.some(profile => profile.id === 'grpc-upload-fragmented-64b'));
	assert.ok(PROFILE_MATRIX.some(profile => profile.id === 'grpc-upload-multiframe-256b'));
	assert.deepEqual(CANDIDATE_MATRIX.map(candidate => candidate.id), ['grpc-parser', 'grpc-uplink-watermark', 'grpc-buffer-reuse', 'ws-uplink-watermark']);
	for (const candidate of CANDIDATE_MATRIX) {
		assert.ok(PROFILE_MATRIX.some(profile => profile.id === candidate.primary));
		assert.ok(PROFILE_MATRIX.some(profile => profile.id === candidate.supporting));
		assert.ok(candidate.nonTargets.length >= 1);
	}
});

test('CLI 固定 1 MiB、两次独立运行与两阶段候选合同', () => {
	assert.throws(() => parseBenchmarkOptions(['--total-bytes', '1024']), /formal benchmark config is fixed/);
	assert.equal(parseBenchmarkOptions(['--profile', 'ws-upload-64b', '--total-bytes', '1024']).totalBytes, 1024);
	assert.deepEqual(parseBenchmarkOptions([]), {
		profile: 'all',
		totalBytes: 1024 * 1024,
		warmup: 2,
		rounds: 7,
		runs: 2,
		candidate: null,
		phase: null,
		output: null,
		evidence: null,
		workerSource: null,
		help: false,
	});
	assert.throws(() => parseBenchmarkOptions(['--calibrate']), /Unknown option/);
	assert.throws(() => parseBenchmarkOptions(['--profile', 'grpc-download-64b', '--output', 'evidence.json']), /diagnostic-only/);
	assert.equal(parseBenchmarkOptions(['--profile', 'grpc-download-64b']).profile, 'grpc-download-64b');
	assert.throws(() => parseBenchmarkOptions(['--runs', '1']), /--runs must be 2/);
	assert.throws(() => parseBenchmarkOptions(['--candidate', 'unknown', '--phase', 'predecessor']), /Unknown candidate/);
	assert.throws(() => parseBenchmarkOptions(['--candidate', 'grpc-parser']), /--phase/);
});

test('实际 Worker handler 覆盖 WS/gRPC 三个方向与 gRPC 分片热路径', async () => {
	const fixture = createDeterministicFixture(4096);
	for (const profile of [
		'ws-upload-64b',
		'ws-download-256b',
		'ws-bidirectional-1kib',
		'grpc-upload-fragmented-64b',
		'grpc-upload-multiframe-256b',
		'grpc-download-256b',
		'grpc-bidirectional-1kib',
	]) {
		const result = await runProfileOnce(profile, fixture);
		assert.equal(result.actualWorkerHotPath, true);
		const outputs = profile.includes('bidirectional') ? [result.output.upload, result.output.download] : [result.output];
		for (const output of outputs) {
			assert.equal(output.totalBytes, fixture.bytes.byteLength, `${profile}: byte length`);
			assert.equal(output.sha256, fixture.sha256, `${profile}: SHA-256`);
		}
	}
});

test('真实热路径计量区分 source、复制、分配、写入、发送与峰值队列', async () => {
	const downloadFixture = createDeterministicFixture(1024 * 1024);
	const grpcDownload = await measureProfileMetrics('grpc-download-64b', downloadFixture);
	assert.equal(grpcDownload.sourceBytes, downloadFixture.bytes.byteLength);
	assert.ok(grpcDownload.copiedBytes > downloadFixture.bytes.byteLength, 'gRPC download 必须计入 payload 与封帧/合并复制');
	assert.ok(grpcDownload.copyOperations > 0);
	assert.ok(grpcDownload.allocatedBytes > 0);
	assert.equal(grpcDownload.writes, 0);
	assert.ok(grpcDownload.sends > 0);
	assert.ok(grpcDownload.peakQueuedBytes > 0);

	const fixture = createDeterministicFixture(4096);
	const wsUpload = await measureProfileMetrics('ws-upload-64b', fixture);
	assert.equal(wsUpload.sourceBytes, fixture.bytes.byteLength);
	assert.ok(wsUpload.writes > 0);
	assert.ok(wsUpload.peakQueuedBytes > 0);
	const bidirectional = await measureProfileMetrics('grpc-bidirectional-1kib', fixture);
	assert.equal(bidirectional.sourceBytes, fixture.bytes.byteLength * 2);
	assert.ok(bidirectional.writes > 0);
	assert.ok(bidirectional.sends > 0);
});

test('Worker 计量插桩点源码形状漂移时 fail-closed', async () => {
	const workerSource = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
	assert.doesNotThrow(() => instrumentWorkerMetrics(workerSource));
	const drifted = workerSource.replace('pending = pending.slice(frameSize);', 'pending = pending.subarray(frameSize);');
	assert.throws(() => instrumentWorkerMetrics(drifted), /metric instrumentation point .* expected/);
});

test('候选 phase 拒绝未接线 Worker，predecessor 可记录当前源码', async () => {
	const workerSource = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
	const evidence = appendCandidatePhase(baseEvidence(), 'predecessor', [run('predecessor', 1, sha('d')), run('predecessor', 2, sha('d'))], { workerSource });
	assert.equal(evidence.predecessorRuns.length, 2);
	assert.throws(
		() => {
			const candidateRuns = [run('candidate', 1, sha('e')), run('candidate', 2, sha('e'))];
			for (const candidateRun of candidateRuns) candidateRun.candidateHotPath = null;
			appendCandidatePhase(evidence, 'candidate', candidateRuns, { workerSource });
		},
		/candidate hot path evidence/,
	);
});

test('候选运行时证明拒绝只含未调用 marker 的 Worker', async () => {
	assert.equal(typeof benchmarkModule.verifyCandidateHotPath, 'function');
	const workerSource = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
	const deadMarkerSource = `${workerSource}\nfunction 创建GRPC增量帧解析器() { return null; }\n`;
	await assert.rejects(
		() => benchmarkModule.verifyCandidateHotPath('grpc-parser', { workerSourceText: deadMarkerSource }),
		/candidate hot path was not executed/,
	);
});

test('schema 拒绝缺失哈希、非有限数、高 CV 伪 ready、未知协议与敏感字段', () => {
	const evidence = baseEvidence();
	evidence.predecessorRuns = [run('predecessor', 1, sha('d')), run('predecessor', 2, sha('d'))];
	assert.doesNotThrow(() => validateEvidence(evidence, { requireCompleteCandidate: false }));

	const missingHash = structuredClone(evidence);
	delete missingHash.fingerprints.fixtureSha256;
	assert.throws(() => validateEvidence(missingHash, { requireCompleteCandidate: false }), /fixtureSha256/);
	const notFinite = structuredClone(evidence);
	notFinite.predecessorRuns[0].profiles[0].summary.cpuMedianMs = Infinity;
	assert.throws(() => validateEvidence(notFinite, { requireCompleteCandidate: false }), /finite/);
	const highCv = structuredClone(evidence);
	highCv.predecessorRuns[0].profiles[0].cpuCv = 0.11;
	assert.throws(() => validateEvidence(highCv, { requireCompleteCandidate: false }), /cpuCv mismatch/);
	const forgedLimited = structuredClone(evidence);
	forgedLimited.predecessorRuns[0].profiles[0].status = 'limited';
	assert.throws(() => validateEvidence(forgedLimited, { requireCompleteCandidate: false }), /profile status mismatch/);
	const forgedSummary = structuredClone(evidence);
	forgedSummary.predecessorRuns[0].profiles[0].summary.cpuMedianMs = 1;
	assert.throws(() => validateEvidence(forgedSummary, { requireCompleteCandidate: false }), /summary mismatch/);
	const missingMetric = structuredClone(evidence);
	const missingRawTotal = structuredClone(evidence);
	delete missingRawTotal.predecessorRuns[0].profiles[0].rawRounds[0].cpuTotalMs;
	assert.throws(() => validateEvidence(missingRawTotal, { requireCompleteCandidate: false }), /raw total mismatch/);
	delete missingMetric.predecessorRuns[0].profiles[0].metrics.allocatedBytes;
	assert.throws(() => validateEvidence(missingMetric, { requireCompleteCandidate: false }), /metric set mismatch/);
	const forgedMetric = structuredClone(evidence);
	forgedMetric.predecessorRuns[0].profiles[0].metrics.copiedBytes++;
	assert.throws(() => validateEvidence(forgedMetric, { requireCompleteCandidate: false }), /summary mismatch/);
	const unknownProtocol = structuredClone(evidence);
	unknownProtocol.config.profileManifest[0].id = 'smtp-upload-64b';
	assert.throws(() => validateEvidence(unknownProtocol, { requireCompleteCandidate: false }), /profile matrix mismatch/);
	const sensitive = structuredClone(evidence);
	sensitive.credentials = 'do-not-record';
	assert.throws(() => validateEvidence(sensitive, { requireCompleteCandidate: false }), /sensitive field/);
});

test('schema 从原始轮次重算并拒绝被覆写的候选 decision', () => {
	const workerSource = 'function 创建GRPC增量帧解析器() {}';
	let evidence = appendCandidatePhase(baseEvidence(), 'predecessor', [run('predecessor', 1, sha('d')), run('predecessor', 2, sha('d'))], { workerSource });
	const candidate = CANDIDATE_MATRIX.find(item => item.id === 'grpc-parser');
	const improvements = Object.fromEntries([
		[candidate.primary, { cpu: 89 }],
		[candidate.supporting, { cpu: 103, wall: 103 }],
		...candidate.nonTargets.map(id => [id, { cpu: 104, wall: 104 }]),
	]);
	evidence = appendCandidatePhase(evidence, 'candidate', [run('candidate', 1, sha('e'), improvements), run('candidate', 2, sha('e'), improvements)], { workerSource });
	evidence.decision.status = 'NO-GO';
	assert.throws(() => validateEvidence(evidence), /decision mismatch/);
});

test('子进程证据记录真实校准迭代数', () => {
	const benchmarkPath = fileURLToPath(new URL('../benchmarks/ws_grpc_stream_benchmark.mjs', import.meta.url));
	const child = spawnSync(process.execPath, [
		benchmarkPath,
		'--child-run', '1',
		'--profile', 'ws-upload-64kib',
		'--total-bytes', '1024',
		'--warmup', '1',
		'--rounds', '2',
	], { encoding: 'utf8', windowsHide: true });
	assert.equal(child.status, 0, child.stderr);
	const result = JSON.parse(child.stdout);
	const profile = result.profiles[0];
	assert.ok(profile.rawRounds[0].iterations > 1);
	assert.equal(result.calibration.selectedIterations[profile.profile], profile.rawRounds[0].iterations);
});

test('predecessor 不可覆写，跨阶段漂移与 run ID 重复均拒绝', () => {
	const workerSource = 'const Version = 1;';
	const evidence = appendCandidatePhase(baseEvidence(), 'predecessor', [run('predecessor', 1, sha('d')), run('predecessor', 2, sha('d'))], { workerSource });
	assert.throws(() => appendCandidatePhase(evidence, 'predecessor', evidence.predecessorRuns, { workerSource }), /already exists/);

	const drift = structuredClone(evidence);
	drift.environment.node = 'v0.0.0';
	assert.throws(() => validateEvidence(drift, { requireCompleteCandidate: false, expectedEnvironment: evidence.environment }), /environment drift/);
	const duplicate = structuredClone(evidence);
	duplicate.predecessorRuns[1].runId = duplicate.predecessorRuns[0].runId;
	assert.throws(() => validateEvidence(duplicate, { requireCompleteCandidate: false }), /runId/);
});

test('固定主 profile 每 pair 至少降 10%，支撑和非目标不得回退超过 5%', () => {
	const candidate = CANDIDATE_MATRIX.find(item => item.id === 'grpc-parser');
	const improvements = Object.fromEntries([
		[candidate.primary, { cpu: 89, wall: 100 }],
		[candidate.supporting, { cpu: 103, wall: 103 }],
		...candidate.nonTargets.map(id => [id, { cpu: 104, wall: 104 }]),
	]);
	const predecessorRuns = [run('predecessor', 1, sha('d')), run('predecessor', 2, sha('d'))];
	const candidateRuns = [run('candidate', 1, sha('e'), improvements), run('candidate', 2, sha('e'), improvements)];
	assert.equal(calculateCandidateDecision('grpc-parser', predecessorRuns, candidateRuns).status, 'GO');

	candidateRuns[1].profiles.find(profile => profile.profile === candidate.primary).summary.cpuMedianMs = 91;
	assert.equal(calculateCandidateDecision('grpc-parser', predecessorRuns, candidateRuns).status, 'NO-GO');
});

test('候选 Worker 与 predecessor 完全相同时不得 GO', () => {
	const candidate = CANDIDATE_MATRIX.find(item => item.id === 'grpc-parser');
	const improvements = Object.fromEntries([
		[candidate.primary, { cpu: 89, wall: 100 }],
		[candidate.supporting, { cpu: 100, wall: 100 }],
		...candidate.nonTargets.map(id => [id, { cpu: 100, wall: 100 }]),
	]);
	const workerSha256 = sha('d');
	const predecessorRuns = [run('predecessor', 1, workerSha256), run('predecessor', 2, workerSha256)];
	const candidateRuns = [run('candidate', 1, workerSha256, improvements), run('candidate', 2, workerSha256, improvements)];
	const decision = calculateCandidateDecision('grpc-parser', predecessorRuns, candidateRuns);
	assert.equal(decision.status, 'NO-GO');
	assert.ok(decision.failures.some(failure => failure.includes('worker hash matches predecessor')));
});

test('候选 phase 的跨 run CPU 中位数差超过 10% 时不能 GO', () => {
	const candidate = CANDIDATE_MATRIX.find(item => item.id === 'grpc-parser');
	const improvements = Object.fromEntries([
		[candidate.primary, { cpu: 89 }],
		[candidate.supporting, { cpu: 100, wall: 100 }],
		...candidate.nonTargets.map(id => [id, { cpu: 100, wall: 100 }]),
	]);
	const predecessorRuns = [run('predecessor', 1, sha('d')), run('predecessor', 2, sha('d'))];
	const candidateRuns = [run('candidate', 1, sha('e'), improvements), run('candidate', 2, sha('e'), improvements)];
	candidateRuns[1].profiles.find(profile => profile.profile === 'ws-upload-64b').summary.cpuMedianMs = 111;
	const decision = calculateCandidateDecision('grpc-parser', predecessorRuns, candidateRuns);
	assert.equal(decision.status, 'NO-GO');
	assert.ok(decision.failures.some(failure => failure.includes('candidate cross-run')));
});

test('baseline 仅在双 run ready、环境、四类哈希与跨 run CPU 门全部稳定时冻结', () => {
	const runs = [run('baseline', 1, sha('d')), run('baseline', 2, sha('d'))];
	assert.deepEqual(calculateBaselineDecision(runs), { baselineStatus: 'frozen', failures: [] });

	runs[1].profiles.find(profile => profile.profile === 'ws-upload-64b').summary.cpuMedianMs = 111;
	const unstable = calculateBaselineDecision(runs);
	assert.equal(unstable.baselineStatus, 'INCONCLUSIVE');
	assert.ok(unstable.failures.some(failure => failure.includes('baseline cross-run')));
});

test('baseline 漂移与 limited 写入可重算 INCONCLUSIVE，覆写状态会被 schema 拒绝', () => {
	const runs = [run('baseline', 1, sha('d')), run('baseline', 2, sha('e'))];
	runs[1].environment.cpuModel = 'drifted-cpu';
	runs[1].fingerprints.fixtureSha256 = sha('f');
	runs[1].profiles[0].status = 'limited';
	runs[1].profiles[0].calibration = { status: 'limited' };
	runs[1].status = 'limited';
	runs[1].calibration.status = 'limited';
	const decision = calculateBaselineDecision(runs);
	assert.equal(decision.baselineStatus, 'INCONCLUSIVE');
	assert.ok(decision.failures.some(failure => failure.includes('worker hash drift')));
	assert.ok(decision.failures.some(failure => failure.includes('environment drift')));
	assert.ok(decision.failures.some(failure => failure.includes('fixtureSha256 drift')));
	assert.ok(decision.failures.some(failure => failure.includes('not ready')));

	const evidence = {
		schemaVersion: 1,
		kind: 'ws-grpc-benchmark',
		mode: 'baseline',
		config: baseEvidence().config,
		environment: runs[0].environment,
		fingerprints: {
			benchmarkSha256: runs[0].fingerprints.benchmarkSha256,
			fixtureSha256: runs[0].fingerprints.fixtureSha256,
			profileMatrixSha256: runs[0].fingerprints.profileMatrixSha256,
		},
		runs,
		...decision,
	};
	assert.doesNotThrow(() => validateEvidence(evidence));
	evidence.baselineStatus = 'frozen';
	assert.throws(() => validateEvidence(evidence), /baseline decision mismatch/);
});
test('baseline timeout produces rebuildable INCONCLUSIVE evidence', () => {
	const executionFailure = 'benchmark timed out';
	const decision = calculateBaselineDecision([], executionFailure);
	assert.deepEqual(decision.failures, [
		'benchmark timed out',
		'baseline requires exactly two runs',
	]);
	const base = baseEvidence();
	const evidence = {
		schemaVersion: 1,
		kind: 'ws-grpc-benchmark',
		mode: 'baseline',
		config: base.config,
		environment: base.environment,
		fingerprints: base.fingerprints,
		runs: [],
		executionFailure,
		...decision,
	};
	assert.doesNotThrow(() => validateEvidence(evidence));
	evidence.baselineStatus = 'frozen';
	assert.throws(() => validateEvidence(evidence), /baseline decision mismatch/);
});


test('三样本校准先几何放大再按 CPU 中位数修正并记录完整轨迹', async () => {
	const measuredIterations = [];
	const result = await calibrateMeasurementIterations(async iterations => {
		measuredIterations.push(iterations);
		return { cpuTotalMs: iterations * 2, wallTotalMs: iterations * 3 };
	}, {
		targetCpuMs: 2000,
		minCpuMs: 1500,
		maxCpuMs: 3500,
		correctionFloorCpuMs: 100,
		growthFactor: 4,
		maxStages: 12,
		maxIterations: 4096,
	});
	assert.equal(result.status, 'ready');
	assert.deepEqual(measuredIterations, [1, 1, 1, 4, 4, 4, 16, 16, 16, 64, 64, 64, 1000, 1000, 1000]);
	assert.equal(result.selectedIterations, 1000);
	assert.deepEqual(result.trace.at(-1), {
		stage: 4,
		iterations: 1000,
		samples: [
			{ cpuTotalMs: 2000, wallTotalMs: 3000 },
			{ cpuTotalMs: 2000, wallTotalMs: 3000 },
			{ cpuTotalMs: 2000, wallTotalMs: 3000 },
		],
		cpuMedianMs: 2000,
		wallMedianMs: 3000,
		decision: 'ready',
	});
});

test('三样本中位数拒绝单个高低异常值驱动校准', async () => {
	let stage = 0;
	const highOutlier = await calibrateMeasurementIterations(async iterations => {
		const values = [80, 80, 5000];
		return { cpuTotalMs: values[stage++ % 3] * iterations, wallTotalMs: values[(stage - 1) % 3] * iterations };
	}, { maxStages: 2, maxIterations: 100 });
	assert.equal(highOutlier.trace[0].cpuMedianMs, 80);
	assert.equal(highOutlier.trace[0].decision, 'grow');
	assert.equal(highOutlier.trace[1].iterations, 4);

	stage = 0;
	const lowOutlier = await calibrateMeasurementIterations(async () => {
		const values = [10, 2000, 2000];
		const value = values[stage++ % 3];
		return { cpuTotalMs: value, wallTotalMs: value };
	}, { maxStages: 1 });
	assert.equal(lowOutlier.status, 'ready');
	assert.equal(lowOutlier.trace[0].cpuMedianMs, 2000);
});

test('分阶段校准达到迭代上限仍不入窗时标记 limited', async () => {
	const result = await calibrateMeasurementIterations(async iterations => ({
		cpuTotalMs: iterations,
		wallTotalMs: iterations,
	}), {
		targetCpuMs: 2000,
		minCpuMs: 1500,
		maxCpuMs: 3500,
		correctionFloorCpuMs: 100,
		growthFactor: 4,
		maxStages: 4,
		maxIterations: 16,
	});
	assert.equal(result.status, 'limited');
	assert.equal(result.selectedIterations, 16);
	assert.equal(result.trace.length, 3);
	assert.equal(result.trace.at(-1).decision, 'limited');
});

const cpuRounds = values => values.map(cpuTotalMs => ({
	iterations: 1,
	cpuTotalMs,
	wallTotalMs: cpuTotalMs,
	cpuMs: cpuTotalMs,
	wallMs: cpuTotalMs,
}));

function v2ProfileResult(profile) {
	const metrics = profileResult(profile).metrics;
	const calibration = {
		status: 'ready',
		selectedIterations: 1,
		trace: [{
			stage: 0,
			iterations: 1,
			samples: Array.from({ length: 3 }, () => ({ cpuTotalMs: 2000, wallTotalMs: 2000 })),
			cpuMedianMs: 2000,
			wallMedianMs: 2000,
			decision: 'ready',
		}],
	};
	const timedRounds = count => Array.from({ length: count }, () => ({ iterations: 1, cpuTotalMs: 2000, wallTotalMs: 2000, cpuMs: 2000, wallMs: 2000 }));
	const steadyRounds = timedRounds(12);
	const formalRounds = timedRounds(7);
	const steadyState = analyzeSteadyState(steadyRounds);
	const formalMeasurement = selectFormalMeasurement(formalRounds);
	return {
		profile,
		status: 'ready',
		calibration,
		cpuCv: 0,
		rawRounds: formalRounds,
		measurementAttempts: [{ attemptIndex: 0, calibration, steadyRounds, steadyState, formalRounds, formalMeasurement }],
		formalMeasurement,
		metrics,
		summary: { cpuMedianMs: 2000, wallMedianMs: 2000, ...metrics },
	};
}

function v2BaselineEvidence() {
	const environment = { node: process.version, platform: process.platform, arch: process.arch, cpuModel: 'synthetic-test-cpu', logicalCores: 8, powerMode: 'test-mode' };
	const run = pairId => {
		const ids = PROFILE_MANIFEST.map(profile => profile.id);
		if (pairId === 2) ids.reverse();
		const profiles = ids.map(v2ProfileResult);
		return {
			runId: `baseline-${pairId}-v2`, pairId, phase: 'baseline', status: 'ready', workerSha256: sha('d'), actualWorkerHotPath: true,
			candidateHotPath: null, environment,
			fingerprints: { benchmarkSha256: sha('a'), fixtureSha256: sha('b'), profileMatrixSha256: sha('c'), metricDefinitionSha256: sha('f'), workerSha256: sha('d') },
			processes: ids.map((profile, executionOrder) => ({ processId: pairId * 1000 + executionOrder, executionOrder, profile })),
			calibration: {
				status: 'ready',
				selectedIterations: Object.fromEntries(profiles.map(profile => [profile.profile, 1])),
				traces: Object.fromEntries(profiles.map(profile => [profile.profile, profile.calibration.trace])),
			},
			profiles,
		};
	};
	const runs = [run(1), run(2)];
	return {
		schemaVersion: 2,
		kind: 'ws-grpc-benchmark',
		mode: 'baseline',
		config: {
			totalBytesPerDirection: 1024 * 1024,
			profileManifest: PROFILE_MANIFEST,
			cpuCvLimit: 0.1,
			cpuTrendLimit: 0.1,
			calibrationSamplesPerStage: 3,
			steadyMinRounds: 12,
			steadyMaxRounds: 24,
			steadyWindowSize: 5,
			steadyWindowsRequired: 3,
			formalWindowSize: 7,
			formalMaxRounds: 14,
			maxRecalibrations: 2,
			metricDefinitionVersion: 1,
		},
		environment,
		fingerprints: { benchmarkSha256: sha('a'), fixtureSha256: sha('b'), profileMatrixSha256: sha('c'), metricDefinitionSha256: sha('f') },
		runs,
		...calculateBaselineDecision(runs),
	};
}

test('schema v2 重算 process/order、校准、稳态、正式窗口、环境、指标与五类哈希', () => {
	const evidence = v2BaselineEvidence();
	assert.equal(validateEvidence(evidence), evidence);

	const orderTampered = structuredClone(evidence);
	orderTampered.runs[1].processes[0].executionOrder = 1;
	assert.throws(() => validateEvidence(orderTampered), /process\/order mismatch/);

	const windowTampered = structuredClone(evidence);
	windowTampered.runs[0].profiles[0].measurementAttempts[0].formalMeasurement.selectedWindow.cpuMedianMs++;
	assert.throws(() => validateEvidence(windowTampered), /formal measurement mismatch/);

	const calibrationTampered = structuredClone(evidence);
	calibrationTampered.runs[0].profiles[0].calibration.trace[0].cpuMedianMs++;
	assert.throws(() => validateEvidence(calibrationTampered), /calibration median mismatch/);

	const transitionTampered = structuredClone(evidence);
	const transitionProfile = transitionTampered.runs[0].profiles[0];
	const invalidTrace = [
		{ ...transitionProfile.calibration.trace[0], decision: 'scale' },
		{ ...transitionProfile.calibration.trace[0], stage: 1 },
	];
	transitionProfile.calibration.trace = structuredClone(invalidTrace);
	transitionProfile.measurementAttempts[0].calibration.trace = structuredClone(invalidTrace);
	transitionTampered.runs[0].calibration.traces[transitionProfile.profile] = structuredClone(invalidTrace);
	assert.throws(() => validateEvidence(transitionTampered), /calibration decision mismatch/);

	const duplicateTraceTampered = JSON.parse(JSON.stringify(evidence));
	const duplicateTraceProfile = duplicateTraceTampered.runs[0].profiles[0].profile;
	duplicateTraceTampered.runs[0].calibration.traces[duplicateTraceProfile][0].iterations++;
	assert.throws(() => validateEvidence(duplicateTraceTampered), /run calibration mismatch/);

	const environmentTampered = structuredClone(evidence);
	delete environmentTampered.environment.logicalCores;
	assert.throws(() => validateEvidence(environmentTampered), /environment fingerprint incomplete/);

	const metricTampered = structuredClone(evidence);
	metricTampered.runs[0].profiles[0].summary.copiedBytes++;
	assert.throws(() => validateEvidence(metricTampered), /summary mismatch/);

	const hashTampered = structuredClone(evidence);
	hashTampered.runs[0].fingerprints.metricDefinitionSha256 = sha('9');
	assert.throws(() => validateEvidence(hashTampered), /metricDefinitionSha256 drift/);
});

test('五轮窗口按两端中位数计算趋势并对无效分母 fail-closed', () => {
	const stable = calculateMeasurementWindow(cpuRounds([2000, 2050, 1980, 2020, 2010]));
	assert.equal(stable.status, 'ready');
	assert.equal(stable.startMedianCpuMs, 2025);
	assert.equal(stable.endMedianCpuMs, 2015);
	assert.ok(stable.cpuTrend < 0.01);

	const rising = calculateMeasurementWindow(cpuRounds([1500, 1500, 1750, 2000, 2000]));
	assert.equal(rising.status, 'limited');
	assert.ok(rising.failures.includes('cpu trend exceeded 10%'));
	assert.equal(calculateMeasurementWindow(cpuRounds([0, 0, 0, 10, 10])).status, 'limited');
});

test('稳态只接受至少 12 轮末尾连续三个五轮窗口', () => {
	assert.equal(analyzeSteadyState(cpuRounds(Array(11).fill(2000))).status, 'pending');
	const stable = analyzeSteadyState(cpuRounds(Array(12).fill(2000)));
	assert.equal(stable.status, 'ready');
	assert.deepEqual(stable.windows.map(window => window.startIndex), [5, 6, 7]);

	assert.equal(analyzeSteadyState(cpuRounds(Array(12).fill(1200))).status, 'recalibrate');
	assert.equal(analyzeSteadyState(cpuRounds(Array.from({ length: 24 }, (_, index) => index % 2 ? 2500 : 1500))).status, 'limited');
	assert.equal(analyzeSteadyState(cpuRounds(Array.from({ length: 24 }, (_, index) => 1500 * (1.12 ** index)))).status, 'limited');
});

test('正式测量选择第一个通过门的当前尾部七轮且第十四轮精确停止', () => {
	const selected = selectFormalMeasurement(cpuRounds([1000, ...Array(7).fill(2000)]));
	assert.equal(selected.status, 'ready');
	assert.equal(selected.selectedStartIndex, 1);
	assert.equal(selected.selectedEndIndex, 7);
	assert.equal(selected.discardedWindows.length, 1);

	const inconclusive = selectFormalMeasurement(cpuRounds(Array.from({ length: 14 }, (_, index) => index % 2 ? 2500 : 1500)));
	assert.equal(inconclusive.status, 'limited');
	assert.equal(inconclusive.examinedRounds, 14);
	assert.equal(inconclusive.selectedWindow, null);
});

test('单 profile 状态机在窗外稳态后最多重校准并保留全部轮次', async () => {
	let calibrationAttempt = 0;
	let measurementRound = 0;
	const result = await runSteadyMeasurement(async iterations => {
		const cpuTotalMs = calibrationAttempt === 1 && measurementRound < 12 ? 1200 : 2000;
		measurementRound++;
		return { iterations, cpuTotalMs, wallTotalMs: cpuTotalMs, cpuMs: cpuTotalMs / iterations, wallMs: cpuTotalMs / iterations };
	}, {
		calibrate: async () => {
			calibrationAttempt++;
			measurementRound = 0;
			return { status: 'ready', selectedIterations: calibrationAttempt, trace: [{ stage: 0, iterations: calibrationAttempt }] };
		},
	});

	assert.equal(result.status, 'ready');
	assert.equal(result.attempts.length, 2);
	assert.equal(result.attempts[0].steadyState.status, 'recalibrate');
	assert.equal(result.attempts[0].steadyRounds.length, 12);
	assert.equal(result.attempts[1].steadyRounds.length, 12);
	assert.equal(result.formalRounds.length, 7);
	assert.equal(result.selectedWindow.startIndex, 0);
});

function fakeChild() {
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.killedSignals = [];
	child.kill = signal => {
		child.killedSignals.push(signal);
		queueMicrotask(() => child.emit('close', null, signal));
		return true;
	};
	return child;
}

test('子进程成功、失败、超时和取消均收敛且超时/取消会终止 child', async () => {
	const success = fakeChild();
	queueMicrotask(() => {
		success.stdout.end('ok');
		success.stderr.end();
		success.emit('close', 0, null);
	});
	assert.equal(await runChildProcess('node', [], { spawnProcess: () => success, timeoutMs: 100 }), 'ok');

	const failed = fakeChild();
	queueMicrotask(() => {
		failed.stderr.end('boom');
		failed.emit('close', 2, null);
	});
	await assert.rejects(() => runChildProcess('node', [], { spawnProcess: () => failed, timeoutMs: 100 }), /boom/);

	const timedOut = fakeChild();
	await assert.rejects(() => runChildProcess('node', [], { spawnProcess: () => timedOut, timeoutMs: 5 }), /timed out/);
	assert.deepEqual(timedOut.killedSignals, ['SIGTERM']);

	const cancelled = fakeChild();
	const controller = new AbortController();
	const pending = runChildProcess('node', [], { spawnProcess: () => cancelled, timeoutMs: 100, signal: controller.signal });
	controller.abort();
	await assert.rejects(() => pending, /cancelled/);
	assert.deepEqual(cancelled.killedSignals, ['SIGTERM']);
});

test('profile 超时预算覆盖合法轮次上限并等待测量取消', async () => {
	assert.ok(PROFILE_TIMEOUT_MS > (24 + 14) * 3500);
	let cancelled = false;
	await assert.rejects(() => withTimeout('profile', 5, async signal => {
		while (!signal.aborted) await new Promise(resolvePromise => setImmediate(resolvePromise));
		cancelled = true;
		throw new Error('measurement cancelled');
	}), /profile timed out/);
	assert.equal(cancelled, true);
});

test('两次运行按正序/反序启动 64 个独立 profile child 且并发不超过一个', async () => {
	let active = 0;
	let maxActive = 0;
	let nextPid = 1000;
	const calls = [];
	const runChild = async (_command, args) => {
		active++;
		maxActive = Math.max(maxActive, active);
		const childIndex = args.indexOf('--child-run');
		const profileIndex = args.indexOf('--profile');
		const orderIndex = args.indexOf('--profile-order');
		const pairId = Number(args[childIndex + 1]);
		const profile = args[profileIndex + 1];
		const order = Number(args[orderIndex + 1]);
		calls.push({ pairId, profile, order });
		await new Promise(resolvePromise => setImmediate(resolvePromise));
		active--;
		return JSON.stringify({
			schemaVersion: 2,
			kind: 'ws-grpc-profile-child',
			pairId,
			phase: 'baseline',
			processId: nextPid++,
			executionOrder: order,
			environment: { node: process.version, platform: process.platform, arch: process.arch, cpuModel: 'synthetic-test-cpu', logicalCores: 8, powerMode: 'test-mode' },
			workerSha256: sha('d'),
			fingerprints: { benchmarkSha256: sha('a'), fixtureSha256: sha('b'), profileMatrixSha256: sha('c'), metricDefinitionSha256: sha('f'), workerSha256: sha('d') },
			actualWorkerHotPath: true,
			candidateHotPath: null,
			profile: profileResult(profile),
		});
	};
	const options = parseBenchmarkOptions([]);
	const runs = await runTwoProcesses(options, 'baseline', { runChild });
	assert.equal(calls.length, 64);
	assert.equal(maxActive, 1);
	assert.deepEqual(calls.slice(0, 32).map(call => call.profile), PROFILE_MANIFEST.map(profile => profile.id));
	assert.deepEqual(calls.slice(32).map(call => call.profile), PROFILE_MANIFEST.map(profile => profile.id).reverse());
	assert.deepEqual(calls.slice(0, 32).map(call => call.order), Array.from({ length: 32 }, (_, index) => index));
	assert.deepEqual(calls.slice(32).map(call => call.order), Array.from({ length: 32 }, (_, index) => index));
	assert.deepEqual(runs.map(run => run.pairId), [1, 2]);
	assert.equal(new Set(runs.flatMap(run => run.processes.map(process => process.processId))).size, 64);
	assert.deepEqual(runs[1].profiles.map(profile => profile.profile), PROFILE_MANIFEST.map(profile => profile.id).reverse());
});

test('profile child 非法 JSON、身份错配和缺失 profile 均 fail-closed', async () => {
	const options = parseBenchmarkOptions([]);
	await assert.rejects(() => runTwoProcesses(options, 'baseline', { runChild: async () => '{invalid' }), /invalid JSON/);
	await assert.rejects(() => runTwoProcesses(options, 'baseline', {
		runChild: async (_command, args) => {
			const pairId = Number(args[args.indexOf('--child-run') + 1]);
			const order = Number(args[args.indexOf('--profile-order') + 1]);
			const profile = args[args.indexOf('--profile') + 1];
			return JSON.stringify({ schemaVersion: 2, kind: 'ws-grpc-profile-child', pairId, phase: 'baseline', processId: order + 1, executionOrder: order, profile: profileResult(`${profile}-wrong`) });
		},
	}), /profile child identity mismatch/);
});

test('第二个 run 结构失败时保留第一个完整 run', async () => {
	let processId = 1000;
	const runChild = async (_command, args) => {
		const pairId = Number(args[args.indexOf('--child-run') + 1]);
		const executionOrder = Number(args[args.indexOf('--profile-order') + 1]);
		const expectedProfile = args[args.indexOf('--profile') + 1];
		const profile = pairId === 2 && executionOrder === 0 ? `${expectedProfile}-wrong` : expectedProfile;
		return JSON.stringify({
			schemaVersion: 2,
			kind: 'ws-grpc-profile-child',
			pairId,
			phase: 'baseline',
			processId: processId++,
			executionOrder,
			environment: { id: 'same' },
			workerSha256: sha('d'),
			fingerprints: { workerSha256: sha('d') },
			actualWorkerHotPath: true,
			candidateHotPath: null,
			profile: { ...profileResult(profile), calibration: { status: 'ready', selectedIterations: 20, trace: [] } },
		});
	};
	try {
		await runTwoProcesses(parseBenchmarkOptions([]), 'baseline', { runChild });
		assert.fail('expected profile child identity mismatch');
	} catch (error) {
		assert.match(error.message, /profile child identity mismatch/);
		assert.equal(error.completedRuns?.length, 1);
		assert.equal(error.completedRuns[0].pairId, 1);
	}
});

test('环境指纹记录逻辑核心并在电源模式读取失败时写 unknown', () => {
	const environment = currentEnvironment({ readPowerMode: () => { throw new Error('unavailable') } });
	assert.ok(Number.isSafeInteger(environment.logicalCores));
	assert.ok(environment.logicalCores > 0);
	assert.equal(environment.powerMode, 'unknown');
});


test('原子证据写入失败不覆盖旧文件且不遗留临时文件', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'cfgfwax-evidence-'));
	const output = join(directory, 'evidence.json');
	await writeFile(output, 'old\n');
	try {
		await assert.rejects(() => writeEvidenceAtomic(output, '{"new":true}\n', {
			renameFile: async () => { throw new Error('rename failed') },
		}), /rename failed/);
		assert.equal(await readFile(output, 'utf8'), 'old\n');
		assert.deepEqual(await readdir(directory), ['evidence.json']);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
