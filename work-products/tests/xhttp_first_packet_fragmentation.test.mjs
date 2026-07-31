import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workerSource = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
const instrumentedSource = workerSource.replace(
	'const 密码哈希 = sha224(token);',
	'globalThis.__xhttpSha224Observer?.(); const 密码哈希 = sha224(token);',
);
assert.notEqual(instrumentedSource, workerSource, 'Trojan SHA-224 observation point must exist');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${instrumentedSource}\nexport { 读取XHTTP首包 };`).toString('base64')}`;
const { 读取XHTTP首包 } = await import(moduleUrl);

function 创建读取器(chunks) {
	let index = 0;
	return {
		async read() {
			if (index >= chunks.length) return { done: true, value: undefined };
			return { done: false, value: chunks[index++] };
		},
	};
}

function 创建Trojan首包(token, payload = new Uint8Array([7, 8, 9])) {
	const hash = new TextEncoder().encode(createHash('sha224').update(token).digest('hex'));
	const hostname = new TextEncoder().encode('target.example');
	const packet = new Uint8Array(56 + 2 + 1 + 1 + 1 + hostname.byteLength + 2 + 2 + payload.byteLength);
	let offset = 0;
	packet.set(hash, offset);
	offset += hash.byteLength;
	packet.set([0x0d, 0x0a, 1, 3, hostname.byteLength], offset);
	offset += 5;
	packet.set(hostname, offset);
	offset += hostname.byteLength;
	packet.set([1, 187, 0x0d, 0x0a], offset);
	offset += 4;
	packet.set(payload, offset);
	return packet;
}

test('Trojan 分片首包不足 58 字节不计算 SHA，完整请求最多计算一次', async () => {
	const token = '11111111-1111-4111-8111-111111111111';
	let shaCalls = 0;
	globalThis.__xhttpSha224Observer = () => { shaCalls++ };
	try {
		const incomplete = await 读取XHTTP首包(创建读取器([new Uint8Array(20)]), token);
		assert.equal(incomplete, null);
		assert.equal(shaCalls, 0, '不足 58 字节时不应计算 SHA-224');

		shaCalls = 0;
		const packet = 创建Trojan首包(token);
		const fragmented = await 读取XHTTP首包(创建读取器([
			packet.subarray(0, 8),
			packet.subarray(8, 24),
			packet.subarray(24, 57),
			packet.subarray(57, 66),
			packet.subarray(66),
		]), token);

		assert.equal(fragmented?.协议, 'trojan');
		assert.equal(fragmented?.hostname, 'target.example');
		assert.deepEqual(fragmented?.rawData, new Uint8Array([7, 8, 9]));
		assert.equal(shaCalls, 1, '同一请求的分片重试应复用 SHA-224');

		for (const [name, invalidPacket, invalidToken] of [
			['错误 token', packet, '22222222-2222-4222-8222-222222222222'],
			['摘要篡改', (() => {
				const copy = packet.slice();
				copy[0] ^= 0xff;
				return copy;
			})(), token],
			['坏 CRLF', (() => {
				const copy = packet.slice();
				copy[56] = 0;
				return copy;
			})(), token],
		]) {
			shaCalls = 0;
			const invalid = await 读取XHTTP首包(创建读取器([invalidPacket]), invalidToken);
			assert.equal(invalid, null, `${name} 必须拒绝`);
			assert.equal(shaCalls, 1, `${name} 达到完整长度后只应计算一次 SHA-224`);
		}
	} finally {
		delete globalThis.__xhttpSha224Observer;
	}
});
