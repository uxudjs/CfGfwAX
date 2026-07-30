import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };

const source = await readFile(new URL('./_worker.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { 处理XHTTP请求 };`).toString('base64')}`;
const { 处理XHTTP请求 } = await import(moduleUrl);

function 创建VLESS首包(UUID, 域名 = 'target.example') {
	const UUID字节 = Uint8Array.from(UUID.replaceAll('-', '').match(/../g), 字节 => Number.parseInt(字节, 16));
	const 域名字节 = new TextEncoder().encode(域名);
	const 首包 = new Uint8Array(1 + 16 + 1 + 1 + 2 + 1 + 1 + 域名字节.byteLength);
	let offset = 0;
	首包[offset++] = 0;
	首包.set(UUID字节, offset);
	offset += UUID字节.byteLength;
	首包[offset++] = 0;
	首包[offset++] = 1;
	首包[offset++] = 1;
	首包[offset++] = 187;
	首包[offset++] = 2;
	首包[offset++] = 域名字节.byteLength;
	首包.set(域名字节, offset);
	return 首包;
}

test('XHTTP 后台写入失败会取消仍在等待的请求读取', async () => {
	const UUID = '11111111-1111-4111-8111-111111111111';
	let 上传控制器;
	let 上传已取消 = false;
	let 完成取消;
	const 上传取消完成 = new Promise(resolve => {
		完成取消 = resolve;
	});
	const 上传流 = new ReadableStream({
		start(controller) {
			上传控制器 = controller;
			controller.enqueue(创建VLESS首包(UUID));
		},
		cancel() {
			上传已取消 = true;
			完成取消();
		},
	});
	const request = new Request('https://worker.example/video/test', {
		method: 'POST',
		body: 上传流,
		duplex: 'half',
	});
	Object.defineProperty(request, 'fetcher', {
		value: {
			connect() {
				let 下行控制器;
				return {
					opened: Promise.resolve(),
					closed: new Promise(() => { }),
					readable: new ReadableStream({ start(controller) { 下行控制器 = controller } }),
					writable: new WritableStream({
						write() {
							throw new Error('simulated upstream write failure');
						},
					}),
					close() {
						try { 下行控制器.close() } catch (e) { }
					},
				};
			},
		},
	});
	const response = await 处理XHTTP请求(request, UUID, { 反代IP: '127.0.0.1' });
	await new Promise(resolve => setTimeout(resolve, 0));
	上传控制器.enqueue(new Uint8Array(1024));

	await Promise.race([
		上传取消完成,
		new Promise((_, reject) => setTimeout(() => reject(new Error('request read remained pending')), 250)),
	]);
	const responseResult = await response.body.getReader().read();

	assert.equal(上传已取消, true);
	assert.equal(responseResult.done, true);
});
