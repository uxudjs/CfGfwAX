# Spec: SOCKS5/HTTP XHTTP 子 KiB CPU 优化

## 状态

已执行。用户明确要求按 `@uxu-code:spec → @uxu-code:plan → @uxu-code:build` 连续执行。

## 实施结论

- Trojan 首包 SHA-224 惰性单次计算通过功能回归，保留。
- 子 KiB 三方向基准和公平 Web Streams 对照已建立，保留。
- 显式 SOCKS5/HTTP XHTTP TCP 原生 `pipeTo` 候选在修正后的稳定公平基准中位数点估计低约 `4.5%`，但处于本地观测波动尺度内，未证明可重复收益且远低于 `50%` 性能门，已从 Worker 回滚。
- 原始数据与判定见 `work-products/debug/xhttp-native-pipe-no-go.md`。
- Cloudflare 生产仍未验证；本次不宣称已消除所有 `10 ms` CPU 超限。

## 目标

降低 XHTTP 在显式 SOCKS5/HTTP 上游代理、TCP 转发场景中的每块 JavaScript CPU 开销，重点覆盖 `64 B`、`128 B`、`256 B`、`512 B` 小块上传、下载和双向流量；同时消除分片首包阶段对 Trojan SHA-224 的重复计算。

本任务不承诺任意请求都能稳定低于 Cloudflare 的 `10 ms` CPU 限额。若改用原生流转发后真实生产流量仍超限，需要由用户选择拆分请求、降低单请求工作量或调整 Cloudflare 套餐。

## 已确认事实

- 报错请求为 `POST /view/video/.../?ed=2560`，`content-type: application/grpc-web`，Worker 结果为 `exceededCpu`。
- 样本记录显示 `cpuTimeMs: 10`、`wallTimeMs: 2169`，符合累计 JavaScript 流处理工作触及 CPU 限额，而不是单纯等待上游超时。
- 用户仅使用 SOCKS5/HTTP 上游代理；不需要为 SSTP、自定义 HTTPS/TLS 代理路径设计本次优化。
- 当前 XHTTP 上传和下载都由 JavaScript `read()`/`write()` 循环逐块搬运；现有性能基准最小块为 `1 KiB`。
- Trojan 首包在每次分片重试解析时都会先计算 SHA-224，短于完整首包的分片也会重复付出该成本。
- 显式 SOCKS5/HTTP 建连成功后均可取得原生 `ReadableStream`/`WritableStream`。

## 范围

### 1. 子 KiB 基准

- 在现有 XHTTP 流基准中加入 `64 B`、`128 B`、`256 B`、`512 B`。
- 每种大小覆盖上传、下载、双向三类场景。
- 保留既有 `1 KiB`、`16 KiB`、`64 KiB` 场景、固定负载、预热、原始轮次、摘要、代码指纹和稳定性判断。
- 新增兼容 JavaScript 泵与目标原生管道的同条件对照，避免把环境波动误判为优化收益。

### 2. Trojan 首包 SHA-224

- 累积数据不足 `58` 字节时不得计算 SHA-224。
- 达到可解析长度后，在单个 XHTTP 请求闭包内惰性计算一次并复用。
- 保持现有协议判断顺序、认证比较、`rawData`、错误语义和响应字节不变。
- 不增加跨请求或全局密码哈希缓存。

### 3. SOCKS5/HTTP TCP 原生流转发

仅在以下条件全部满足时启用：

- 当前请求为 XHTTP；
- 当前传输为 TCP；
- 代理类型是显式 `socks5` 或 `http`；
- 上游代理握手已经成功并返回原生 socket 流。

行为要求：

- 首包中的 `rawData` 仍且仅写入上游一次。
- 释放首包读取器后，剩余请求体使用 `request.body.pipeTo(remoteSocket.writable)`。
- 下行使用 `remoteSocket.readable.pipeTo(responseWritable)`。
- VLESS 的两字节响应头只写一次，然后再转交原生管道；Trojan 不添加该头。
- 使用原生 Streams 背压，不引入定时批处理或固定最小读取长度。
- 上传 EOF 正常关闭上游 writable。
- 请求取消、响应取消或任一方向报错时关闭 socket，并终止另一方向，不能遗留锁或悬挂 Promise。
- 其他路径继续使用现有队列和 JavaScript 泵，包括 UDP、直连、SSTP、自定义 HTTPS/TLS、WebSocket、gRPC、XMUX 及兼容回退。

## 接口与兼容性

- 不修改公开 URL、查询参数、鉴权、订阅格式、状态码或响应头。
- 不改变代理选择和回退规则。
- 不改变 TCP 字节内容与顺序。
- 内部 XHTTP bridge 可增加可选的 readable/writable 能力，但现有 `send`/`close` 语义须保留给 UDP 和兼容路径。
- 不新增配置项，不改变默认设置。

## 非目标

- 不修改 WebSocket、gRPC 或 XMUX 实现。
- 不优化 SOCKS5/HTTP 握手算法本身。
- 不引入计时器聚合、`readAtLeast()` 或应用层分块协议。
- 不执行 Wrangler 部署，不宣称本地 Node 结果等同 Cloudflare 生产证明。
- 不处理与本任务无关的既有代码、格式或 CHANGELOG 改动。

## 风险与控制

- **半关闭语义变化**：原生 `pipeTo()` 默认关闭目标。通过针对 EOF、取消、单向错误的回归测试确认符合当前 XHTTP 生命周期。
- **双向错误竞态**：集中 socket 关闭并容忍重复关闭；测试两方向失败不会产生未处理拒绝。
- **响应头重复或丢失**：精确断言 VLESS/Trojan 首字节序列。
- **适用范围扩大**：测试显式代理命中原生路径，非目标传输仍命中兼容路径。
- **基准噪声**：保留校准、原始轮次和 CV 阈值；不以单轮结果作结论。

## 测试设计

新增：

- `work-products/tests/xhttp_stream_tiny_chunks.test.mjs`
- `work-products/tests/xhttp_first_packet_fragmentation.test.mjs`

RED 证据：

1. 现有基准没有子 KiB profile。
2. 当前 Trojan 分片首包在一次请求内会多次执行 SHA-224。
3. 当前显式 SOCKS5/HTTP TCP 仍通过逐块 JavaScript 泵，而不是原生 `pipeTo()`。

回归覆盖：

- `64 B`、`128 B`、`256 B`、`512 B` 三类流向均可执行并输出稳定性数据。
- Trojan 首包被拆成多个小分片时，SHA-224 每请求最多一次。
- SOCKS5 与 HTTP、VLESS 与 Trojan 的上传/下载字节及顺序正确。
- VLESS 响应头一次，Trojan 无响应头。
- EOF、取消、上传错误、下载错误均能收敛，不挂起、不重复写首包。
- 非目标路径保持使用兼容泵。
- 既有全部 Node 回归继续通过。

## 可量化验收标准

- 功能：
  - 目标路径字节、顺序、协议头、状态码和响应头与现有行为一致。
  - Trojan SHA-224 每个请求最多计算一次，且不足 `58` 字节时不计算。
  - 所有 EOF、取消和错误测试在有限超时内完成，无未处理拒绝和 stream lock 泄漏。
- 性能：
  - 子 KiB profile 的基准 CPU 变异系数 `CV ≤ 10%` 才可用于结论。
  - 子 KiB 双向场景中，原生管道 CPU 中位数相对兼容 JavaScript 泵至少下降 `50%`。
  - 既有 `1 KiB`、`16 KiB`、`64 KiB` 场景的中位数不得回退超过 `5%`。
- 验证：
  - `node --test`
  - `node --check _worker.js`
  - `git diff --check`
  - 记录修改前后基准原始数据与代码指纹。

## 交付边界

- 本地代码、回归测试和稳定基准通过后，任务可报告为“本地实现完成”。
- Cloudflare 部署和真实客户端流式验证由用户控制；未执行前必须明确标为“生产未验证”。
- CHANGELOG 只在顶部新增本任务条目；保留用户当前未提交的历史条目删除，不恢复、不覆盖。

## 回滚

- 原生管道由严格的显式代理条件保护；回滚时可删除该分支并恢复现有 XHTTP bridge。
- SHA-224 优化可独立回滚为当前解析逻辑。
- 基准与回归测试应保留，用于证明回滚后的行为与性能差异。

## 开放问题

无。目标代理类型、适用路径、兼容边界、验证标准和生产责任边界均已明确。
