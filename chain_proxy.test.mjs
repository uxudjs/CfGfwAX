import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { 追加API备注, base64SecretEncode, 读取config_JSON, 反代参数获取 };`).toString('base64')}`;
const { 追加API备注, base64SecretEncode, 读取config_JSON, 反代参数获取 } = await import(moduleUrl);

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
