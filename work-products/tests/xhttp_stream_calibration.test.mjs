import assert from 'node:assert/strict';
import test from 'node:test';
import {
	planCalibrationStage,
	selectMeasurementIterations,
} from '../benchmarks/xhttp_stream_benchmark.mjs';

const sample = (sampleCpuMs, sampleWallMs) => ({ sampleCpuMs, sampleWallMs });

test('校准优先使用多样本 CPU 中位数并在 CPU 为零时回退 wall', () => {
	assert.equal(selectMeasurementIterations(sample(16, 3), 1), 125);
	assert.equal(selectMeasurementIterations(sample(0, 1), 1), 2000);
});

test('过短快 profile 继续放大而不是静默卡在旧的 2048 上限', () => {
	const decision = planCalibrationStage([
		sample(359, 372),
		sample(437, 378),
		sample(547, 653),
	], 2000);

	assert.equal(decision.status, 'continue');
	assert.equal(decision.sampleCpuMedianMs, 437);
	assert.equal(decision.nextIterations, 9154);
});

test('目标窗口内的多样本校准直接选用当前迭代数', () => {
	const decision = planCalibrationStage([
		sample(1800, 1820),
		sample(2000, 2010),
		sample(2200, 2190),
	], 72);

	assert.equal(decision.status, 'ready');
	assert.equal(decision.selectedIterations, 72);
	assert.equal(decision.reason, null);
});

test('单次执行已过长时返回结构化限制原因', () => {
	const decision = planCalibrationStage([
		sample(3600, 3500),
		sample(4000, 3900),
		sample(4400, 4300),
	], 1);

	assert.equal(decision.status, 'limited');
	assert.equal(decision.selectedIterations, 1);
	assert.equal(decision.reason, 'single-iteration-over-target');
});

test('达到迭代保护上限仍过短时显式报告而不静默截断', () => {
	const decision = planCalibrationStage([
		sample(90, 100),
		sample(100, 110),
		sample(110, 120),
	], 65536);

	assert.equal(decision.status, 'limited');
	assert.equal(decision.selectedIterations, 65536);
	assert.equal(decision.reason, 'max-iterations-reached');
});
