# 链式代理断流修复任务清单

状态说明：`[ ]` 待办，`[x]` 完成。只有对应验证证据已记录时才能勾选。

## 1. 生命周期回归测试

- [x] 用真实 `connectStreams()` 建立 socket 立即关闭但仍有尾部数据的失败用例
- [x] 断言 WebSocket `send` 完成后才 `close`
- [x] 覆盖空响应重试及旧 socket 不干扰新连接
- [x] 覆盖读取错误、发送错误和单次最终关闭
- [x] 运行 `node --test chain_proxy.test.mjs`，保存修复前失败证据

## 2. 生命周期实现

- [x] 移除 socket `closed` 抢先关闭 WebSocket 的链式代理路径
- [x] 由 `connectStreams()` 在发送和 `flush()` 完成后决定关闭
- [x] 保持零字节重试和已收数据不重试
- [x] 保持 SOCKS5 分片与 CONNECT+payload 尾随数据行为
- [x] 验证 SOCKS5、HTTP、HTTPS 入口使用相同生命周期
- [x] 运行 `node --test chain_proxy.test.mjs`
- [x] 运行 `git diff --check`
- [ ] 建立生命周期独立检查点/提交

## 3. TLS KeyUpdate 回归测试

- [x] 新增确定性的 `tls_key_update.test.mjs`
- [x] 覆盖 AES-128-GCM/SHA-256
- [x] 覆盖 AES-256-GCM/SHA-384
- [x] 覆盖 ChaCha20-Poly1305/SHA-256
- [x] 验证 KeyUpdate 用旧密钥、后续数据用新密钥
- [x] 覆盖 `update_not_requested` 和 `update_requested`
- [x] 覆盖连续/交叉更新、非法值和畸形长度
- [x] 验证双向序列号独立重置为 0
- [x] 保存修复前失败证据

## 4. TLS KeyUpdate 实现

- [x] 保存双向 application traffic secret
- [x] 以 `"traffic upd"` 派生下一代 secret、key 和 IV
- [x] 接收 KeyUpdate 后切换接收密钥并重置接收序列号
- [x] 用旧发送密钥发送响应，成功后切换发送密钥
- [x] 串行化 KeyUpdate 响应和应用数据写入
- [x] 确保响应早于下一条 Application Data
- [x] 保持 TLS 1.2 行为不变
- [x] 运行 `node --test tls_key_update.test.mjs`
- [x] 运行 `node --test *.test.mjs`
- [x] 运行 `git diff --check`
- [ ] 建立 TLS 独立检查点/提交

## 5. 集成与烟测

- [x] 运行 `node --test *.test.mjs`
- [x] 运行 `npx wrangler deploy --dry-run`
- [x] 验证快速关闭响应尾部完整
- [ ] 验证长连接经历 KeyUpdate 后继续传输
- [ ] 使用脱敏链式代理端点完成真实 Codex 流式烟测
- [x] 确认测试输出和仓库无代理凭据、Token、Cookie
- [x] 记录所有未完成的外部门禁
- [x] 确认未执行部署

## 验证记录

- 2026-07-27：生命周期修复前用例稳定失败，实际事件只有 `close`，尾部 `de ad be ef` 未发送；修复后相关用例通过。
- 2026-07-27：TLS 修复前，AES-128-GCM、AES-256-GCM、ChaCha20-Poly1305 均命中 `TLS 1.3 KeyUpdate is not supported by TLSClientMini`。
- 2026-07-27：`node --test` 通过，10 项测试全部成功。
- 2026-07-27：`npx wrangler deploy --dry-run` 通过，Total Upload 358.66 KiB / gzip 74.35 KiB；未执行部署。
- 2026-07-27：`git diff --check` 通过；仅报告现有 LF/CRLF 转换警告。
- 外部门禁：尚未使用真实代理端点完成长连接和 Codex 流式烟测；当前 Wrangler dry run 显示 `No bindings found`，工作区没有可安全直接使用的脱敏测试端点。
- 版本检查点：生命周期与 TLS 逻辑保持独立，但当前工作区原本已有未提交修改，且用户未授权提交，因此未创建 Git 提交。
