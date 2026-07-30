import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };

async function loadWorkerModule() {
	const source = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
	return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function deferred() {
	let resolve, reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

test('连接设置：KV 值生效，环境变量优先且保活间隔受下限保护', async () => {
	const { 解析连接设置 } = await loadWorkerModule();
	const kvSettings = {
		预加载竞速拨号: true,
		TCP并发拨号数: 3,
		反代并发拨号数: 2,
		连接保活间隔毫秒: 5000
	};

	assert.deepEqual(
		解析连接设置({}, kvSettings),
		{ 预加载竞速拨号: true, TCP并发拨号数: 3, 反代并发拨号数: 2, 连接保活间隔毫秒: 5000 }
	);
	assert.deepEqual(
		解析连接设置({ PRELOAD_RACE_DIAL: 'false', TCP_CONCURRENT_DIAL: '4', PROXY_CONCURRENT_DIAL: '3', KEEPALIVE_INTERVAL: '999' }, kvSettings),
		{ 预加载竞速拨号: false, TCP并发拨号数: 4, 反代并发拨号数: 3, 连接保活间隔毫秒: 1000 }
	);
});

test('连接设置：缺失或非法 KV 值回退，低于最小值时钳制', async () => {
	const { 解析连接设置 } = await loadWorkerModule();
	assert.deepEqual(
		解析连接设置({}, { TCP并发拨号数: 0, 反代并发拨号数: 'NaN', 连接保活间隔毫秒: 0 }),
		{ 预加载竞速拨号: false, TCP并发拨号数: 1, 反代并发拨号数: 1, 连接保活间隔毫秒: 1000 }
	);
});

test('WebSocket 保活：按配置周期发送空文本帧并在停止后清理 timer', async () => {
	const { 启动WebSocket保活 } = await loadWorkerModule();
	const timers = new Map();
	const intervals = [];
	let nextTimerId = 1;
	const 设置定时器 = (callback, interval) => {
		const id = nextTimerId++;
		timers.set(id, callback);
		intervals.push(interval);
		return id;
	};
	const 清除定时器 = id => timers.delete(id);
	const tick = () => {
		for (const callback of [...timers.values()]) callback();
	};
	const payloads = [];
	const webSocket = {
		readyState: WebSocket.OPEN,
		send(payload) {
			payloads.push(payload);
		},
	};

	const 停止 = 启动WebSocket保活(webSocket, 5000, 设置定时器, 清除定时器);
	assert.deepEqual(intervals, [5000]);
	assert.equal(timers.size, 1);

	tick();
	assert.deepEqual(payloads, ['']);
	assert.equal(typeof payloads[0], 'string');

	webSocket.readyState = WebSocket.CLOSED;
	tick();
	assert.deepEqual(payloads, [''], '非 OPEN 状态不得继续发送');

	webSocket.readyState = WebSocket.OPEN;
	停止();
	停止();
	assert.equal(timers.size, 0, '停止必须幂等清理 timer');
	tick();
	assert.deepEqual(payloads, [''], '停止后不得继续发送');
});

test('连接生命周期：真实建连失败与超时使用不同错误且都关闭 socket', async () => {
	const { 打开TCP连接并等待, 直连建立超时毫秒 } = await loadWorkerModule();
	let 失败关闭次数 = 0;
	const 失败Socket = {
		opened: Promise.reject(new TypeError('connection failed')),
		close() {
			失败关闭次数++;
		},
	};
	await assert.rejects(
		打开TCP连接并等待(() => 失败Socket, 'example.com', 443, 直连建立超时毫秒, () => 1),
		{ name: 'TypeError', message: 'connection failed' },
	);
	assert.equal(失败关闭次数, 1);

	const 打开门 = deferred();
	let 超时回调 = null, 超时关闭次数 = 0, 实际超时 = null;
	const 超时Socket = {
		opened: 打开门.promise,
		close() {
			超时关闭次数++;
		},
	};
	const 超时任务 = 打开TCP连接并等待(
		() => 超时Socket,
		'example.com',
		443,
		直连建立超时毫秒,
		(callback, timeout) => {
			超时回调 = callback;
			实际超时 = timeout;
			return 1;
		},
	);
	assert.equal(实际超时, 直连建立超时毫秒, '测试必须使用生产超时常量');
	超时回调();
	await assert.rejects(超时任务, { name: 'Error', message: '连接超时' });
	assert.equal(超时关闭次数, 1);
});

test('连接生命周期：排队调用只等待既有 connectingPromise', async () => {
	const { 等待进行中连接 } = await loadWorkerModule();
	const 连接门 = deferred();
	const wrapper = { socket: null, connectingPromise: 连接门.promise };
	let 已完成 = false;
	const 等待任务 = 等待进行中连接(wrapper).then(result => {
		已完成 = true;
		return result;
	});

	await Promise.resolve();
	assert.equal(已完成, false, '既有连接未完成时排队调用不得提前完成');
	assert.equal(wrapper.socket, null, '排队等待不得创建或替换 socket');
	连接门.resolve();
	assert.equal(await 等待任务, true);
});

test('连接生命周期：竞速落败连接在最终打开后关闭', async () => {
	const { 并发选择已打开连接 } = await loadWorkerModule();
	const 先到门 = deferred();
	const 后到门 = deferred();
	let 先到关闭次数 = 0, 后到关闭次数 = 0;
	const 先到Socket = { close() { 先到关闭次数++ } };
	const 后到Socket = { close() { 后到关闭次数++ } };
	const 选择任务 = 并发选择已打开连接([
		先到门.promise,
		后到门.promise,
	]);

	先到门.resolve({ socket: 先到Socket, candidate: { attempt: 0 } });
	const winner = await 选择任务;
	assert.equal(winner.socket, 先到Socket);
	assert.equal(先到关闭次数, 0);
	assert.equal(后到关闭次数, 0, '尚未打开的落败连接不能同步取消');

	后到门.resolve({ socket: 后到Socket, candidate: { attempt: 1 } });
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(先到关闭次数, 0);
	assert.equal(后到关闭次数, 1, '落败连接打开后必须立即关闭');
});
