import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../benchmarks/xhttp_stream_benchmark.mjs', import.meta.url), 'utf8');

test('XHTTP 基准轮次不强制完整 GC，隔离子进程也不传播 --expose-gc', () => {
	const measureRound = source.match(/async function measureRound[\s\S]*?\n}\n\nasync function calibrateMeasurementIterations/)?.[0];
	const runIsolatedProfile = source.match(/function runIsolatedProfile[\s\S]*?\n}\n\nasync function runBenchmarkIsolated/)?.[0];

	assert.ok(measureRound, 'measureRound source must be present');
	assert.ok(runIsolatedProfile, 'runIsolatedProfile source must be present');
	assert.doesNotMatch(measureRound, /globalThis\.gc/);
	assert.doesNotMatch(runIsolatedProfile, /--expose-gc/);
});
