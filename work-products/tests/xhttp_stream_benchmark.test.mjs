import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	createDeterministicFixture,
	instrumentLegacyGrainCopies,
	parseBenchmarkOptions,
	runProfileOnce,
	runBenchmark,
	selectMeasurementIterations,
	summarizeRounds,
	summarizeStability,
} from '../benchmarks/xhttp_stream_benchmark.mjs';

test('benchmark 参数固定默认工作量并拒绝未知 profile', () => {
	assert.deepEqual(parseBenchmarkOptions([]), {
		profile: 'all',
		warmup: 2,
		rounds: 7,
		output: null,
		totalBytes: 16 * 1024 * 1024,
		uplinkStrategy: 'auto',
		downlinkStrategy: 'auto',
		workerSource: null,
	});
	assert.equal(parseBenchmarkOptions(['--worker-source', 'work-products/debug/before.js']).workerSource, 'work-products/debug/before.js');
	assert.equal(parseBenchmarkOptions(['--downlink-strategy', 'shared-grain']).downlinkStrategy, 'shared-grain');
	assert.throws(() => parseBenchmarkOptions(['--profile', 'packet-up']), /Unknown profile/);
	assert.throws(() => parseBenchmarkOptions(['--rounds', '0']), /positive integer/);
	assert.throws(() => parseBenchmarkOptions(['--uplink-strategy', 'unknown']), /Unknown uplink strategy/);
	assert.throws(() => parseBenchmarkOptions(['--downlink-strategy', 'unknown']), /Unknown downlink strategy/);
});

test('仅代理轮为旧 Grain slice 注入复制计数', () => {
	const legacy = 'const output = pendingBuffer.subarray(0, pendingBytes).slice();';
	const instrumented = instrumentLegacyGrainCopies(legacy);
	assert.match(instrumented, /__xhttpBenchmarkGrainCopyObserver/);
	assert.match(instrumented, /outputView\.slice\(\)/);
	assert.equal(instrumentLegacyGrainCopies('const output = pendingBuffer;'), 'const output = pendingBuffer;');
});

test('固定夹具使用相同种子生成相同摘要', () => {
	const first = createDeterministicFixture(64 * 1024);
	const second = createDeterministicFixture(64 * 1024);
	assert.equal(first.sha256, second.sha256);
	assert.deepEqual(first.bytes, second.bytes);
});

test('摘要包含 CPU 中位数、变异系数和 wall 中位数', () => {
	assert.deepEqual(summarizeRounds([
		{ cpuMs: 10, wallMs: 20 },
		{ cpuMs: 12, wallMs: 22 },
		{ cpuMs: 11, wallMs: 21 },
	]), {
		cpuMedianMs: 11,
		cpuMeanMs: 11,
		cpuCv: Number((Math.sqrt(2 / 3) / 11).toFixed(6)),
		wallMedianMs: 21,
	});
});

test('稳定性门禁覆盖全部选中的 profile', () => {
	const stability = summarizeStability([
		{ profile: 'uplink-1kib', summary: { cpuCv: 0.05 } },
		{ profile: 'downlink-1kib', summary: { cpuCv: 0.11 } },
	]);
	assert.equal(stability.profile, 'all-selected');
	assert.equal(stability.cpuCv, 0.11);
	assert.equal(stability.passed, false);
	assert.deepEqual(stability.failedProfiles, ['downlink-1kib']);
	assert.deepEqual(stability.profiles, [
		{ profile: 'uplink-1kib', cpuCv: 0.05, passed: true },
		{ profile: 'downlink-1kib', cpuCv: 0.11, passed: false },
	]);
});

test('测量迭代校准优先使用 CPU 并在 CPU 不可用时回退 wall', () => {
	assert.equal(selectMeasurementIterations({ sampleCpuMs: 16, sampleWallMs: 3 }), 125);
	assert.equal(selectMeasurementIterations({ sampleCpuMs: 0, sampleWallMs: 6 }), 334);
});

test('64 KiB 上行基准使用完成等待而不进入小块背压', async () => {
	const fixture = createDeterministicFixture(128 * 1024);
	const result = await runProfileOnce('uplink-64kib', fixture, { trackProxy: true });
	assert.equal(result.proxy.sends, 2);
	assert.equal(result.proxy.completionPromisesProxy, 2);
	assert.equal(result.proxy.backpressureWaitsProxy, 0);
});

test('小型基准生成完整环境、逐轮、代理和字节正确性字段', async () => {
	const result = await runBenchmark({
		profile: 'downlink-1kib',
		warmup: 1,
		rounds: 3,
		output: null,
		totalBytes: 128 * 1024,
		downlinkStrategy: 'shared-grain',
		enforceSteadyState: false,
		enforceStability: false,
		enforceMeasurementStability: false,
	});
	assert.equal(result.schemaVersion, 1);
	assert.equal(result.config.totalBytesPerDirection, 128 * 1024);
	assert.equal(result.config.downlinkStrategy, 'shared-grain');
	assert.equal(result.config.steadyStateGate, 'disabled');
	assert.equal(result.profiles.length, 1);
	assert.equal(result.profiles[0].rounds.length, 3);
	assert.equal(result.profiles[0].steadyState.status, 'disabled');
	assert.equal(result.profiles[0].warmups.length, 1);
	assert.ok(result.profiles[0].rounds.every(round => round.downlinkStrategy === 'shared-grain'));
	assert.equal(result.profiles[0].output.totalBytes, 128 * 1024);
	assert.match(result.profiles[0].output.sha256, /^[a-f0-9]{64}$/);
	assert.ok(Number.isFinite(result.profiles[0].proxy.arrayBuffersPeakBytes));
	assert.equal(result.profiles[0].proxy.allocatedBuffersProxy, 4);
	assert.equal(result.profiles[0].proxy.grainCopiedBytesProxy, 0);
	for (const key of ['node', 'platform', 'arch', 'cpuModel', 'logicalCores', 'powerMode', 'benchmarkSha256', 'fixtureSha256', 'workerSourceSha256']) {
		assert.ok(result.environmentFingerprint[key], `缺少 ${key}`);
	}
});

test('CLI 参数错误以非零状态退出', () => {
	const result = spawnSync(process.execPath, [
		fileURLToPath(new URL('../benchmarks/xhttp_stream_benchmark.mjs', import.meta.url)),
		'--profile',
		'packet-down',
	], { encoding: 'utf8' });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Unknown profile/);
});
