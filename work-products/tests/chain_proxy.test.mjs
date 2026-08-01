import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };

const 原生Digest = crypto.subtle.digest.bind(crypto.subtle);
Object.defineProperty(crypto.subtle, 'digest', {
	value: async (algorithm, data) => {
		const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
		if (name.toUpperCase() !== 'MD5') return 原生Digest(algorithm, data);
		const digest = createHash('md5').update(Buffer.from(data)).digest();
		return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
	}
});

const source = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { 追加API备注, base64SecretEncode, 读取config_JSON, 反代参数获取, 处理XHTTP请求, socks5Connect, httpConnect, connectStreams, 构建断流诊断 };`).toString('base64')}`;
const { default: worker, 追加API备注, base64SecretEncode, 读取config_JSON, 反代参数获取, 处理XHTTP请求, socks5Connect, httpConnect, connectStreams, 构建断流诊断 } = await import(moduleUrl);

{
	const request = new Request('https://worker.example/version?uuid=11111111-1111-4111-8111-111111111111');
	Object.defineProperty(request, 'cf', { value: { colo: 'TPE' } });
	const response = await worker.fetch(
		request,
		{ UUID: '11111111-1111-4111-8111-111111111111' },
		{ waitUntil() { } },
	);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { Version: '2.4.11' });
}

{
	const originalFetch = globalThis.fetch;
	let upstreamUrl = null;
	globalThis.fetch = async input => {
		upstreamUrl = typeof input === 'string' ? input : input.url;
		return new Response('console.log("loaded")', {
			headers: { 'Content-Type': 'application/javascript' },
		});
	};
	try {
		const request = new Request('https://worker.example/assets/index-test.js');
		Object.defineProperty(request, 'cf', { value: { colo: 'TPE' } });
		const response = await worker.fetch(
			request,
			{
				UUID: '11111111-1111-4111-8111-111111111111',
				URL: 'https://cloudflare-error-page-3th.pages.dev',
				KV: { get: async () => null },
			},
			{ waitUntil() { } },
		);
		assert.equal(upstreamUrl, 'https://cloudflare-error-page-3th.pages.dev/assets/index-test.js');
		assert.equal(response.headers.get('Content-Type'), 'application/javascript');
	} finally {
		globalThis.fetch = originalFetch;
	}
}

assert.equal(追加API备注('1.2.3.4:443#节点', '$socks5://proxy.example:1080'), '1.2.3.4:443#节点 $socks5://proxy.example:1080');
assert.equal(追加API备注('1.2.3.4:443#节点', '来源 $socks5://proxy.example'), '1.2.3.4:443#节点 [来源] $socks5://proxy.example');
assert.equal(追加API备注('1.2.3.4:443', '$socks5://[2001:db8::1]'), '1.2.3.4:443#$socks5://[2001:db8::1]');
assert.equal(追加API备注('1.2.3.4:443#节点', '来源'), '1.2.3.4:443#节点 [来源]');

{
	const 配置 = await 读取config_JSON({ KV: { get: async () => null, put: async () => { } } }, 'worker.example', '11111111-1111-4111-8111-111111111111');
	assert.equal(配置.优选订阅生成.SUBNAME, 'CfGfwAX');
}

for (const 代理协议 of ['socks5', 'http']) {
	for (const 全局 of [false, true]) {
		const KV存储 = new Map();
		const env = {
			KV: {
				get: async key => KV存储.get(key) ?? null,
				put: async (key, value) => KV存储.set(key, value),
			}
		};
		const UUID = '11111111-1111-4111-8111-111111111111';
		const 代理账号 = 'demo:secret@proxy.example:1080';
		const 初始配置 = await 读取config_JSON(env, 'worker.example', UUID);
		初始配置.反代.SOCKS5 = { ...初始配置.反代.SOCKS5, 启用: 代理协议, 全局, 账号: 代理账号 };
		KV存储.set('config.json', JSON.stringify(初始配置));

		const 配置 = await 读取config_JSON(env, 'worker.example', UUID);
		const 路径 = new URL(配置.LINK).searchParams.get('path');
		assert.ok(路径.startsWith('/video/'), `${代理协议} 应使用编码路径`);
		for (const 明文片段 of ['demo', 'secret', 'proxy.example']) {
			assert.ok(!路径.includes(明文片段), `${代理协议} 路径不应泄露 ${明文片段}`);
		}

		const 反代配置 = await 反代参数获取(new URL(`https://worker.example${路径}`), UUID);
		assert.equal(反代配置.代理类型, 代理协议);
		assert.equal(反代配置.代理全局, 全局);
		assert.deepEqual(反代配置.代理参数, {
			username: 'demo',
			password: 'secret',
			hostname: 'proxy.example',
			port: 1080,
		});
	}
}

const 旧UUID = '11111111-1111-4111-8111-111111111111';
const 旧链式代理数据 = { type: 'socks5', username: 'demo', password: 'secret', hostname: 'proxy.example', port: 1080 };
const 旧链式代理路径 = `/video/${base64SecretEncode(JSON.stringify(旧链式代理数据), 旧UUID)}`;
const 旧链式代理配置 = await 反代参数获取(new URL(`https://worker.example${旧链式代理路径}`), 旧UUID);
assert.equal(旧链式代理配置.代理全局, true);

test('XHTTP 追加的单个尾斜杠不改变链式代理上下文', async () => {
	const UUID = '11111111-1111-4111-8111-111111111111';
	const 链式代理数据 = { type: 'socks5', username: 'demo', password: 'secret', hostname: 'proxy.example', port: 1080 };
	const 密文 = base64SecretEncode(JSON.stringify(链式代理数据), UUID);
	const 无尾斜杠配置 = await 反代参数获取(new URL(`https://worker.example/video/${密文}`), UUID);
	const 有尾斜杠配置 = await 反代参数获取(new URL(`https://worker.example/video/${密文}/`), UUID);

	assert.deepEqual(有尾斜杠配置, 无尾斜杠配置);
});

test('XHTTP 上传异常关闭已建立的远端连接', async () => {
	const UUID = '11111111-1111-4111-8111-111111111111';
	const UUID字节 = Uint8Array.from(UUID.replaceAll('-', '').match(/../g), 字节 => Number.parseInt(字节, 16));
	const 域名 = new TextEncoder().encode('target.example');
	const 首包 = new Uint8Array(1 + 16 + 1 + 1 + 2 + 1 + 1 + 域名.byteLength);
	let 偏移 = 0;
	首包[偏移++] = 0;
	首包.set(UUID字节, 偏移);
	偏移 += UUID字节.byteLength;
	首包[偏移++] = 0;
	首包[偏移++] = 1;
	首包[偏移++] = 1;
	首包[偏移++] = 187;
	首包[偏移++] = 2;
	首包[偏移++] = 域名.byteLength;
	首包.set(域名, 偏移);

	let 上传控制器;
	const 请求体 = new ReadableStream({
		start(controller) {
			上传控制器 = controller;
			controller.enqueue(首包);
		}
	});
	const 连接列表 = [];
	const request = new Request('https://worker.example/video/test', { method: 'POST', body: 请求体, duplex: 'half' });
	Object.defineProperty(request, 'fetcher', {
		value: {
			connect() {
				let 下行控制器, 已关闭 = false;
				const socket = {
					opened: Promise.resolve(),
					closed: new Promise(() => { }),
					readable: new ReadableStream({ start(controller) { 下行控制器 = controller; } }),
					writable: new WritableStream(),
					close() {
						已关闭 = true;
						try { 下行控制器.close() } catch (e) { }
					},
					get 已关闭() { return 已关闭; }
				};
				连接列表.push(socket);
				return socket;
			}
		}
	});

	const response = await 处理XHTTP请求(request, UUID);
	await new Promise(resolve => setTimeout(resolve, 0));
	const 远端连接 = 连接列表.find(socket => !socket.已关闭);
	assert.ok(远端连接);
	const responseReader = response.body.getReader();
	上传控制器.error(new Error('simulated upload reset'));
	const 结束结果 = await responseReader.read();

	assert.equal(结束结果.done, true);
	assert.equal(远端连接.已关闭, true);
});

test('合法标准 Base64 尾斜杠由原始候选优先解析', async () => {
	const 密钥 = String.fromCharCode(130);
	const 链式代理数据 = { type: 'socks5', username: 'demo', password: 'secret', hostname: 'f.example', port: 1080 };
	const 密文 = base64SecretEncode(JSON.stringify(链式代理数据), 密钥);
	assert.ok(密文.endsWith('/'), '测试密文必须以合法 Base64 字符 / 结尾');

	const 配置 = await 反代参数获取(new URL(`https://worker.example/video/${密文}`), 密钥);
	assert.equal(配置.代理类型, 'socks5');
	assert.equal(配置.代理参数.hostname, 'f.example');
});

test('无效链式代理密文必须失败关闭', async () => {
	await assert.rejects(
		反代参数获取(new URL('https://worker.example/video/invalid!'), 'test-secret'),
		/链式代理参数无效/
	);
});

test('带尾斜杠的无效链式代理密文必须失败关闭', async () => {
	await assert.rejects(
		反代参数获取(new URL('https://worker.example/video/invalid!/'), 'test-secret'),
		/链式代理参数无效/
	);
});

function 创建模拟TCP连接(响应块) {
	const 写入 = [];
	let 已关闭 = false;
	const readable = new ReadableStream({
		start(controller) {
			for (const chunk of 响应块) controller.enqueue(new Uint8Array(chunk));
			controller.close();
		}
	});
	const writable = new WritableStream({
		write(chunk) {
			写入.push(new Uint8Array(chunk));
		}
	});
	const socket = {
		readable,
		writable,
		closed: Promise.resolve(),
		close() {
			已关闭 = true;
		}
	};
	return { socket, 写入, get 已关闭() { return 已关闭 } };
}

function 创建CONNECT模拟TCP连接(响应块, { 打开门 = Promise.resolve(), 写入错误 = null, 读取错误 = null, 保持打开 = false } = {}) {
	const 写入 = [];
	const 连接参数 = [];
	let 已关闭 = false, 已取消 = false, 可写流关闭 = false;
	let 响应索引 = 0;
	const socket = {
		opened: 打开门,
		readable: new ReadableStream({
			pull(controller) {
				if (响应索引 < 响应块.length) {
					controller.enqueue(new Uint8Array(响应块[响应索引++]));
				} else if (读取错误) {
					controller.error(读取错误);
				} else if (!保持打开) {
					controller.close();
				} else {
					return new Promise(() => { });
				}
			},
			cancel() {
				已取消 = true;
			},
		}),
		writable: new WritableStream({
			write(chunk) {
				if (写入错误) throw 写入错误;
				写入.push(new Uint8Array(chunk));
			},
			close() {
				可写流关闭 = true;
			},
		}),
		closed: Promise.resolve(),
		close() {
			已关闭 = true;
		},
	};
	const TCP连接 = (...args) => {
		连接参数.push(args);
		return socket;
	};
	return {
		socket,
		TCP连接,
		写入,
		连接参数,
		get 已关闭() { return 已关闭 },
		get 已取消() { return 已取消 },
		get 可写流关闭() { return 可写流关闭 },
	};
}

async function 有界等待(promise, message) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), 100);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

for (const HTTPS代理 of [false, true]) {
	test(`${HTTPS代理 ? 'HTTPS' : 'HTTP'} CONNECT 同读首包按序且恰好一次`, async () => {
		const 首包 = [0xde, 0xad];
		const 后续包 = [0xbe, 0xef];
		const 模拟连接 = 创建CONNECT模拟TCP连接([
			[...new TextEncoder().encode('HTTP/1.1 200 Connection Established\r\n\r\n'), ...首包],
			后续包,
		]);

		const socket = await 有界等待(
			httpConnect(
				'example.com',
				443,
				null,
				HTTPS代理,
				模拟连接.TCP连接,
				{ hostname: 'proxy.example', port: 8443 },
			),
			`${HTTPS代理 ? 'HTTPS' : 'HTTP'} CONNECT 返回前被首包写入阻塞`,
		);
		const reader = socket.readable.getReader();
		const 收到 = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			收到.push(...value);
		}

		assert.deepEqual(收到, [...首包, ...后续包]);
		assert.equal(模拟连接.已关闭, false);
	});
}

test('HTTPS CONNECT 等待 opened 并保持原生 TLS 连接参数', async () => {
	let 允许打开;
	const 打开门 = new Promise(resolve => { 允许打开 = resolve });
	const 模拟连接 = 创建CONNECT模拟TCP连接([
		[...new TextEncoder().encode('HTTP/1.1 200 Connection Established\r\n\r\n')],
	], { 打开门 });

	const 连接任务 = httpConnect(
		'example.com',
		443,
		null,
		true,
		模拟连接.TCP连接,
		{ hostname: 'proxy.example', port: 8443 },
	);
	await Promise.resolve();
	assert.equal(模拟连接.写入.length, 0, 'opened 完成前不得发送 CONNECT');
	assert.deepEqual(模拟连接.连接参数, [
		[{ hostname: 'proxy.example', port: 8443 }, { secureTransport: 'on', allowHalfOpen: false }],
	]);
	允许打开();
	await 连接任务;
	assert.equal(模拟连接.写入.length, 1);
});

test('HTTP CONNECT 无同读首包时保持原始 socket 接口', async () => {
	const 模拟连接 = 创建CONNECT模拟TCP连接([
		[...new TextEncoder().encode('HTTP/1.1 200 Connection Established\r\n\r\n')],
	]);
	const socket = await httpConnect(
		'example.com',
		443,
		null,
		false,
		模拟连接.TCP连接,
		{ hostname: 'proxy.example', port: 8080 },
	);

	assert.equal(socket, 模拟连接.socket);
	assert.equal(socket.readable.locked, false);
	assert.equal(socket.writable.locked, false);
});

test('HTTP CONNECT 同读首包下游取消时释放 reader 并关闭 socket', async () => {
	const 模拟连接 = 创建CONNECT模拟TCP连接([
		[...new TextEncoder().encode('HTTP/1.1 200 Connection Established\r\n\r\n'), 0xde, 0xad],
	], { 保持打开: true });
	const socket = await httpConnect(
		'example.com',
		443,
		null,
		false,
		模拟连接.TCP连接,
		{ hostname: 'proxy.example', port: 8080 },
	);
	const reader = socket.readable.getReader();
	assert.deepEqual([...(await reader.read()).value], [0xde, 0xad]);
	await reader.cancel('downstream cancelled');

	assert.equal(模拟连接.已取消, true);
	assert.equal(模拟连接.socket.readable.locked, false);
	assert.equal(模拟连接.已关闭, true);
});

test('HTTP CONNECT 同读首包后读取失败时释放 reader 并关闭 socket', async () => {
	const 模拟连接 = 创建CONNECT模拟TCP连接([
		[...new TextEncoder().encode('HTTP/1.1 200 Connection Established\r\n\r\n'), 0xde, 0xad],
	], { 读取错误: new Error('read failed') });
	const socket = await httpConnect(
		'example.com',
		443,
		null,
		false,
		模拟连接.TCP连接,
		{ hostname: 'proxy.example', port: 8080 },
	);
	const reader = socket.readable.getReader();
	assert.deepEqual([...(await reader.read()).value], [0xde, 0xad]);
	await assert.rejects(reader.read(), /read failed/);

	assert.equal(模拟连接.socket.readable.locked, false);
	assert.equal(模拟连接.已关闭, true);
});

test('HTTP CONNECT initialData 写入失败时释放 writer 并关闭 socket', async () => {
	const 模拟连接 = 创建CONNECT模拟TCP连接([
		[...new TextEncoder().encode('HTTP/1.1 200 Connection Established\r\n\r\n')],
	], { 写入错误: new Error('write failed') });

	await assert.rejects(
		httpConnect(
			'example.com',
			443,
			new Uint8Array([0xaa]),
			false,
			模拟连接.TCP连接,
			{ hostname: 'proxy.example', port: 8080 },
		),
		/write failed/,
	);
	assert.equal(模拟连接.socket.writable.locked, false);
	assert.equal(模拟连接.socket.readable.locked, false);
	assert.equal(模拟连接.已关闭, true);
});

for (const stage of ['connect', 'read', 'tls', 'send', 'flush', 'eof']) {
	test(`断流诊断 ${stage} 阶段只保留白名单字段`, () => {
		const error = new Error('Authorization: Bearer secret-token https://target.example/private?uuid=secret');
		error.name = 'secret-error-name';
		const 诊断 = 构建断流诊断({
			stage,
			inboundTransport: '/private/xhttp/path',
			outboundTransport: 'https://user:password@proxy.example',
			hasData: stage !== 'connect',
			error,
			closeReason: 'Cookie=session-secret',
			target: 'target.example',
			authorization: 'Bearer secret-token',
		});

		assert.deepEqual(Object.keys(诊断), ['stage', 'inboundTransport', 'outboundTransport', 'hasData', 'errorName', 'closeReason']);
		assert.equal(诊断.stage, stage);
		assert.equal(诊断.inboundTransport, 'unknown');
		assert.equal(诊断.outboundTransport, 'unknown');
		assert.equal(诊断.errorName, 'Error');
		assert.equal(诊断.closeReason, 'unspecified');
		for (const sensitive of ['secret-token', 'target.example', 'password', 'Cookie', 'Authorization']) {
			assert.ok(!JSON.stringify(诊断).includes(sensitive));
		}
	});
}

test('HTTP CONNECT 建连失败记录 connect 阶段', async () => {
	const 诊断列表 = [];
	await assert.rejects(
		httpConnect(
			'private.example',
			443,
			null,
			false,
			() => { throw new TypeError('proxy password leaked') },
			{ hostname: 'proxy.example', port: 8080 },
			诊断 => 诊断列表.push(构建断流诊断(诊断)),
		),
		/proxy password leaked/,
	);
	assert.deepEqual(诊断列表, [{
		stage: 'connect',
		inboundTransport: 'unknown',
		outboundTransport: 'http',
		hasData: false,
		errorName: 'TypeError',
		closeReason: 'connect-failed',
	}]);
});

test('HTTPS CONNECT 打开失败记录 tls 阶段', async () => {
	const 诊断列表 = [];
	const 模拟连接 = 创建CONNECT模拟TCP连接([], {
		打开门: Promise.reject(new Error('TLS credentials leaked')),
	});
	await assert.rejects(
		httpConnect(
			'private.example',
			443,
			null,
			true,
			模拟连接.TCP连接,
			{ hostname: 'proxy.example', port: 8443 },
			诊断 => 诊断列表.push(构建断流诊断(诊断)),
		),
		/TLS credentials leaked/,
	);
	assert.deepEqual(诊断列表, [{
		stage: 'tls',
		inboundTransport: 'unknown',
		outboundTransport: 'https',
		hasData: false,
		errorName: 'Error',
		closeReason: 'tls-failed',
	}]);
});

test('connectStreams 读取失败记录 read 阶段', async () => {
	const 诊断列表 = [];
	const remoteSocket = {
		readable: new ReadableStream({
			start(controller) {
				controller.error(new Error('Cookie=session-secret'));
			},
		}),
		close() { },
	};
	const webSocket = {
		readyState: WebSocket.OPEN,
		send() { },
		close() {
			this.readyState = WebSocket.CLOSED;
		},
	};

	await connectStreams(remoteSocket, webSocket, null, null, 'http', 诊断 => 诊断列表.push(构建断流诊断(诊断)));
	assert.deepEqual(诊断列表, [{
		stage: 'read',
		inboundTransport: 'unknown',
		outboundTransport: 'http',
		hasData: false,
		errorName: 'Error',
		closeReason: 'read-failed',
	}]);
});

test('connectStreams 直接发送失败记录 send 阶段', async () => {
	const 诊断列表 = [];
	const remoteSocket = {
		readable: new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(32 * 1024));
				controller.close();
			},
		}),
		close() { },
	};
	const webSocket = {
		readyState: WebSocket.OPEN,
		send() {
			throw new Error('Authorization: secret');
		},
		close() {
			this.readyState = WebSocket.CLOSED;
		},
	};

	await connectStreams(remoteSocket, webSocket, null, null, 'socks5', 诊断 => 诊断列表.push(构建断流诊断(诊断)));
	assert.deepEqual(诊断列表, [{
		stage: 'send',
		inboundTransport: 'unknown',
		outboundTransport: 'socks5',
		hasData: true,
		errorName: 'Error',
		closeReason: 'send-failed',
	}]);
});

test('connectStreams 尾部发送失败记录 flush 阶段', async () => {
	const 诊断列表 = [];
	const remoteSocket = {
		readable: new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array([0x01]));
				controller.close();
			},
		}),
		close() { },
	};
	const webSocket = {
		readyState: WebSocket.OPEN,
		send() {
			throw new Error('target.example/private');
		},
		close() {
			this.readyState = WebSocket.CLOSED;
		},
	};

	await connectStreams(remoteSocket, webSocket, null, null, 'direct', 诊断 => 诊断列表.push(构建断流诊断(诊断)));
	assert.deepEqual(诊断列表, [{
		stage: 'flush',
		inboundTransport: 'unknown',
		outboundTransport: 'direct',
		hasData: true,
		errorName: 'Error',
		closeReason: 'flush-failed',
	}]);
});

test('connectStreams 正常结束记录 eof 阶段', async () => {
	const 诊断列表 = [];
	const remoteSocket = {
		readable: new ReadableStream({
			start(controller) {
				controller.close();
			},
		}),
	};
	const webSocket = {
		readyState: WebSocket.OPEN,
		send() { },
		close() {
			this.readyState = WebSocket.CLOSED;
		},
	};

	await connectStreams(remoteSocket, webSocket, null, null, 'direct', 诊断 => 诊断列表.push(构建断流诊断(诊断)));
	assert.deepEqual(诊断列表, [{
		stage: 'eof',
		inboundTransport: 'unknown',
		outboundTransport: 'direct',
		hasData: false,
		errorName: '',
		closeReason: 'remote-eof',
	}]);
});

{
	const 模拟连接 = 创建模拟TCP连接([
		[0x05],
		[0x02],
		[0x01],
		[0x00],
		[0x05, 0x00, 0x00],
		[0x03, 0x05, 0x70, 0x72, 0x6f],
		[0x78, 0x79, 0x1f, 0x90],
	]);
	const socket = await socks5Connect(
		'example.com',
		443,
		new Uint8Array([0xaa, 0xbb]),
		() => 模拟连接.socket,
		{ username: 'demo', password: 'secret', hostname: 'proxy.example', port: 1080 },
	);
	assert.equal(socket, 模拟连接.socket, 'SOCKS5 分片握手后应返回原始隧道');
	assert.deepEqual([...模拟连接.写入.at(-1)], [0xaa, 0xbb], 'SOCKS5 分片握手后应写入首包');
	assert.equal(模拟连接.已关闭, false);
}

{
	const 模拟连接 = 创建模拟TCP连接([
		[0x05, 0x00],
		[0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x1f, 0x90, 0xde, 0xad],
		[0xbe, 0xef],
	]);
	const socket = await socks5Connect(
		'example.com',
		443,
		null,
		() => 模拟连接.socket,
		{ hostname: 'proxy.example', port: 1080 },
	);
	const reader = socket.readable.getReader();
	const 收到 = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		收到.push(...value);
	}
	assert.deepEqual(收到, [0xde, 0xad, 0xbe, 0xef], 'SOCKS5 CONNECT 回包后的隧道数据不得丢失');
}

{
	const 事件 = [];
	const webSocket = {
		readyState: WebSocket.OPEN,
		send(payload) {
			事件.push(['send', [...new Uint8Array(payload)]]);
		},
		close() {
			事件.push(['close']);
			this.readyState = WebSocket.CLOSED;
		},
	};
	const remoteSocket = {
		readable: new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
				controller.close();
			}
		}),
		closed: Promise.resolve(),
	};

	await connectStreams(remoteSocket, webSocket, null, null);

	assert.deepEqual(事件, [
		['send', [0xde, 0xad, 0xbe, 0xef]],
		['close'],
	], 'socket 关闭后必须先发送尾部数据再关闭 WebSocket');
}

{
	let 重试次数 = 0;
	const 事件 = [];
	const webSocket = {
		readyState: WebSocket.OPEN,
		send() {
			事件.push('send');
		},
		close() {
			事件.push('close');
			this.readyState = WebSocket.CLOSED;
		},
	};
	const remoteSocket = {
		readable: new ReadableStream({
			start(controller) {
				controller.close();
			}
		}),
		close() {
			事件.push('remote-close');
		},
	};

	await connectStreams(remoteSocket, webSocket, null, async () => {
		重试次数++;
	});

	assert.equal(重试次数, 1, '空响应必须触发一次重试');
	assert.deepEqual(事件, ['remote-close'], '重试交接时不得关闭 WebSocket');
}

{
	const 事件 = [];
	const webSocket = {
		readyState: WebSocket.OPEN,
		send() {
			throw new Error('send failed');
		},
		close() {
			事件.push('close');
			this.readyState = WebSocket.CLOSED;
		},
	};
	const remoteSocket = {
		readable: new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array([0x01]));
				controller.close();
			}
		}),
		close() {
			事件.push('remote-close');
		},
	};

	await connectStreams(remoteSocket, webSocket, null, null);

	assert.deepEqual(事件, ['remote-close', 'close'], '发送失败必须关闭远端连接和 WebSocket 各一次');
}

{
	const 事件 = [];
	const webSocket = {
		readyState: WebSocket.OPEN,
		send() {
			事件.push('send');
		},
		close() {
			事件.push('close');
			this.readyState = WebSocket.CLOSED;
		},
	};
	const remoteSocket = {
		readable: new ReadableStream({
			start(controller) {
				controller.error(new Error('read failed'));
			}
		}),
		close() {
			事件.push('remote-close');
		},
	};

	await connectStreams(remoteSocket, webSocket, null, null);

	assert.deepEqual(事件, ['remote-close', 'close'], '读取失败必须关闭远端连接和 WebSocket 各一次');
}

{
	const 事件 = [];
	const webSocket = {
		readyState: WebSocket.OPEN,
		send() {
			事件.push('send');
		},
		close() {
			事件.push('close');
			this.readyState = WebSocket.CLOSED;
		},
	};
	const remoteSocket = {
		readable: new ReadableStream({
			start(controller) {
				controller.close();
			}
		}),
		close() {
			事件.push('remote-close');
		},
	};

	await connectStreams(remoteSocket, webSocket, null, async () => {
		throw new Error('retry failed');
	});

	assert.deepEqual(事件, ['remote-close', 'close'], '重试失败必须关闭 WebSocket');
}
