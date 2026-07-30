import assert from 'node:assert/strict';
import test from 'node:test';
import { planSteadyStateWindow } from '../../xhttp_stream_benchmark.mjs';

const rounds = values => values.map(sampleCpuMs => ({ sampleCpuMs, sampleWallMs: sampleCpuMs }));

test('稳态门拒绝样本不足、持续加速和高幅振荡', () => {
	assert.deepEqual(planSteadyStateWindow(rounds([2000, 1980]), 100, 0), {
		status: 'continue',
		reason: 'insufficient-steady-state-samples',
		stableWindows: 0,
	});

	const trending = planSteadyStateWindow(rounds([2000, 1875, 1734, 1500, 1407]), 100, 0);
	assert.equal(trending.status, 'continue');
	assert.equal(trending.reason, 'steady-state-trend');
	assert.equal(trending.stableWindows, 0);
	assert.ok(trending.trendRatio > 0.08);

	const oscillating = planSteadyStateWindow(rounds([1800, 2400, 1700, 2500, 1800]), 100, 0);
	assert.equal(oscillating.status, 'continue');
	assert.equal(oscillating.reason, 'steady-state-variation');
	assert.equal(oscillating.stableWindows, 0);
	assert.ok(oscillating.cpuCv > 0.08);
});

test('稳态门要求三个连续稳定窗口', () => {
	const samples = rounds([1980, 2020, 1990, 2010, 2000]);
	const first = planSteadyStateWindow(samples, 100, 0);
	assert.equal(first.status, 'continue');
	assert.equal(first.reason, 'confirming-steady-state');
	assert.equal(first.stableWindows, 1);

	const second = planSteadyStateWindow([...samples, ...rounds([2010])], 100, first.stableWindows);
	assert.equal(second.status, 'continue');
	assert.equal(second.stableWindows, 2);

	const third = planSteadyStateWindow([...samples, ...rounds([2010, 1995])], 100, second.stableWindows);
	assert.equal(third.status, 'ready');
	assert.equal(third.reason, null);
	assert.equal(third.stableWindows, 3);
	assert.equal(third.selectedIterations, 100);
});

test('稳态后 CPU 窗口漂移会重校准迭代数而不是直接测量', () => {
	const samples = rounds([1120, 1140, 1160, 1150, 1130, 1140, 1150]);
	const result = planSteadyStateWindow(samples, 100, 2);

	assert.equal(result.status, 'recalibrate');
	assert.equal(result.reason, 'steady-state-outside-cpu-window');
	assert.equal(result.stableWindows, 3);
	assert.equal(result.selectedIterations, 100);
	assert.ok(result.nextIterations > 100);
	assert.ok(result.sampleCpuMedianMs < 1500);
});

test('达到稳态预热上限时返回结构化限制原因', () => {
	const samples = rounds(Array.from({ length: 24 }, (_, index) => index % 2 ? 2400 : 1600));
	const result = planSteadyStateWindow(samples, 100, 0);

	assert.equal(result.status, 'limited');
	assert.equal(result.reason, 'max-steady-state-rounds-reached');
	assert.equal(result.stableWindows, 0);
});

test('稳态窗口与正式 CPU CV 的 0.10 验收边界一致', () => {
	const result = planSteadyStateWindow(rounds([2200, 1800, 2200, 1800, 2000]), 100, 0);

	assert.ok(result.cpuCv > 0.08);
	assert.ok(result.cpuCv < 0.10);
	assert.equal(result.cvLimit, 0.10);
	assert.equal(result.trendLimit, 0.10);
	assert.equal(result.status, 'continue');
	assert.equal(result.reason, 'confirming-steady-state');
	assert.equal(result.stableWindows, 1);
});
