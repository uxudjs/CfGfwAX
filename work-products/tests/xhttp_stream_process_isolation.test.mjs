import assert from 'node:assert/strict';
import test from 'node:test';
import {
	planIsolatedProfileAttempt,
	selectProfileExecutionMode,
	validateIsolatedFingerprints,
} from '../benchmarks/xhttp_stream_benchmark.mjs';

const commonFingerprint = {
	node: 'v20.19.2',
	platform: 'win32',
	arch: 'x64',
	cpuModel: 'test-cpu',
	logicalCores: 8,
	powerMode: 'balanced:test',
	benchmarkSha256: 'a'.repeat(64),
	fixtureSha256: 'b'.repeat(64),
	workerSourceSha256: 'c'.repeat(64),
};

test('精确 profile 在当前进程运行，方向组和 all 隔离到子进程', () => {
	assert.equal(selectProfileExecutionMode('uplink-1kib'), 'in-process');
	assert.equal(selectProfileExecutionMode('downlink-64kib'), 'in-process');
	assert.equal(selectProfileExecutionMode('all'), 'isolated-processes');
	assert.equal(selectProfileExecutionMode('uplink'), 'isolated-processes');
	assert.equal(selectProfileExecutionMode('downlink'), 'isolated-processes');
	assert.equal(selectProfileExecutionMode('bidirectional'), 'isolated-processes');
});

test('隔离结果要求不同 PID 且非 PID 指纹完全一致', () => {
	const result = validateIsolatedFingerprints([
		{ profile: 'uplink-1kib', environmentFingerprint: { ...commonFingerprint, processId: 101 } },
		{ profile: 'uplink-16kib', environmentFingerprint: { ...commonFingerprint, processId: 202 } },
	]);

	assert.deepEqual(result.environmentFingerprint, commonFingerprint);
	assert.deepEqual(result.profileProcesses, [
		{ profile: 'uplink-1kib', processId: 101 },
		{ profile: 'uplink-16kib', processId: 202 },
	]);
});

test('隔离结果拒绝 PID 复用和环境指纹漂移', () => {
	assert.throws(() => validateIsolatedFingerprints([
		{ profile: 'uplink-1kib', environmentFingerprint: { ...commonFingerprint, processId: 101 } },
		{ profile: 'uplink-16kib', environmentFingerprint: { ...commonFingerprint, processId: 101 } },
	]), /distinct process/);

	assert.throws(() => validateIsolatedFingerprints([
		{ profile: 'uplink-1kib', environmentFingerprint: { ...commonFingerprint, processId: 101 } },
		{ profile: 'uplink-16kib', environmentFingerprint: { ...commonFingerprint, processId: 202, powerMode: 'changed' } },
	]), /fingerprint mismatch/);
});

test('隔离 profile 只对预热未稳做一次全新进程重采样', () => {
	const unstable = 'Error: downlink-1kib: steady state unavailable: max-steady-state-rounds-reached';

	assert.deepEqual(planIsolatedProfileAttempt(0, '', 1), {
		status: 'complete',
		reason: null,
	});
	assert.deepEqual(planIsolatedProfileAttempt(1, unstable, 1), {
		status: 'retry',
		reason: 'steady-state-unavailable',
	});
	assert.deepEqual(planIsolatedProfileAttempt(1, unstable, 2), {
		status: 'failed',
		reason: 'steady-state-unavailable',
	});
	assert.deepEqual(planIsolatedProfileAttempt(1, 'CPU coefficient of variation exceeds 0.1', 1), {
		status: 'failed',
		reason: 'child-process-failed',
	});
	assert.deepEqual(planIsolatedProfileAttempt(null, null, 1), {
		status: 'failed',
		reason: 'child-process-failed',
	});
});
