import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const changelog = await readFile(new URL('../../CHANGELOG', import.meta.url), 'utf8');
const 组件标题 = new Set(['ADD', 'Change', 'Debug', 'Delete', 'New']);

test('CHANGELOG 三级标题只使用管理页已有组件样式', () => {
	const headings = [...changelog.matchAll(/^###\s+(.+)$/gm)].map(match => match[1].trim());
	const unsupported = [...new Set(headings.filter(heading => !组件标题.has(heading)))];

	assert.deepEqual(unsupported, []);
});
