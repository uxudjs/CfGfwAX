import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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

const source = await readFile(new URL('./_worker.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { 追加API备注, base64SecretEncode, 读取config_JSON, 反代参数获取, socks5Connect, connectStreams };`).toString('base64')}`;
const { default: worker, 追加API备注, base64SecretEncode, 读取config_JSON, 反代参数获取, socks5Connect, connectStreams } = await import(moduleUrl);

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
				KV: { get: async () => null },
			},
			{ waitUntil() { } },
		);
		assert.equal(upstreamUrl, 'https://uxudjs.github.io/CGAX-Pages/assets/index-test.js');
		assert.equal(response.headers.get('Content-Type'), 'application/javascript');
	} finally {
		globalThis.fetch = originalFetch;
	}
}

assert.equal(追加API备注('1.2.3.4:443#节点', '$socks5://proxy.example:1080'), '1.2.3.4:443#节点 $socks5://proxy.example:1080');
assert.equal(追加API备注('1.2.3.4:443#节点', '来源 $socks5://proxy.example'), '1.2.3.4:443#节点 [来源] $socks5://proxy.example');
assert.equal(追加API备注('1.2.3.4:443', '$socks5://[2001:db8::1]'), '1.2.3.4:443#$socks5://[2001:db8::1]');
assert.equal(追加API备注('1.2.3.4:443#节点', '来源'), '1.2.3.4:443#节点 [来源]');

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
