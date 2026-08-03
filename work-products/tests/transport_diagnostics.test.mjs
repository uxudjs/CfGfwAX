import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };

const source = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { connectStreams, 构建断流诊断 };`).toString('base64')}`;
const { connectStreams, 构建断流诊断 } = await import(moduleUrl);

test('断流诊断分别白名单化入站传输和出站代理', () => {
	const 诊断 = 构建断流诊断({
		stage: 'send',
		inboundTransport: 'xhttp',
		outboundTransport: 'https',
		hasData: true,
		error: new TypeError('secret'),
		closeReason: 'send-failed',
		transport: 'https://user:password@proxy.example',
	});

	assert.deepEqual(诊断, {
		stage: 'send',
		inboundTransport: 'xhttp',
		outboundTransport: 'https',
		hasData: true,
		errorName: 'TypeError',
		closeReason: 'send-failed',
	});
	assert.deepEqual(构建断流诊断({
		inboundTransport: 'sensitive-path',
		outboundTransport: 'https://user:password@proxy.example',
	}), {
		stage: 'connect',
		inboundTransport: 'unknown',
		outboundTransport: 'unknown',
		hasData: false,
		errorName: '',
		closeReason: 'unspecified',
	});
});

test('connectStreams 为 XHTTP、WS 和 gRPC 保留独立入站分类', async () => {
	for (const inboundTransport of ['xhttp', 'websocket', 'grpc']) {
		const 诊断列表 = [];
		const reader = {
			async read() { throw new Error('read failed') },
			async cancel() { },
			releaseLock() { },
		};
		const remoteSocket = {
			readable: {
				getReader(options) {
					if (options) throw new TypeError('BYOB unavailable');
					return reader;
				},
			},
			close() { },
		};
		const webSocket = {
			readyState: WebSocket.OPEN,
			send() { },
			close() { this.readyState = WebSocket.CLOSED },
		};

		await connectStreams(
			remoteSocket,
			webSocket,
			null,
			null,
			'direct',
			诊断 => 诊断列表.push(构建断流诊断(诊断)),
			inboundTransport,
		);

		assert.deepEqual(诊断列表, [{
			stage: 'read',
			inboundTransport,
			outboundTransport: 'direct',
			hasData: false,
			errorName: 'Error',
			closeReason: 'read-failed',
		}]);
	}
});

test('三个入站处理器显式传递自己的传输类型', () => {
	const calls = [...source.matchAll(/forwardataTCP\(([\s\S]*?)\);/g)].map(match => match[1]);

	assert.equal(calls.filter(call => call.includes("'xhttp'")).length, 1);
	assert.equal(calls.filter(call => call.includes("'grpc'")).length, 1);
	assert.equal(calls.filter(call => call.includes("'websocket'")).length, 3);
});
