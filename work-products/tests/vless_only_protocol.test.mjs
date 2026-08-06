import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const 原生Digest = crypto.subtle.digest.bind(crypto.subtle);
Object.defineProperty(crypto.subtle, 'digest', {
	value: async (algorithm, data) => {
		const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
		if (name.toUpperCase() !== 'MD5') return 原生Digest(algorithm, data);
		const digest = createHash('md5').update(Buffer.from(data)).digest();
		return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
	}
});

const workerSource = await readFile(new URL('../../_worker.js', import.meta.url), 'utf8');
const readmeSource = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${workerSource}\nexport { 读取XHTTP首包, 是有效WS早期数据, 读取config_JSON, 反代参数获取, 请求优选API, 获取优选订阅生成器数据 };`).toString('base64')}`;
const { default: worker, 读取XHTTP首包, 是有效WS早期数据, 读取config_JSON, 反代参数获取, 请求优选API, 获取优选订阅生成器数据 } = await import(moduleUrl);

function parseUuid(uuid) {
	return Uint8Array.from(uuid.replaceAll('-', '').match(/../g), byte => Number.parseInt(byte, 16));
}

function createVlessPacket(uuid, payload = new Uint8Array([7, 8, 9])) {
	const hostname = new TextEncoder().encode('target.example');
	const packet = new Uint8Array(1 + 16 + 1 + 1 + 2 + 1 + 1 + hostname.byteLength + payload.byteLength);
	let offset = 0;
	packet[offset++] = 0;
	packet.set(parseUuid(uuid), offset);
	offset += 16;
	packet[offset++] = 0;
	packet[offset++] = 1;
	packet.set([1, 187, 2, hostname.byteLength], offset);
	offset += 4;
	packet.set(hostname, offset);
	offset += hostname.byteLength;
	packet.set(payload, offset);
	return packet;
}

function createTrojanPacket(token) {
	const hash = new TextEncoder().encode(createHash('sha224').update(token).digest('hex'));
	const hostname = new TextEncoder().encode('target.example');
	const packet = new Uint8Array(56 + 2 + 1 + 1 + 1 + hostname.byteLength + 2 + 2);
	let offset = 0;
	packet.set(hash, offset);
	offset += hash.byteLength;
	packet.set([0x0d, 0x0a, 1, 3, hostname.byteLength], offset);
	offset += 5;
	packet.set(hostname, offset);
	offset += hostname.byteLength;
	packet.set([1, 187, 0x0d, 0x0a], offset);
	return packet;
}

function createReader(chunks) {
	let index = 0;
	return {
		async read() {
			if (index >= chunks.length) return { done: true, value: undefined };
			return { done: false, value: chunks[index++] };
		},
	};
}

test('Worker 运行时代码不再包含 Trojan 实现', () => {
	assert.equal(/trojan|木马|sha224|tro['"]?\s*\+\s*['"]?jan/i.test(workerSource), false);
});

test('Worker WebSocket 入站不再包含 Shadowsocks 协议分流与 AEAD 运行时', () => {
	for (const pattern of [
		/url\.searchParams\.get\(['"]enc['"]\)/,
		/判断协议类型\s*===\s*['"]ss['"]/,
		/SS支持加密配置/,
		/SSAEAD(?:加密|解密)/,
		/SS派生(?:主密钥|会话密钥)/,
		/处理SS数据/,
		/获取SS上下文/,
	]) {
		assert.doesNotMatch(workerSource, pattern);
	}
});

test('XHTTP 与 WS Early Data 仅接受 VLESS 认证首包', async () => {
	const uuid = '11111111-1111-4111-8111-111111111111';
	const vlessPacket = createVlessPacket(uuid);
	const parsed = await 读取XHTTP首包(createReader([
		vlessPacket.subarray(0, 8),
		vlessPacket.subarray(8, 20),
		vlessPacket.subarray(20),
	]), uuid);

	assert.equal(parsed?.hostname, 'target.example');
	assert.equal(parsed?.port, 443);
	assert.deepEqual(parsed?.rawData, new Uint8Array([7, 8, 9]));
	assert.deepEqual(parsed?.respHeader, new Uint8Array([0, 0]));
	assert.equal(是有效WS早期数据(vlessPacket, uuid), true);

	const trojanPacket = createTrojanPacket(uuid);
	assert.equal(await 读取XHTTP首包(createReader([trojanPacket]), uuid), null);
	assert.equal(是有效WS早期数据(trojanPacket, uuid), false);
});

test('旧 Trojan 配置回落到 VLESS，动态 Trojan fallback 不再生效', async () => {
	const uuid = '11111111-1111-4111-8111-111111111111';
	const store = new Map();
	const env = {
		KV: {
			get: async key => store.get(key) ?? null,
			put: async (key, value) => store.set(key, value),
		},
	};
	const initial = await 读取config_JSON(env, 'worker.example', uuid);
	initial.协议类型 = 'trojan';
	store.set('config.json', JSON.stringify(initial));

	const migrated = await 读取config_JSON(env, 'worker.example', uuid);
	assert.equal(migrated.协议类型, 'vless');
	assert.match(migrated.LINK, /^vless:\/\//);

	const context = await 反代参数获取(new URL('https://worker.example/trojan=1.1.1.1:443'), uuid);
	assert.equal(Object.hasOwn(context, '木马反代地址'), false);
});

test('默认与旧 Shadowsocks 配置均归一化为 VLESS-only', async () => {
	assert.doesNotMatch(workerSource, /config_JSON\.SS(?:\.|\[)/);
	assert.doesNotMatch(workerSource, /协议类型\s*===\s*['"]ss['"]/);
	assert.doesNotMatch(workerSource, /`ss:\/\//);
	const uuid = '11111111-1111-4111-8111-111111111111';
	const store = new Map();
	const env = {
		KV: {
			get: async key => store.get(key) ?? null,
			put: async (key, value) => store.set(key, value),
		},
	};
	const initial = await 读取config_JSON(env, 'worker.example', uuid);
	assert.equal(initial.协议类型, 'vless');
	assert.equal(Object.hasOwn(initial, 'SS'), false);
	assert.match(initial.LINK, /^vless:\/\//);

	initial.协议类型 = 'ss';
	initial.SS = { 加密方式: 'aes-256-gcm', TLS: false };
	store.set('config.json', JSON.stringify(initial));
	const migrated = await 读取config_JSON(env, 'worker.example', uuid);
	assert.equal(migrated.协议类型, 'vless');
	assert.equal(Object.hasOwn(migrated, 'SS'), false);
	assert.match(migrated.LINK, /^vless:\/\//);
});

test('管理 API 保存时删除 Shadowsocks 字段并固定 VLESS', async () => {
	const uuid = '11111111-1111-4111-8111-111111111111';
	const store = new Map();
	let configWrites = 0;
	const env = {
		ADMIN: 'admin-password',
		KEY: 'test-key',
		UUID: uuid,
		KV: {
			get: async key => store.get(key) ?? null,
			put: async (key, value) => {
				if (key === 'config.json' && ++configWrites > 1) throw new Error('config.json write rate exceeded');
				store.set(key, value);
			},
		},
	};
	const withCf = request => {
		Object.defineProperty(request, 'cf', { value: { colo: 'TPE', asn: 0 } });
		return request;
	};
	const loginResponse = await worker.fetch(withCf(new Request('https://worker.example/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TestClient/1.0' },
		body: 'password=admin-password',
	})), env, { waitUntil() { } });
	assert.equal(loginResponse.status, 200);
	const cookie = loginResponse.headers.get('set-cookie').split(';', 1)[0];
	const baseline = await 读取config_JSON(env, 'worker.example', uuid, 'TestClient/1.0');
	configWrites = 0;
	const response = await worker.fetch(withCf(new Request('https://worker.example/admin/config.json', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'User-Agent': 'TestClient/1.0', Cookie: cookie },
		body: JSON.stringify({ ...baseline, 协议类型: 'ss', SS: { 加密方式: 'aes-128-gcm', TLS: true }, LINK: 'ss://legacy' }),
	})), env, { waitUntil() { } });
	assert.equal(response.status, 200);
	assert.equal(configWrites, 1);
	const saved = JSON.parse(store.get('config.json'));
	assert.equal(saved.协议类型, 'vless');
	assert.equal(Object.hasOwn(saved, 'SS'), false);
	assert.match(saved.LINK, /^vless:\/\//);
});

test('外部明文与 Base64 订阅只合并 VLESS URI，IP 候选保持可用', async () => {
	const mixed = [
		'vless://11111111-1111-4111-8111-111111111111@vless.example:443#vless',
		'ss://YWVzLTEyOC1nY206cGFzcw@example.com:443#ss',
		'trojan://password@example.com:443#trojan',
	].join('\n');
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async url => new Response(String(url).includes('base64') ? btoa(mixed) : String(url).includes('ips') ? '104.16.0.1:443#edge' : mixed);
	try {
		for (const url of ['https://api.example/plain', 'https://api.example/base64']) {
			const [ips, links] = await 请求优选API([url]);
			assert.deepEqual(ips, []);
			assert.equal(links.length, 1);
			assert.match(links[0], /^vless:\/\//);
		}
		const [ips, links] = await 请求优选API(['https://api.example/ips']);
		assert.deepEqual(ips, ['104.16.0.1:443#edge']);
		assert.deepEqual(links, []);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('外部优选订阅生成器只返回 VLESS URI', async () => {
	const payload = [
		'vless://00000000-0000-4000-8000-000000000000@example.com:443?security=tls#candidate',
		'vless://11111111-1111-4111-8111-111111111111@keep.example:443#keep',
		'ss://YWVzLTEyOC1nY206cGFzcw@example.com:443#ss',
		'trojan://password@example.com:443#trojan',
	].join('\n');
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(btoa(payload));
	try {
		const [ips, links] = await 获取优选订阅生成器数据('sub://generator.example');
		assert.deepEqual(ips, ['example.com:443#candidate']);
		assert.equal(links.trim(), 'vless://11111111-1111-4111-8111-111111111111@keep.example:443#keep');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('Surge 订阅入口明确停止支持且不调用转换后端', async () => {
	assert.doesNotMatch(workerSource, /surge&ver=4|Surge订阅配置文件热补丁/);
	const uuid = '11111111-1111-4111-8111-111111111111';
	const store = new Map();
	const env = {
		UUID: uuid,
		KV: {
			get: async key => store.get(key) ?? null,
			put: async (key, value) => store.set(key, value),
		},
	};
	const token = (await 读取config_JSON(env, 'worker.example', uuid)).优选订阅生成.TOKEN;
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = async () => {
		fetchCalls++;
		return new Response('[Proxy]\n');
	};
	try {
		for (const [url, userAgent] of [
			[`https://worker.example/sub?token=${token}&surge`, 'Mozilla/5.0'],
			[`https://worker.example/sub?token=${token}`, 'Surge/5.0'],
			[`https://worker.example/sub?token=${token}&target=surge`, 'Mozilla/5.0'],
			[`https://worker.example/sub?token=${token}&target=surge%26ver%3D4`, 'Mozilla/5.0'],
		]) {
			const request = new Request(url, { headers: { 'User-Agent': userAgent } });
			Object.defineProperty(request, 'cf', { value: { colo: 'TPE', asn: 0 } });
			const response = await worker.fetch(request, env, { waitUntil() { } });
			const body = await response.text();
			assert.equal(response.status, 410, `${url} | ${userAgent} | fetch=${fetchCalls} | ${body}`);
			assert.match(body, /Surge.*停止支持/);
		}
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('README 明确 Trojan 退役风险与 Surge 停止兼容', () => {
	assert.match(readmeSource, /Trojan 已从 Worker 入站、订阅生成和管理页面中移除，后续不再维护/);
	assert.match(readmeSource, /Trojan 流量存在较明确的代理协议特征/);
	assert.match(readmeSource, /Surge 不原生支持本项目保留的 VLESS 节点格式/);
	assert.match(readmeSource, /Surge User-Agent 请求会返回 HTTP 410/);
});

test('README 三语同步声明 VLESS-only 与旧 Shadowsocks 节点失效', () => {
	assert.match(readmeSource, /仅支持 VLESS 节点协议/);
	assert.match(readmeSource, /舊 Shadowsocks 節點將失效，且不提供相容期或自動轉換/);
	assert.match(readmeSource, /Supports the VLESS node protocol only/);
	assert.match(readmeSource, /Existing Shadowsocks nodes stop working; no compatibility period or automatic conversion is provided/);
	assert.equal((readmeSource.match(/SOCKS5.*(?:上游|上游|upstream)/gi) || []).length >= 3, true);
});
