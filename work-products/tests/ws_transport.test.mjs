import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };

async function loadWorkerModule() {
	const source = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { 处理WS请求 };`).toString('base64')}`;
	return import(moduleUrl);
}

function createSocketPair({ rejectOptions = false } = {}) {
	const events = [];
	let successfulAccepts = 0;
	let firstMessage = null;
	const client = { side: 'client' };
	const server = {
		readyState: WebSocket.OPEN,
		binaryType: 'blob',
		accept(options) {
			events.push(['accept', options, this.binaryType]);
			if (options && rejectOptions) throw new TypeError('options unsupported');
			successfulAccepts++;
			firstMessage = this.binaryType === 'arraybuffer'
				? new Uint8Array([1, 2, 3]).buffer
				: new Blob([new Uint8Array([1, 2, 3])]);
		},
		addEventListener(type, listener) {
			events.push(['listener', type]);
			if (type === 'message') listener({ data: firstMessage });
		},
		send() { },
		close() {
			this.readyState = WebSocket.CLOSED;
		},
	};
	let binaryType = server.binaryType;
	Object.defineProperty(server, 'binaryType', {
		get() { return binaryType },
		set(value) {
			events.push(['binaryType', value]);
			binaryType = value;
		},
		configurable: true,
	});
	return {
		pair: { 0: client, 1: server },
		events,
		get successfulAccepts() { return successfulAccepts },
		get firstMessage() { return firstMessage },
	};
}

test('WebSocket 在 accept 前固定 ArrayBuffer，并兼容无参 accept 回退', async () => {
	const { 处理WS请求 } = await loadWorkerModule();
	const originalPair = globalThis.WebSocketPair;
	const originalResponse = globalThis.Response;
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	const scenarios = [];
	globalThis.Response = class ResponseMock {
		constructor(body, init) {
			this.body = body;
			this.status = init.status;
			this.webSocket = init.webSocket;
			this.headers = init.headers;
		}
	};
	globalThis.setInterval = () => 1;
	globalThis.clearInterval = () => { };

	try {
		for (const rejectOptions of [false, true]) {
			const scenario = createSocketPair({ rejectOptions });
			scenarios.push(scenario);
			globalThis.WebSocketPair = class WebSocketPairMock {
				constructor() {
					return scenario.pair;
				}
			};
			const request = new Request('https://worker.example/ws');
			const response = await 处理WS请求(request, '11111111-1111-4111-8111-111111111111', new URL(request.url));

			assert.equal(response.status, 101);
			assert.equal(response.webSocket, scenario.pair[0]);
			assert.equal(scenario.successfulAccepts, 1, '每条路径都只能成功接受一次');
			assert.ok(scenario.firstMessage instanceof ArrayBuffer, '首个二进制消息必须同步以 ArrayBuffer 进入现有消息任务链');
			assert.ok(
				scenario.events.findIndex(([type]) => type === 'binaryType')
					< scenario.events.findIndex(([type]) => type === 'accept'),
				'binaryType 必须在首次 accept 尝试前设置',
			);
		}

		assert.equal(scenarios[0].events.filter(([type]) => type === 'accept').length, 1, '正常路径只尝试一次');
		assert.equal(scenarios[1].events.filter(([type]) => type === 'accept').length, 2, '兼容路径先尝试 options，再无参回退');
		assert.deepEqual(scenarios[1].events.filter(([type]) => type === 'accept').map(([, options]) => options), [
			{ allowHalfOpen: true },
			undefined,
		]);
	} finally {
		globalThis.WebSocketPair = originalPair;
		globalThis.Response = originalResponse;
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
});
