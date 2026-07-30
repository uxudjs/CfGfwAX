import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDeterministicFixture, runProfileOnce } from './xhttp_stream_benchmark.mjs';

const source = await readFile(new URL('./_worker.js', import.meta.url), 'utf8');
if (!globalThis.WebSocket) globalThis.WebSocket = { OPEN: 1, CLOSING: 2, CLOSED: 3 };
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { 获取传输协议配置, 创建上行写入队列, 创建下行Grain发送器 };`).toString('base64')}`;
const { 获取传输协议配置 } = await import(moduleUrl);

test('XHTTP 只发布 stream-one，且当前路由没有其他 mode 入口', () => {
	assert.equal(获取传输协议配置({ 传输协议: 'xhttp' }).type, 'xhttp&mode=stream-one');
	for (const forbidden of ['packet-up', 'packet-down', 'multi-stream']) {
		assert.ok(!source.includes(forbidden), `发现未纳入规格的 XHTTP mode: ${forbidden}`);
	}
	assert.match(source, /request\.method === 'POST'/);
	assert.doesNotMatch(source, /处理XHTTP请求[\s\S]{0,400}\bmode\b/);
});

test('确定性流夹具在上行、下行和双向保持字节长度、顺序与摘要', async () => {
	const fixture = createDeterministicFixture(256 * 1024);
	for (const profile of ['uplink-1kib', 'downlink-16kib', 'bidirectional-64kib']) {
		const result = await runProfileOnce(profile, fixture, { trackProxy: true });
		if (profile.startsWith('bidirectional')) {
			assert.equal(result.output.uplink.totalBytes, fixture.bytes.byteLength);
			assert.equal(result.output.downlink.totalBytes, fixture.bytes.byteLength);
			assert.equal(result.output.uplink.sha256, fixture.sha256);
			assert.equal(result.output.downlink.sha256, fixture.sha256);
		} else {
			assert.equal(result.output.totalBytes, fixture.bytes.byteLength);
			assert.equal(result.output.sha256, fixture.sha256);
		}
	}
});
