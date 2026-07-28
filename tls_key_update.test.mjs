import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./_worker.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}
export {
	TlsClient,
	aesGcmDecryptWithKey,
	aesGcmEncryptWithKey,
	buildHandshakeMessage,
	buildTlsRecord,
	chacha20Poly1305Decrypt,
	chacha20Poly1305Encrypt,
	concatBytes,
	deriveTrafficKeys,
	hkdfExpandLabel,
	importAesGcmKey,
	tlsBytes,
	uint16be,
	uint64be,
	xorSequenceIntoIv,
	CONTENT_TYPE_APPLICATION_DATA,
	CONTENT_TYPE_HANDSHAKE,
	EMPTY_BYTES,
	HANDSHAKE_TYPE_KEY_UPDATE,
	TLS_VERSION_12
};`).toString('base64')}`;
const {
	TlsClient,
	aesGcmDecryptWithKey,
	aesGcmEncryptWithKey,
	buildHandshakeMessage,
	buildTlsRecord,
	chacha20Poly1305Decrypt,
	chacha20Poly1305Encrypt,
	concatBytes,
	deriveTrafficKeys,
	hkdfExpandLabel,
	importAesGcmKey,
	tlsBytes,
	uint16be,
	uint64be,
	xorSequenceIntoIv,
	CONTENT_TYPE_APPLICATION_DATA,
	CONTENT_TYPE_HANDSHAKE,
	EMPTY_BYTES,
	HANDSHAKE_TYPE_KEY_UPDATE,
	TLS_VERSION_12,
} = await import(moduleUrl);

const cipherSuites = [
	{ name: 'TLS_AES_128_GCM_SHA256', hash: 'SHA-256', keyLen: 16, ivLen: 12, chacha: false },
	{ name: 'TLS_AES_256_GCM_SHA384', hash: 'SHA-384', keyLen: 32, ivLen: 12, chacha: false },
	{ name: 'TLS_CHACHA20_POLY1305_SHA256', hash: 'SHA-256', keyLen: 32, ivLen: 12, chacha: true },
];

const hashLength = hash => hash === 'SHA-384' ? 48 : 32;

async function protectTls13(secret, cipher, sequenceNumber, content, innerType) {
	const [key, iv] = await deriveTrafficKeys(cipher.hash, secret, cipher.keyLen, cipher.ivLen);
	const plaintext = concatBytes(content, [innerType]);
	const nonce = xorSequenceIntoIv(iv, sequenceNumber);
	const additionalData = tlsBytes(CONTENT_TYPE_APPLICATION_DATA, 3, 3, uint16be(plaintext.length + 16));
	const encrypted = cipher.chacha
		? await chacha20Poly1305Encrypt(key, nonce, plaintext, additionalData)
		: await aesGcmEncryptWithKey(await importAesGcmKey(key, ['encrypt']), nonce, plaintext, additionalData);
	return buildTlsRecord(CONTENT_TYPE_APPLICATION_DATA, encrypted);
}

async function unprotectTls13(secret, cipher, sequenceNumber, record) {
	const length = record[3] << 8 | record[4];
	const ciphertext = record.subarray(5, 5 + length);
	const [key, iv] = await deriveTrafficKeys(cipher.hash, secret, cipher.keyLen, cipher.ivLen);
	const nonce = xorSequenceIntoIv(iv, sequenceNumber);
	const additionalData = tlsBytes(CONTENT_TYPE_APPLICATION_DATA, 3, 3, uint16be(ciphertext.length));
	const plaintext = cipher.chacha
		? await chacha20Poly1305Decrypt(key, nonce, ciphertext, additionalData)
		: await aesGcmDecryptWithKey(await importAesGcmKey(key, ['decrypt']), nonce, ciphertext, additionalData);
	return {
		data: plaintext.subarray(0, -1),
		type: plaintext.at(-1),
	};
}

function createSocket(records) {
	const writes = [];
	return {
		socket: {
			readable: new ReadableStream({
				start(controller) {
					controller.enqueue(concatBytes(...records));
					controller.close();
				}
			}),
			writable: new WritableStream({
				write(chunk) {
					writes.push(new Uint8Array(chunk));
				}
			}),
			close() { },
		},
		writes,
	};
}

async function createTls13Client(socket, cipher, clientSecret, serverSecret) {
	const client = new TlsClient(socket, { timeout: 0 });
	client.handshakeComplete = true;
	client.isTls13 = true;
	client.cipherConfig = cipher;
	client.clientAppTrafficSecret = clientSecret;
	client.serverAppTrafficSecret = serverSecret;
	[client.clientAppKey, client.clientAppIv] = await deriveTrafficKeys(cipher.hash, clientSecret, cipher.keyLen, cipher.ivLen);
	[client.serverAppKey, client.serverAppIv] = await deriveTrafficKeys(cipher.hash, serverSecret, cipher.keyLen, cipher.ivLen);
	client.clientSeqNum = 0n;
	client.serverSeqNum = 0n;
	return client;
}

for (const cipher of cipherSuites) {
	test(`${cipher.name} 在 KeyUpdate 后继续双向传输`, async () => {
		const secretLength = hashLength(cipher.hash);
		const clientSecret = Uint8Array.from({ length: secretLength }, (_, index) => index + 1);
		const serverSecret = Uint8Array.from({ length: secretLength }, (_, index) => 0xa0 + index & 0xff);
		const nextServerSecret = await hkdfExpandLabel(cipher.hash, serverSecret, 'traffic upd', EMPTY_BYTES, secretLength);
		const keyUpdate = buildHandshakeMessage(HANDSHAKE_TYPE_KEY_UPDATE, new Uint8Array([1]));
		const inboundKeyUpdate = await protectTls13(serverSecret, cipher, 0n, keyUpdate, CONTENT_TYPE_HANDSHAKE);
		const inboundPayload = await protectTls13(nextServerSecret, cipher, 0n, new Uint8Array([0xde, 0xad]), CONTENT_TYPE_APPLICATION_DATA);
		const { socket, writes } = createSocket([inboundKeyUpdate, inboundPayload]);
		const client = await createTls13Client(socket, cipher, clientSecret, serverSecret);

		assert.deepEqual([...await client.read()], [0xde, 0xad], '接收密钥更新后应以新密钥和序列号 0 解密应用数据');
		assert.equal(writes.length, 1, 'update_requested 必须产生一个 KeyUpdate 响应');

		const response = await unprotectTls13(clientSecret, cipher, 0n, writes[0]);
		assert.equal(response.type, CONTENT_TYPE_HANDSHAKE, 'KeyUpdate 响应必须是握手记录');
		assert.deepEqual([...response.data], [...buildHandshakeMessage(HANDSHAKE_TYPE_KEY_UPDATE, new Uint8Array([0]))], 'KeyUpdate 响应必须使用 update_not_requested');

		await client.write(new Uint8Array([0xbe, 0xef]));
		assert.equal(writes.length, 2, 'KeyUpdate 响应后应继续发送应用数据');
		const nextClientSecret = await hkdfExpandLabel(cipher.hash, clientSecret, 'traffic upd', EMPTY_BYTES, secretLength);
		const outboundPayload = await unprotectTls13(nextClientSecret, cipher, 0n, writes[1]);
		assert.equal(outboundPayload.type, CONTENT_TYPE_APPLICATION_DATA);
		assert.deepEqual([...outboundPayload.data], [0xbe, 0xef], '发送密钥更新后应以新密钥和序列号 0 加密应用数据');
	});
}

test('连续接收 KeyUpdate 时逐代更新接收密钥且不产生多余响应', async () => {
	const cipher = cipherSuites[0];
	const secretLength = hashLength(cipher.hash);
	const clientSecret = Uint8Array.from({ length: secretLength }, (_, index) => index + 1);
	const serverSecret = Uint8Array.from({ length: secretLength }, (_, index) => 0x70 + index);
	const nextServerSecret = await hkdfExpandLabel(cipher.hash, serverSecret, 'traffic upd', EMPTY_BYTES, secretLength);
	const secondServerSecret = await hkdfExpandLabel(cipher.hash, nextServerSecret, 'traffic upd', EMPTY_BYTES, secretLength);
	const keyUpdate = buildHandshakeMessage(HANDSHAKE_TYPE_KEY_UPDATE, new Uint8Array([0]));
	const records = [
		await protectTls13(serverSecret, cipher, 0n, keyUpdate, CONTENT_TYPE_HANDSHAKE),
		await protectTls13(nextServerSecret, cipher, 0n, keyUpdate, CONTENT_TYPE_HANDSHAKE),
		await protectTls13(secondServerSecret, cipher, 0n, new Uint8Array([0x01, 0x02]), CONTENT_TYPE_APPLICATION_DATA),
	];
	const { socket, writes } = createSocket(records);
	const client = await createTls13Client(socket, cipher, clientSecret, serverSecret);

	assert.deepEqual([...await client.read()], [0x01, 0x02]);
	assert.equal(writes.length, 0, 'update_not_requested 不得产生 KeyUpdate 响应');
});

for (const invalidBody of [new Uint8Array(0), new Uint8Array([2])]) {
	test(`拒绝非法 KeyUpdate 消息体 ${JSON.stringify([...invalidBody])}`, async () => {
		const cipher = cipherSuites[0];
		const secretLength = hashLength(cipher.hash);
		const clientSecret = new Uint8Array(secretLength).fill(0x11);
		const serverSecret = new Uint8Array(secretLength).fill(0x22);
		const keyUpdate = buildHandshakeMessage(HANDSHAKE_TYPE_KEY_UPDATE, invalidBody);
		const { socket } = createSocket([
			await protectTls13(serverSecret, cipher, 0n, keyUpdate, CONTENT_TYPE_HANDSHAKE),
		]);
		const client = await createTls13Client(socket, cipher, clientSecret, serverSecret);

		await assert.rejects(client.read(), /Invalid TLS 1\.3 KeyUpdate/);
	});
}

test('KeyUpdate 处理中并发应用写入必须排在响应和发送密钥切换之后', async () => {
	const cipher = cipherSuites[0];
	const secretLength = hashLength(cipher.hash);
	const clientSecret = new Uint8Array(secretLength).fill(0x31);
	const serverSecret = new Uint8Array(secretLength).fill(0x42);
	const nextServerSecret = await hkdfExpandLabel(cipher.hash, serverSecret, 'traffic upd', EMPTY_BYTES, secretLength);
	const keyUpdate = buildHandshakeMessage(HANDSHAKE_TYPE_KEY_UPDATE, new Uint8Array([1]));
	const { socket, writes } = createSocket([
		await protectTls13(serverSecret, cipher, 0n, keyUpdate, CONTENT_TYPE_HANDSHAKE),
		await protectTls13(nextServerSecret, cipher, 0n, new Uint8Array([0xaa]), CONTENT_TYPE_APPLICATION_DATA),
	]);
	const client = await createTls13Client(socket, cipher, clientSecret, serverSecret);
	const 原始更新接收密钥 = client.updateServerAppTrafficKeys.bind(client);
	let 允许更新接收密钥;
	const 更新接收密钥门 = new Promise(resolve => {
		允许更新接收密钥 = resolve;
	});
	let 已开始更新接收密钥;
	const 已开始更新接收密钥门 = new Promise(resolve => {
		已开始更新接收密钥 = resolve;
	});
	client.updateServerAppTrafficKeys = async () => {
		已开始更新接收密钥();
		await 更新接收密钥门;
		return 原始更新接收密钥();
	};

	const readPromise = client.read();
	await 已开始更新接收密钥门;
	const writePromise = client.write(new Uint8Array([0xbb]));
	允许更新接收密钥();
	assert.deepEqual([...await readPromise], [0xaa]);
	await writePromise;

	assert.equal(writes.length, 2);
	const response = await unprotectTls13(clientSecret, cipher, 0n, writes[0]);
	assert.equal(response.type, CONTENT_TYPE_HANDSHAKE, '并发写入时 KeyUpdate 响应必须先发送');
	const nextClientSecret = await hkdfExpandLabel(cipher.hash, clientSecret, 'traffic upd', EMPTY_BYTES, secretLength);
	const payload = await unprotectTls13(nextClientSecret, cipher, 0n, writes[1]);
	assert.equal(payload.type, CONTENT_TYPE_APPLICATION_DATA);
	assert.deepEqual([...payload.data], [0xbb]);
});

test('连续 update_requested 分别使用对应代际的旧发送密钥响应', async () => {
	const cipher = cipherSuites[0];
	const secretLength = hashLength(cipher.hash);
	const clientSecret = new Uint8Array(secretLength).fill(0x51);
	const serverSecret = new Uint8Array(secretLength).fill(0x62);
	const nextClientSecret = await hkdfExpandLabel(cipher.hash, clientSecret, 'traffic upd', EMPTY_BYTES, secretLength);
	const nextServerSecret = await hkdfExpandLabel(cipher.hash, serverSecret, 'traffic upd', EMPTY_BYTES, secretLength);
	const secondServerSecret = await hkdfExpandLabel(cipher.hash, nextServerSecret, 'traffic upd', EMPTY_BYTES, secretLength);
	const keyUpdate = buildHandshakeMessage(HANDSHAKE_TYPE_KEY_UPDATE, new Uint8Array([1]));
	const { socket, writes } = createSocket([
		await protectTls13(serverSecret, cipher, 0n, keyUpdate, CONTENT_TYPE_HANDSHAKE),
		await protectTls13(nextServerSecret, cipher, 0n, keyUpdate, CONTENT_TYPE_HANDSHAKE),
		await protectTls13(secondServerSecret, cipher, 0n, new Uint8Array([0xcc]), CONTENT_TYPE_APPLICATION_DATA),
	]);
	const client = await createTls13Client(socket, cipher, clientSecret, serverSecret);

	assert.deepEqual([...await client.read()], [0xcc]);
	assert.equal(writes.length, 2);
	assert.equal((await unprotectTls13(clientSecret, cipher, 0n, writes[0])).type, CONTENT_TYPE_HANDSHAKE);
	assert.equal((await unprotectTls13(nextClientSecret, cipher, 0n, writes[1])).type, CONTENT_TYPE_HANDSHAKE);
});

test('TLS 1.2 应用数据加密行为保持不变', async () => {
	const { socket, writes } = createSocket([]);
	const client = new TlsClient(socket, { timeout: 0 });
	const plaintext = new Uint8Array([0x10, 0x20, 0x30]);
	client.handshakeComplete = true;
	client.isTls13 = false;
	client.cipherConfig = { hash: 'SHA-256', keyLen: 16, ivLen: 4, chacha: false };
	client.clientWriteKey = new Uint8Array(16).fill(0x73);
	client.clientWriteIv = new Uint8Array(4).fill(0x84);
	client.clientSeqNum = 0n;

	await client.write(plaintext);

	assert.equal(writes.length, 1);
	const record = writes[0];
	const ciphertext = record.subarray(5);
	const explicitNonce = ciphertext.subarray(0, 8);
	const encryptedData = ciphertext.subarray(8);
	const additionalData = concatBytes(
		uint64be(0n),
		[CONTENT_TYPE_APPLICATION_DATA],
		uint16be(TLS_VERSION_12),
		uint16be(plaintext.length),
	);
	const decrypted = await aesGcmDecryptWithKey(
		await importAesGcmKey(client.clientWriteKey, ['decrypt']),
		concatBytes(client.clientWriteIv, explicitNonce),
		encryptedData,
		additionalData,
	);
	assert.deepEqual([...decrypted], [...plaintext]);
});
