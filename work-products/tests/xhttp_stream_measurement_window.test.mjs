import assert from 'node:assert/strict';
import test from 'node:test';

import { planMeasurementWindow } from '../benchmarks/xhttp_stream_benchmark.mjs';

function rounds(cpuValues) {
	return cpuValues.map(cpuMs => ({ cpuMs, wallMs: cpuMs }));
}

test('正式轮发生台阶换挡时继续采样并选择透明的连续稳定后缀', () => {
	const transition = [5.927245, 6.142415, 6.335913, 4.791022, 3.143963, 3.168731, 3.410217];
	const initial = planMeasurementWindow(rounds(transition), 7, 14);

	assert.equal(initial.status, 'continue');
	assert.equal(initial.reason, 'measurement-trend');

	const plateau = [3.22, 3.18, 3.25, 3.20, 3.19, 3.23, 3.21];
	const settled = planMeasurementWindow(rounds([...transition, ...plateau]), 7, 14);

	assert.equal(settled.status, 'ready');
	assert.equal(settled.selectedStart, 7);
	assert.equal(settled.discardedRounds, 7);
	assert.ok(settled.cpuCv < 0.10);
	assert.ok(settled.trendRatio < 0.10);
});

test('连续七轮始终不稳定时在有界轮数后失败', () => {
	const result = planMeasurementWindow(rounds([
		3, 6, 3, 6, 3, 6, 3,
		6, 3, 6, 3, 6, 3, 6,
	]), 7, 14);

	assert.equal(result.status, 'limited');
	assert.equal(result.reason, 'max-measurement-rounds-reached');
});
