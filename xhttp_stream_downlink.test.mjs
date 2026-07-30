import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./_worker.js', import.meta.url), 'utf8');
if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { 创建下行Grain发送器 };`).toString('base64')}`;
const { 创建下行Grain发送器 } = await import(moduleUrl);

function deferred() {
	let resolve, reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

test('XHTTP 下行将小块合并为完整 Grain 并保留响应头', async () => {
	const sent = [];
	const webSocket = {
		readyState: WebSocket.OPEN,
		async send(data) { sent.push(Uint8Array.from(data)) },
	};
	const sender = 创建下行Grain发送器(webSocket, new Uint8Array([9, 8]));
	await sender.发送(new Uint8Array(16 * 1024).fill(1));
	await sender.发送(new Uint8Array(16 * 1024).fill(2));
	await sender.发送(new Uint8Array(137).fill(3));
	await sender.flush();
	assert.deepEqual(sent.map(chunk => chunk.byteLength), [32 * 1024, 139]);
	assert.deepEqual(sent[0].subarray(0, 2), new Uint8Array([9, 8]));
	assert.ok(sent[0].subarray(2, 2 + 16 * 1024).every(byte => byte === 1));
	assert.ok(sent[1].subarray(2).every(byte => byte === 3));
});

test('XHTTP 下行仅在合并缓冲发送完成后复用 backing buffer', async () => {
	const firstGate = deferred();
	const retained = [];
	let sends = 0;
	const webSocket = {
		readyState: WebSocket.OPEN,
		发送后可复用缓冲: true,
		send(data) {
			retained.push(data);
			sends++;
			return sends === 1 ? firstGate.promise : Promise.resolve();
		},
	};
	const sender = 创建下行Grain发送器(webSocket);
	await sender.发送(new Uint8Array(16 * 1024).fill(1));
	const firstFlush = sender.发送(new Uint8Array(16 * 1024).fill(1));
	await Promise.resolve();

	assert.deepEqual(sender.状态(), { pendingBytes: 0, sending: true, reusableBuffers: 0 });
	await sender.发送(new Uint8Array(16 * 1024).fill(2));
	const secondFlush = sender.发送(new Uint8Array(16 * 1024).fill(2));
	assert.equal(retained.length, 1);
	assert.ok(retained[0].every(byte => byte === 1));

	firstGate.resolve();
	await Promise.all([firstFlush, secondFlush]);
	assert.deepEqual(sender.状态(), { pendingBytes: 0, sending: false, reusableBuffers: 1 });
	assert.ok(retained[0].every(byte => byte === 1));
	assert.ok(retained[1].every(byte => byte === 2));

	await sender.发送(new Uint8Array(16 * 1024).fill(3));
	await sender.发送(new Uint8Array(16 * 1024).fill(3));
	assert.equal(retained[2].buffer, retained[0].buffer);
	assert.ok(retained[2].every(byte => byte === 3));
});

test('XHTTP 下行连续发送复用的 backing buffer 数量有界', async () => {
	const buffers = new Set();
	const webSocket = {
		readyState: WebSocket.OPEN,
		发送后可复用缓冲: true,
		async send(data) { buffers.add(data.buffer) },
	};
	const sender = 创建下行Grain发送器(webSocket);
	for (let i = 0; i < 8; i++) {
		await sender.发送(new Uint8Array(16 * 1024).fill(i));
		await sender.发送(new Uint8Array(16 * 1024).fill(i));
	}
	assert.ok(buffers.size <= 2, `backing buffer 数量失控: ${buffers.size}`);
	sender.取消();
	assert.deepEqual(sender.状态(), { pendingBytes: 0, sending: false, reusableBuffers: 0 });
});

test('XHTTP 下行发送失败不会复用未确认的合并缓冲', async () => {
	const webSocket = {
		readyState: WebSocket.OPEN,
		发送后可复用缓冲: true,
		async send() { throw new Error('send failed') },
	};
	const sender = 创建下行Grain发送器(webSocket);
	await sender.发送(new Uint8Array(16 * 1024));
	await assert.rejects(sender.发送(new Uint8Array(16 * 1024)), /send failed/);
	assert.equal(sender.状态().reusableBuffers, 0);
	sender.取消();
});
