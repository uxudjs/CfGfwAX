import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const wrangler配置 = await readFile(new URL('./wrangler.toml', import.meta.url), 'utf8');

test('Git 部署指向 my-site 并继承当前 Worker 的 KV 绑定', () => {
	assert.match(wrangler配置, /^\s*name\s*=\s*"my-site"\s*$/m);
	assert.match(wrangler配置, /^\[\[kv_namespaces\]\]\s*$[\s\S]*^binding\s*=\s*"KV"\s*$/m);
	assert.match(wrangler配置, /^\s*id\s*=\s*"[0-9a-f]{32}"\s*$/m);
});
