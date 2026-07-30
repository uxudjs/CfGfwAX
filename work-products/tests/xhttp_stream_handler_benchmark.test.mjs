import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createDeterministicFixture,
	runProfileOnce,
} from '../benchmarks/xhttp_stream_benchmark.mjs';

test('handler-level 上行基准经过请求体读取并复现逐块 await', async () => {
	const fixture = createDeterministicFixture(128 * 1024);
	const result = await runProfileOnce('uplink-1kib', fixture, { trackProxy: true });

	assert.equal(result.proxy.handlerPath, 'worker-xhttp-stream-one');
	assert.equal(result.proxy.inputViews, 128);
	assert.equal(result.proxy.readerReadsProxy, 129);
	assert.equal(result.proxy.pumpWriteAwaitsProxy, 128);
	assert.equal(result.proxy.syncEnqueuesProxy, 128);
	assert.equal(result.proxy.flushAwaitsProxy, 1);
	assert.equal(result.output.sha256, fixture.sha256);
});

test('handler-level XHTTP 下行基准直送原始块且不声明可复用缓冲', async () => {
	const fixture = createDeterministicFixture(128 * 1024);
	const result = await runProfileOnce('downlink-1kib', fixture, { trackProxy: true });

	assert.equal(result.proxy.handlerPath, 'worker-xhttp-stream-one');
	assert.equal(result.proxy.inputViews, 128);
	assert.equal(result.proxy.readerReadsProxy, 129);
	assert.equal(result.proxy.pumpSendAwaitsProxy, 0);
	assert.equal(result.proxy.flushAwaitsProxy, 1);
	assert.equal(result.proxy.sends, 128);
	assert.equal(result.proxy.allocatedBuffersProxy, 0);
	assert.equal(result.proxy.copiedBytesProxy, 0);
	assert.equal(result.proxy.grainCopiedBytesProxy, 0);
	assert.equal(result.proxy.bufferReuseCapabilityProxy, false);
	assert.equal(result.output.sha256, fixture.sha256);
});
