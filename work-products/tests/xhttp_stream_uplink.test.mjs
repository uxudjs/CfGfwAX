import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { 创建上行写入队列 };`).toString('base64')}`;
const { 创建上行写入队列 } = await import(moduleUrl);

function deferred() {
	let resolve, reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createUploadQueue(writer, overrides = {}) {
	let currentWriter = writer;
	let closeError = null;
	const queue = 创建上行写入队列({
		获取写入器: () => currentWriter,
		释放写入器() { },
		重试连接: overrides.retry
			? async () => { currentWriter = await overrides.retry() }
			: null,
		关闭连接: error => { closeError = error },
		名称: 'XHTTP测试上行',
	});
	return { queue, getCloseError: () => closeError };
}

test('XHTTP 上行在 64 KiB 或 64 条达到高水位', () => {
	const writer = { async write() { } };
	const bytesQueue = createUploadQueue(writer).queue;
	for (let i = 0; i < 4; i++) assert.equal(bytesQueue.写入(new Uint8Array(16 * 1024)), true);
	assert.equal(bytesQueue.达到高水位(), true);
	assert.deepEqual(bytesQueue.状态(), { bytes: 64 * 1024, items: 4, high: true, low: false });
	bytesQueue.清空();

	const itemsQueue = createUploadQueue(writer).queue;
	for (let i = 0; i < 64; i++) assert.equal(itemsQueue.写入(new Uint8Array(1)), true);
	assert.equal(itemsQueue.达到高水位(), true);
	assert.deepEqual(itemsQueue.状态(), { bytes: 64, items: 64, high: true, low: false });
	itemsQueue.清空();
});

test('XHTTP 上行慢 writer 只在 16 KiB 且不超过 16 条时恢复，并形成合包', async () => {
	const gate = deferred();
	const writes = [];
	const writer = {
		async write(data) {
			writes.push(Uint8Array.from(data));
			await gate.promise;
		},
	};
	const { queue } = createUploadQueue(writer);
	const expected = new Uint8Array(64 * 1024);
	for (let i = 0; i < 64; i++) {
		expected.fill(i, i * 1024, (i + 1) * 1024);
		assert.equal(queue.写入(expected.subarray(i * 1024, (i + 1) * 1024)), true);
	}
	assert.equal(queue.达到高水位(), true);
	let resumed = false;
	const lowPromise = queue.等待低水位().then(() => { resumed = true });
	await Promise.resolve();
	assert.equal(resumed, false);
	gate.resolve();
	await lowPromise;
	const lowState = queue.状态();
	assert.ok(lowState.bytes <= 16 * 1024);
	assert.ok(lowState.items <= 16);
	await queue.等待空();
	assert.equal(writes.length, 4);
	assert.deepEqual(Buffer.concat(writes.map(chunk => Buffer.from(chunk))), Buffer.from(expected));
});

test('XHTTP 上行低水位要求字节和条目条件同时成立', async () => {
	const gate = deferred();
	const { queue } = createUploadQueue({ write: () => gate.promise });
	for (let i = 0; i < 17; i++) queue.写入(new Uint8Array(1024));
	let resumed = false;
	const lowPromise = queue.等待低水位().then(() => { resumed = true });
	await Promise.resolve();
	assert.equal(resumed, false);
	gate.resolve();
	await lowPromise;
	assert.equal(queue.状态().low, true);
});

test('XHTTP 上行混合块按序且恰好一次写入', async () => {
	const writes = [];
	const { queue } = createUploadQueue({ async write(data) { writes.push(Uint8Array.from(data)) } });
	const chunks = [
		new Uint8Array(1024).fill(1),
		new Uint8Array(15 * 1024).fill(2),
		new Uint8Array(64 * 1024).fill(3),
	];
	for (const chunk of chunks) assert.equal(queue.写入(chunk), true);
	await queue.等待空();
	assert.deepEqual(Buffer.concat(writes.map(chunk => Buffer.from(chunk))), Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
});

test('XHTTP 上行整 64 KiB 块可沿既有路径等待写入完成', async () => {
	const gate = deferred();
	const { queue } = createUploadQueue({ write: () => gate.promise });
	let completed = false;
	const writing = queue.直接写入并等待(new Uint8Array(64 * 1024)).then(() => { completed = true });
	await Promise.resolve();
	assert.equal(completed, false);
	gate.resolve();
	await writing;
	assert.equal(completed, true);
	assert.deepEqual(queue.状态(), { bytes: 0, items: 0, high: false, low: true });
});

test('XHTTP 上行失败前未写数据按既有契约重试一次', async () => {
	const expected = new Uint8Array(4096).fill(7);
	let retries = 0;
	const writes = [];
	const firstWriter = { async write() { throw new Error('first write failed') } };
	const secondWriter = { async write(data) { writes.push(Uint8Array.from(data)) } };
	const { queue, getCloseError } = createUploadQueue(firstWriter, {
		async retry() {
			retries++;
			return secondWriter;
		},
	});
	queue.写入(expected, true);
	await queue.等待空();
	assert.equal(retries, 1);
	assert.equal(getCloseError(), null);
	assert.deepEqual(writes, [expected]);
});

test('XHTTP 上行写入与重试失败会拒绝等待者并关闭连接', async () => {
	const { queue, getCloseError } = createUploadQueue({ async write() { throw new Error('write failed') } }, {
		async retry() { throw new Error('retry failed') },
	});
	queue.写入(new Uint8Array(1024), true);
	await assert.rejects(queue.等待空(), /retry failed/);
	assert.match(getCloseError()?.message || '', /retry failed/);
});

test('XHTTP 上行大块直写重试失败会拒绝调用并关闭连接', async () => {
	const { queue, getCloseError } = createUploadQueue({ async write() { throw new Error('write failed') } }, {
		async retry() { throw new Error('retry failed') },
	});
	await assert.rejects(queue.直接写入并等待(new Uint8Array(64 * 1024), true), /retry failed/);
	assert.match(getCloseError()?.message || '', /retry failed/);
});

test('XHTTP 上行取消会拒绝背压等待者', async () => {
	const gate = deferred();
	const { queue } = createUploadQueue({ write: () => gate.promise });
	for (let i = 0; i < 64; i++) queue.写入(new Uint8Array(1024));
	const waiting = queue.等待低水位();
	queue.清空();
	await assert.rejects(waiting, /queue closed/);
	gate.resolve();
});

test('XHTTP 上行保留 16 MiB/4096 条硬上限', () => {
	const { queue } = createUploadQueue({ async write() { } });
	const chunk = new Uint8Array(4096);
	for (let i = 0; i < 4096; i++) assert.equal(queue.写入(chunk), true);
	assert.throws(() => queue.写入(chunk), /upload queue overflow/);
});
