import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./_worker.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { 追加API备注 };`).toString('base64')}`;
const { 追加API备注 } = await import(moduleUrl);

assert.equal(追加API备注('1.2.3.4:443#节点', '$socks5://proxy.example:1080'), '1.2.3.4:443#节点 $socks5://proxy.example:1080');
assert.equal(追加API备注('1.2.3.4:443#节点', '来源 $socks5://proxy.example'), '1.2.3.4:443#节点 [来源] $socks5://proxy.example');
assert.equal(追加API备注('1.2.3.4:443', '$socks5://[2001:db8::1]'), '1.2.3.4:443#$socks5://[2001:db8::1]');
assert.equal(追加API备注('1.2.3.4:443#节点', '来源'), '1.2.3.4:443#节点 [来源]');
