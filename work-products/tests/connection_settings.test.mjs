import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };

async function loadWorkerModule(extraSource = '') {
	const source = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
	return import(`data:text/javascript;base64,${Buffer.from(`${source}\n${extraSource}`).toString('base64')}`);
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

test('连接设置：并发请求各自读取配置且移动网络默认单路拨号', async () => {
	const { 读取请求连接设置 } = await loadWorkerModule();
	const 普通请求 = { cf: { country: 'US', asn: 13335 } };
	const 移动请求 = { cf: { country: 'CN', asn: 9808 } };
	const [普通设置, 移动设置] = await Promise.all([
		读取请求连接设置(普通请求, {
			KV: { get: async () => JSON.stringify({ 连接设置: { TCP并发拨号数: 4, 连接保活间隔毫秒: 5000 } }) },
		}),
		读取请求连接设置(移动请求, {
			KV: { get: async () => JSON.stringify({ 连接设置: { 反代并发拨号数: 3, 连接保活间隔毫秒: 9000 } }) },
		}),
	]);

	assert.deepEqual(普通设置, {
		预加载竞速拨号: false,
		TCP并发拨号数: 4,
		反代并发拨号数: 1,
		连接保活间隔毫秒: 5000,
	});
	assert.deepEqual(移动设置, {
		预加载竞速拨号: false,
		TCP并发拨号数: 1,
		反代并发拨号数: 3,
		连接保活间隔毫秒: 9000,
	});
});

test('请求隔离：并发 gRPC fetch 各自使用一次 KV 设置并启动对应保活周期', async () => {
	const { default: worker } = await loadWorkerModule();
	const 原始设置定时器 = globalThis.setInterval;
	const 原始清除定时器 = globalThis.clearInterval;
	const intervals = [];
	let timerId = 0;
	globalThis.setInterval = (_callback, interval) => {
		intervals.push(interval);
		return ++timerId;
	};
	globalThis.clearInterval = () => { };

	const 创建场景 = interval => {
		let KV读取次数 = 0;
		const request = new Request('https://worker.example/grpc', {
			method: 'POST',
			headers: { 'content-type': 'application/grpc' },
			body: new Uint8Array(0),
			duplex: 'half',
		});
		Object.defineProperty(request, 'cf', { value: { colo: 'TPE', country: 'US', asn: 13335 } });
		return {
			request,
			env: {
				UUID: '11111111-1111-4111-8111-111111111111',
				KV: {
					async get(key) {
						assert.equal(key, 'config.json');
						KV读取次数++;
						await Promise.resolve();
						return JSON.stringify({ 连接设置: { 连接保活间隔毫秒: interval } });
					},
				},
			},
			读取次数: () => KV读取次数,
		};
	};

	const 场景A = 创建场景(5000);
	const 场景B = 创建场景(9000);
	try {
		const responses = await Promise.all([
			worker.fetch(场景A.request, 场景A.env, { waitUntil() { } }),
			worker.fetch(场景B.request, 场景B.env, { waitUntil() { } }),
		]);
		await Promise.all(responses.map(response => response.arrayBuffer()));
		assert.deepEqual(intervals.toSorted((a, b) => a - b), [5000, 9000]);
		assert.equal(场景A.读取次数(), 1);
		assert.equal(场景B.读取次数(), 1);
	} finally {
		globalThis.setInterval = 原始设置定时器;
		globalThis.clearInterval = 原始清除定时器;
	}
});

test('请求隔离：并发 TCP 转发按各自设置决定竞速拨号数', async () => {
	const { forwardataTCP } = await loadWorkerModule('export { forwardataTCP };');
	const 创建场景 = TCP并发拨号数 => {
		let 拨号次数 = 0;
		const request = {
			fetcher: {
				connect() {
					拨号次数++;
					return {
						opened: Promise.resolve(),
						closed: Promise.resolve(),
						readable: new ReadableStream({
							start(controller) {
								controller.enqueue(new Uint8Array([1]));
								controller.close();
							},
						}),
						writable: new WritableStream(),
						close() { },
					};
				},
			},
		};
		const webSocket = {
			readyState: WebSocket.OPEN,
			send() { },
			close() { this.readyState = WebSocket.CLOSED; },
		};
		const context = {
			连接设置: {
				预加载竞速拨号: false,
				TCP并发拨号数,
				反代并发拨号数: 1,
				连接保活间隔毫秒: 30000,
			},
		};
		return { request, webSocket, context, 拨号次数: () => 拨号次数 };
	};

	const 场景A = 创建场景(2);
	const 场景B = 创建场景(4);
	await Promise.all([
		forwardataTCP('example.com', 443, new Uint8Array([1]), 场景A.webSocket, null, {}, '11111111-1111-4111-8111-111111111111', 场景A.request, 场景A.context, 'test'),
		forwardataTCP('example.net', 443, new Uint8Array([2]), 场景B.webSocket, null, {}, '11111111-1111-4111-8111-111111111111', 场景B.request, 场景B.context, 'test'),
	]);

	assert.equal(场景A.拨号次数(), 2);
	assert.equal(场景B.拨号次数(), 4);
});

test('请求隔离：订阅配置不是模块共享状态且 ADD.txt 只读取一次', async () => {
	const source = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
	assert.doesNotMatch(source, /^let config_JSON,/m);
	assert.match(source, /async fetch\(request, env, ctx\) \{\s*let config_JSON;/);
	assert.match(source, /async function 读取config_JSON\([^)]*\) \{\s*let config_JSON;/);
	const 本地订阅代码 = source.split("if (!url.searchParams.has('sub') && config_JSON.优选订阅生成.local)", 2)[1].split('const 优选API', 1)[0];
	assert.equal((本地订阅代码.match(/env\.KV\.get\('ADD\.txt'\)/g) || []).length, 1);
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
	let 成功清理次数 = 0;
	await 打开TCP连接并等待(
		() => ({ opened: Promise.resolve(), close() { } }),
		'example.com',
		443,
		直连建立超时毫秒,
		() => 1,
		id => { assert.equal(id, 1); 成功清理次数++; },
	);
	assert.equal(成功清理次数, 1, '建连成功后必须取消超时 timer');

	let 失败关闭次数 = 0, 失败清理次数 = 0;
	const 失败Socket = {
		opened: Promise.reject(new TypeError('connection failed')),
		close() {
			失败关闭次数++;
		},
	};
	await assert.rejects(
		打开TCP连接并等待(
			() => 失败Socket,
			'example.com',
			443,
			直连建立超时毫秒,
			() => 2,
			id => { assert.equal(id, 2); 失败清理次数++; },
		),
		{ name: 'TypeError', message: 'connection failed' },
	);
	assert.equal(失败关闭次数, 1);
	assert.equal(失败清理次数, 1, '建连失败后必须取消超时 timer');

	const 打开门 = deferred();
	let 超时回调 = null, 超时关闭次数 = 0, 超时清理次数 = 0, 实际超时 = null;
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
			return 3;
		},
		id => { assert.equal(id, 3); 超时清理次数++; },
	);
	assert.equal(实际超时, 直连建立超时毫秒, '测试必须使用生产超时常量');
	超时回调();
	await assert.rejects(超时任务, { name: 'Error', message: '连接超时' });
	assert.equal(超时关闭次数, 1);
	assert.equal(超时清理次数, 1, '超时触发后也必须释放 timer');
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
