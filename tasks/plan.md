# 链式代理断流修复实施计划

依据：[SPEC.md](../SPEC.md)

## 执行原则

- 先写能稳定复现故障的测试，再实施最小修复。
- 生命周期与 TLS KeyUpdate 分成两个独立验证和回滚单元。
- 每个阶段只修改 `_worker.js` 与最小必要的 `*.test.mjs`；不触碰 UI、部署配置和无关代码。
- 每个阶段结束运行该阶段的聚焦测试，并设置继续门禁。

## Task 1：冻结基线并建立生命周期失败用例

依赖：无

范围：

- 在 `chain_proxy.test.mjs` 中复用真实 `connectStreams()` 调用路径。
- 构造 socket 的 `closed` 立即完成、`readable` 仍含尾部数据的确定性场景。
- 记录 WebSocket `send` 与 `close` 顺序，证明当前实现会先 close 或丢数据。
- 增加空响应重试、读取错误、发送错误的行为断言。

验收标准：

- 修复前至少一个测试稳定失败，并明确指出“尾部数据必须先于 close”。
- 测试不依赖真实网络、计时碰运气或外部代理。
- 现有 SOCKS5 分片和 CONNECT+payload 测试保持通过。

验证：

- `node --test chain_proxy.test.mjs`

回滚：

- 仅删除本任务新增测试；不改业务代码。

## Task 2：修复链式代理下行关闭竞态

依赖：Task 1

范围：

- 在 `_worker.js` 中移除链式代理入口由 socket `closed.finally(...)` 抢先关闭 WebSocket 的行为。
- 让 `connectStreams()` 在读取完成、已读数据发送完毕及发送器 `flush()` 完成后关闭 WebSocket。
- 保留“零字节才重试”的现有判定，并明确旧连接到新连接的 WebSocket 所有权交接。
- 确保正常 EOF、读取错误、发送错误、重试成功、重试失败均释放 reader/socket，且只执行一次最终关闭。
- 不改变 SOCKS5 分片缓存和尾随 payload 的字节内容。

验收标准：

- Task 1 的失败用例转绿：socket 立即关闭时，所有尾部数据先发送，随后只 close 一次。
- 空响应能重试；旧 socket 完成不会关闭重试后的 WebSocket。
- 已收到数据后不重试。
- `$socks5://`、`$http://`、`$https://` 入口使用同一生命周期规则。

验证：

- `node --test chain_proxy.test.mjs`
- `git diff --check`

提交/检查点：

- 建议独立提交：`fix: 修复链式代理关闭竞态`
- 在进入 TLS 任务前检查 diff，确认没有 TLS 行为变化。

回滚：

- 单独回滚生命周期提交；保留此前已有的 SOCKS5 分片修复及测试。

## Task 3：建立 TLS 1.3 KeyUpdate 密码学失败用例

依赖：Task 2 验证通过

范围：

- 新增聚焦的 `tls_key_update.test.mjs`，只导出/访问测试所需的最小 TLS 符号。
- 使用固定 traffic secret 和明文构造 KeyUpdate 前后的记录，不使用真实服务器或随机时序。
- 覆盖 TLS_AES_128_GCM_SHA256、TLS_AES_256_GCM_SHA384 和 TLS_CHACHA20_POLY1305_SHA256。
- 覆盖 `update_not_requested`、`update_requested`、连续更新、非法值、畸形长度和序列号重置。
- 断言 KeyUpdate 记录由旧密钥保护，后续应用记录由新密钥保护。

验收标准：

- 修复前测试稳定命中当前“不支持 KeyUpdate”错误或后续记录解密失败。
- 测试分别验证接收方向和发送方向，不只检查内部字段。
- AES-GCM 与 ChaCha20-Poly1305 至少各有一条端到端记录连续性断言。

验证：

- `node --test tls_key_update.test.mjs`
- `node --test chain_proxy.test.mjs`

回滚：

- 删除新增 TLS 测试和仅为测试增加的导出，不影响生命周期提交。

## Task 4：实现 TLS 1.3 KeyUpdate 状态转换

依赖：Task 3

范围：

- 在 TLS 1.3 握手完成时保存双向 application traffic secret。
- 增加单一用途的 next-secret/key/IV 派生辅助逻辑，使用 RFC 8446 的 `"traffic upd"` 标签。
- 接收 KeyUpdate 后更新服务端接收 secret/key/IV，并重置接收序列号。
- 对 `update_requested` 排队发送 `update_not_requested`：用旧发送密钥保护 KeyUpdate，写出成功后更新客户端发送 secret/key/IV 并重置发送序列号。
- 将 KeyUpdate 响应与应用数据放入同一发送串行化路径，保证响应先于下一条 Application Data，且记录不跨密钥代际。
- 对非法请求值或畸形消息沿现有错误路径终止连接。
- 保持 TLS 1.2 分支不变。

验收标准：

- Task 3 全部转绿。
- 连续和交叉 KeyUpdate 后仍能双向发送应用数据。
- 新旧密钥边界和序列号均由外部构造的记录断言验证。
- TLS 1.2 及现有链式代理测试无回归。

验证：

- `node --test tls_key_update.test.mjs`
- `node --test chain_proxy.test.mjs`
- `node --test *.test.mjs`
- `git diff --check`

提交/检查点：

- 建议独立提交：`fix: 支持TLS1.3密钥更新`
- 提交前检查只包含 TLS 状态、串行写入和对应测试。

回滚：

- 单独回滚 TLS KeyUpdate 提交即可恢复原行为；生命周期修复继续保留。

## Task 5：集成验证与真实链路烟测

依赖：Task 2、Task 4

范围：

- 运行全部 Node 测试和 Wrangler dry run。
- 使用脱敏测试端点分别验证短响应、上游快速关闭、长时间流式响应。
- 通过三种链式代理配置中实际可用的端点验证至少 SOCKS5 和 TLS 链路；可用时补齐 HTTP。
- 发起真实 Codex 长流式请求，确认不中断、尾部完整且无重复输出。
- 不执行 `wrangler deploy`。

验收标准：

- 自动化门禁全部通过。
- 快速关闭响应无尾部丢失。
- 长连接经历服务端 KeyUpdate 后继续传输，或由可控测试服务明确注入 KeyUpdate 并通过。
- 真实 Codex 流式请求完成；测试记录不包含凭据、Cookie 或完整代理 URL。
- 若外部烟测条件不足，明确列出未验证项，不把状态标记为完全完成。

验证：

- `node --test *.test.mjs`
- `npx wrangler deploy --dry-run`
- `git diff --check`
- 人工记录：代理类型、场景、结果、脱敏错误摘要

回滚：

- 烟测不修改生产状态；若失败，按失败边界分别回滚 TLS 或生命周期提交并重新运行自动化门禁。

## 完成定义

- SPEC A1-A8 全部有自动化或命令证据。
- SPEC A9 有脱敏烟测证据，或被明确标记为唯一待用户提供端点/环境的外部门禁。
- 两个修复单元均能独立回滚。
- 未执行部署，未修改配置格式或 UI。
