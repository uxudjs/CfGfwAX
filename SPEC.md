# 链式代理断流修复规格

状态：已批准

批准日期：2026-07-27

批准来源：当前任务中的用户确认

## 1. 背景与问题

Worker 使用 `$socks5://`、`$http://` 或 `$https://` 链式代理时，远端 TCP socket 很快进入 `closed` 状态后，现有 socket 生命周期回调可能先关闭 WebSocket；与此同时，`connectStreams()` 尚未把已读出的下行尾部数据发送完毕。结果是短响应、上游主动关闭或分片/合并返回时容易丢失尾部数据并表现为 Codex 流式响应断流。

本地 v2rayN 等成熟代理客户端不会复现同类问题，说明问题集中在本项目 Worker 的链式代理转发和连接生命周期管理，而不是链路本身。

此外，内置 `TLSClientMini` 收到 TLS 1.3 `KeyUpdate` 时会直接抛错。长连接期间服务端触发密钥更新会确定性中断，构成独立的 Codex 长流断流风险。

## 2. 目标

- G1：消除 socket 已关闭与 WebSocket 下行发送之间的关闭竞态。
- G2：保证 socket EOF/关闭后，已读取的下行数据和发送器缓冲先完成发送，再关闭 WebSocket。
- G3：保留无首包时的直连重试、`ProxyIP` 回退和现有链式代理配置格式。
- G4：保留现有 SOCKS5 分片读取及 CONNECT 响应尾随数据处理。
- G5：按 RFC 8446 实现 TLS 1.3 接收、响应和连续多次 `KeyUpdate`。
- G6：用真实 `connectStreams()` 调用路径及确定性的 TLS 密钥测试覆盖回归。

## 3. 功能要求

### R1. 下行生命周期所有权

- WebSocket 的正常关闭必须由下行转发流程在完成读取和发送器 `flush()` 后决定。
- socket 的 `closed` Promise 不得在下行尾部数据仍可能待发送时抢先关闭 WebSocket。
- socket 读取或 WebSocket 发送发生不可恢复错误时，仍须可靠关闭当前连接。
- 读取器必须在所有完成、错误和重试分支中正确取消或释放，不遗留锁。

### R2. 重试语义

- 首次连接没有收到任何数据时，继续执行现有重试函数。
- 重试交接期间不得提前关闭仍被复用的 WebSocket。
- 已收到至少一个字节后，不得再触发直连/`ProxyIP` 回退，以免重复响应。
- 重试失败时必须终止当前 WebSocket，不得悬挂。

### R3. SOCKS5 兼容性

- 方法选择、用户名密码认证和 CONNECT 响应允许任意网络分片。
- SOCKS5 CONNECT 响应与目标应用数据合并在同一次读取中时，尾随数据必须原样进入下行转发。
- `$socks5://`、`$http://`、`$https://` 三种链式代理共享相同的下行生命周期保证。

### R4. TLS 1.3 KeyUpdate

- TLS 1.3 握手完成后必须保留客户端和服务端 application traffic secret。
- 收到 KeyUpdate 时必须校验消息长度和值；只接受 `update_not_requested(0)` 和 `update_requested(1)`。
- 入站 KeyUpdate 记录用旧服务端接收密钥解密；随后以 `"traffic upd"` 派生下一代服务端 traffic secret、key 和 IV，并把服务端接收序列号重置为 0。
- 收到 `update_requested(1)` 时，必须在下一条 Application Data 前发送 `update_not_requested(0)` 响应。
- 出站 KeyUpdate 响应必须用旧客户端发送密钥加密；发送成功后再派生下一代客户端 traffic secret、key 和 IV，并把客户端发送序列号重置为 0。
- KeyUpdate 响应和普通应用数据写入必须串行化，不能跨越密钥代际或乱序。
- 必须支持连续及交叉的 KeyUpdate；TLS 1.2 行为保持不变。

## 4. 非功能要求

- 变更限定在 Worker 链式代理、TLS 最小客户端和对应 Node 回归测试。
- 遵循当前 JavaScript 风格，不进行无关重构或大范围格式化。
- 不记录代理凭据、访问令牌、Cookie、目标内容或完整连接字符串。
- 生命周期修复和 TLS KeyUpdate 必须可独立提交、验证和回滚。

## 5. 非目标

- 不新增 TLS 证书验证能力。
- 不扩展 TLS 1.3 到当前未支持的 cipher suite 或其他握手功能。
- 不修改 `CGAX-Pages` 静态管理界面。
- 不改变链式代理 URL/配置格式。
- 不部署 Cloudflare Worker。
- 不借此重构全部代理或 TLS 实现。

## 6. 验收标准

- A1：真实 `connectStreams()` 调用路径测试证明：socket 立即关闭时，已缓冲尾部数据在 WebSocket close 前完整发送。
- A2：空响应仍触发现有重试；重试成功不被旧 socket 的 close 事件中断。
- A3：SOCKS5 分片、认证、域名响应及 CONNECT+payload 合并场景全部通过。
- A4：HTTP、HTTPS、SOCKS5 链式代理入口不再直接以 socket `closed` 抢先关闭 WebSocket。
- A5：AES-GCM 和 ChaCha20-Poly1305 下，KeyUpdate 后的双向记录可以继续加解密，序列号从 0 重新开始。
- A6：`update_requested` 响应严格早于下一条应用数据；非法值和畸形消息被拒绝。
- A7：连续 KeyUpdate 和 TLS 1.2 回归测试通过。
- A8：`node --test *.test.mjs`、`npx wrangler deploy --dry-run` 和 `git diff --check` 通过。
- A9：使用不含敏感信息的测试代理完成短连接、长连接和真实 Codex 流式烟测；若缺少可用端点，代码合入门禁保持为“自动验证通过、外部烟测待完成”，不得宣称生产风险已完全消除。

## 7. 风险与回滚

- 生命周期风险：过早关闭改为转发流程所有后，错误分支若遗漏可能导致连接悬挂。测试必须覆盖 EOF、读取错误、发送错误、重试成功和重试失败。
- 密钥更新风险：密钥切换顺序、序列号或并发写入任一错误都会导致认证失败。实现必须基于确定性密钥材料进行逐记录验证。
- 回滚顺序：TLS KeyUpdate 作为独立提交可先回滚；生命周期提交可独立回滚。现有 SOCKS5 分片修复不得被回滚动作误删。
