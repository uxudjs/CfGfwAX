import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadWorkerModule() {
	const source = await readFile(new URL('./_worker.js', import.meta.url), 'utf8');
	return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('连接设置：KV 值生效，环境变量优先且保活间隔受下限保护', async () => {
	const { 解析连接设置 } = await loadWorkerModule();
	const kvSettings = {
		预加载竞速拨号: true,
		TCP并发拨号数: 3,
		反代并发拨号数: 2,
		连接保活间隔毫秒: 5000
	};

	assert.deepEqual(
		解析连接设置({}, kvSettings),
		{ 预加载竞速拨号: true, TCP并发拨号数: 3, 反代并发拨号数: 2, 连接保活间隔毫秒: 5000 }
	);
	assert.deepEqual(
		解析连接设置({ PRELOAD_RACE_DIAL: 'false', TCP_CONCURRENT_DIAL: '4', PROXY_CONCURRENT_DIAL: '3', KEEPALIVE_INTERVAL: '999' }, kvSettings),
		{ 预加载竞速拨号: false, TCP并发拨号数: 4, 反代并发拨号数: 3, 连接保活间隔毫秒: 1000 }
	);
});

test('连接设置：缺失或非法 KV 值回退，低于最小值时钳制', async () => {
	const { 解析连接设置 } = await loadWorkerModule();
	assert.deepEqual(
		解析连接设置({}, { TCP并发拨号数: 0, 反代并发拨号数: 'NaN', 连接保活间隔毫秒: 0 }),
		{ 预加载竞速拨号: false, TCP并发拨号数: 1, 反代并发拨号数: 1, 连接保活间隔毫秒: 1000 }
	);
});
