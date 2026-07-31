import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDeterministicFixture,
	parseBenchmarkOptions,
	runProfileOnce,
} from '../benchmarks/xhttp_stream_benchmark.mjs';

const tinySizes = [64, 128, 256, 512];

function outputsFor(direction, result) {
	return direction === 'bidirectional'
		? [result.output.uplink, result.output.downlink]
		: [result.output];
}

test('XHTTP 基准支持 64/128/256/512 B 三方向 profile', async () => {
	const fixture = createDeterministicFixture(4096);
	for (const size of tinySizes) {
		for (const direction of ['uplink', 'downlink', 'bidirectional']) {
			const profile = `${direction}-${size}b`;
			assert.equal(parseBenchmarkOptions(['--profile', profile]).profile, profile);
			const result = await runProfileOnce(profile, fixture);
			for (const output of outputsFor(direction, result)) {
				assert.equal(output.totalBytes, fixture.bytes.byteLength);
				assert.equal(output.sha256, fixture.sha256);
			}
		}
	}
});

test('公平基准可对照同夹具手动 Web Streams 泵和原生 pipeTo', async () => {
	const fixture = createDeterministicFixture(4096);
	for (const strategy of ['stream-pump', 'native']) {
		const result = await runProfileOnce('bidirectional-64b', fixture, {
			uplinkStrategy: strategy,
			downlinkStrategy: strategy,
		});
		for (const output of outputsFor('bidirectional', result)) {
			assert.equal(output.totalBytes, fixture.bytes.byteLength);
			assert.equal(output.sha256, fixture.sha256);
		}
	}
	assert.equal(parseBenchmarkOptions(['--uplink-strategy', 'stream-pump']).uplinkStrategy, 'stream-pump');
	assert.equal(parseBenchmarkOptions(['--downlink-strategy', 'stream-pump']).downlinkStrategy, 'stream-pump');
	assert.equal(parseBenchmarkOptions(['--uplink-strategy', 'native']).uplinkStrategy, 'native');
	assert.equal(parseBenchmarkOptions(['--downlink-strategy', 'native']).downlinkStrategy, 'native');
});

test('原生基准的单向和双向 pipeTo 数量与真实流向一致', async () => {
	const fixture = createDeterministicFixture(4096);
	const originalPipeTo = ReadableStream.prototype.pipeTo;
	const cases = [
		{ direction: 'uplink', expectedPipeToCalls: 1 },
		{ direction: 'downlink', expectedPipeToCalls: 1 },
		{ direction: 'bidirectional', expectedPipeToCalls: 2 },
	];

	for (const { direction, expectedPipeToCalls } of cases) {
		let pipeToCalls = 0;
		ReadableStream.prototype.pipeTo = function (...args) {
			pipeToCalls++;
			return originalPipeTo.apply(this, args);
		};
		try {
			const result = await runProfileOnce(`${direction}-64b`, fixture, {
				uplinkStrategy: 'native',
				downlinkStrategy: 'native',
			});
			for (const output of outputsFor(direction, result)) {
				assert.equal(output.totalBytes, fixture.bytes.byteLength);
				assert.equal(output.sha256, fixture.sha256);
			}
			assert.equal(pipeToCalls, expectedPipeToCalls, direction);
		} finally {
			ReadableStream.prototype.pipeTo = originalPipeTo;
		}
	}
});
