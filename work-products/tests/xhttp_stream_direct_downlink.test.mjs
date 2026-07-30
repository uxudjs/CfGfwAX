import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createDeterministicFixture, runProfileOnce } from '../benchmarks/xhttp_stream_benchmark.mjs';

const source = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { connectStreams };`).toString('base64')}`;
const { connectStreams } = await import(moduleUrl);

function createRemote(chunks, events = []) {
	let index = 0;
	let cancelled = 0;
	let released = 0;
	let closed = 0;
	const readerOptions = [];
	const reader = {
		async read(view) {
			events.push(`read${index + 1}`);
			if (index >= chunks.length) return { done: true, value: undefined };
			const chunk = chunks[index++];
			if (view instanceof Uint8Array) {
				view.set(chunk);
				return { done: false, value: view.subarray(0, chunk.byteLength) };
			}
			return { done: false, value: chunk };
		},
		async cancel() {
			cancelled++;
		},
		releaseLock() {
			released++;
		},
	};
	return {
		socket: {
			readable: {
				getReader(options) {
					readerOptions.push(options);
					return reader;
				},
			},
			close() {
				closed++;
			},
		},
		state: {
			readerOptions,
			get cancelled() { return cancelled },
			get released() { return released },
			get closed() { return closed },
		},
	};
}

function createSink(events = [], fail = null) {
	const chunks = [];
	let closed = 0;
	return {
		sink: {
			readyState: WebSocket.OPEN,
			send(data) {
				events.push('send');
				if (fail) throw fail;
				chunks.push(Uint8Array.from(data instanceof Uint8Array ? data : new Uint8Array(data)));
			},
			close() {
				closed++;
				this.readyState = WebSocket.CLOSED;
			},
		},
		state: {
			chunks,
			get closed() { return closed },
		},
	};
}

test('XHTTP 下行使用 default reader，首包只合并一次并原块直送', async () => {
	const events = [];
	const remote = createRemote([
		new Uint8Array([1, 2]),
		new Uint8Array([3, 4]),
	], events);
	const output = createSink(events);
	const diagnostics = [];

	await connectStreams(
		remote.socket,
		output.sink,
		new Uint8Array([9]),
		null,
		'direct',
		context => diagnostics.push(context),
		'xhttp',
	);

	assert.deepEqual(remote.state.readerOptions, [undefined]);
	assert.deepEqual(events.slice(0, 3), ['read1', 'send', 'read2']);
	assert.deepEqual(output.state.chunks.map(chunk => [...chunk]), [[9, 1, 2], [3, 4]]);
	assert.equal(remote.state.cancelled, 1);
	assert.equal(remote.state.released, 1);
	assert.equal(output.state.closed, 1);
	assert.deepEqual(diagnostics.at(-1), {
		stage: 'eof',
		inboundTransport: 'xhttp',
		outboundTransport: 'direct',
		hasData: true,
		closeReason: 'remote-eof',
	});
});

test('XHTTP 下行发送失败保留 send 阶段并关闭两端', async () => {
	const remote = createRemote([new Uint8Array([1])]);
	const output = createSink([], new Error('send failed'));
	const diagnostics = [];

	await connectStreams(
		remote.socket,
		output.sink,
		null,
		null,
		'direct',
		context => diagnostics.push(context),
		'xhttp',
	);

	assert.equal(remote.state.closed, 1);
	assert.equal(output.state.closed, 1);
	assert.equal(remote.state.cancelled, 1);
	assert.equal(remote.state.released, 1);
	assert.equal(diagnostics.at(-1).stage, 'send');
	assert.equal(diagnostics.at(-1).closeReason, 'send-failed');
});

for (const inboundTransport of ['websocket', 'grpc']) {
	test(`${inboundTransport} 下行继续使用 BYOB/Grain 路径`, async () => {
		const remote = createRemote([new Uint8Array([1]), new Uint8Array([2])]);
		const output = createSink();

		await connectStreams(
			remote.socket,
			output.sink,
			null,
			null,
			'direct',
			() => { },
			inboundTransport,
		);

		assert.deepEqual(remote.state.readerOptions, [{ mode: 'byob' }]);
		assert.deepEqual(output.state.chunks.map(chunk => [...chunk]), [[1, 2]]);
	});
}

test('XHTTP 同步 bridge 发送后不额外等待一个 Promise turn', async () => {
	let reads = 0;
	let readsObservedAfterSend = null;
	const reader = {
		async read() {
			reads++;
			if (reads === 1) return { done: false, value: new Uint8Array([1]) };
			return { done: true, value: undefined };
		},
		async cancel() { },
		releaseLock() { },
	};
	const remoteSocket = {
		readable: { getReader: () => reader },
		close() { },
	};
	const bridge = {
		readyState: WebSocket.OPEN,
		send() {
			queueMicrotask(() => { readsObservedAfterSend = reads });
		},
		close() {
			this.readyState = WebSocket.CLOSED;
		},
	};

	await connectStreams(remoteSocket, bridge, null, null, 'direct', () => { }, 'xhttp');
	await Promise.resolve();

	assert.equal(readsObservedAfterSend, 2);
});

test('handler-level XHTTP 下行不把来源原始块计为 Worker 分配或复制', async () => {
	const fixture = createDeterministicFixture(256 * 1024);
	const result = await runProfileOnce('downlink-1kib', fixture, { trackProxy: true });

	assert.equal(result.proxy.inputViews, 256);
	assert.equal(result.proxy.sends, 256);
	assert.equal(result.proxy.pumpSendAwaitsProxy, 0);
	assert.equal(result.proxy.allocatedBuffersProxy, 0);
	assert.equal(result.proxy.copiedBytesProxy, 0);
	assert.equal(result.proxy.grainCopiedBytesProxy, 0);
	assert.equal(result.output.sha256, fixture.sha256);
});

test('基准可在同一 Worker 中复现旧共享 Grain 与 XHTTP 直通下行', async () => {
	const fixture = createDeterministicFixture(256 * 1024);
	const shared = await runProfileOnce('downlink-1kib', fixture, {
		trackProxy: true,
		downlinkStrategy: 'shared-grain',
	});
	const direct = await runProfileOnce('downlink-1kib', fixture, {
		trackProxy: true,
		downlinkStrategy: 'auto',
	});

	assert.equal(shared.proxy.sends, 8);
	assert.ok(shared.proxy.allocatedBuffersProxy > 0);
	assert.ok(shared.proxy.copiedBytesProxy > 0);
	assert.equal(direct.proxy.sends, 256);
	assert.equal(direct.proxy.allocatedBuffersProxy, 0);
	assert.equal(direct.proxy.copiedBytesProxy, 0);
	assert.equal(shared.output.sha256, fixture.sha256);
	assert.equal(direct.output.sha256, fixture.sha256);
});
