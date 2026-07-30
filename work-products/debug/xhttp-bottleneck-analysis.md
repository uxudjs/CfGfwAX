# XHTTP stream-one 瓶颈诊断

## 结论

当前瓶颈不是已证实的 XMUX 问题，而是以下三层叠加：

1. **本地性能门测量失真**：单次校准后把迭代数硬限制在 `256..2048`，导致慢 profile 一轮执行过量、快 profile 一轮又不足，CPU CV 门禁不稳定。
2. **基准与生产热路径不一致**：基准直接调用上行队列；生产 XHTTP 对每个小块仍经过 `async 写入远端()` 并无条件 `await`，所以现有结果没有计入逐块 Promise/微任务成本。
3. **XHTTP 下行仍耦合 WS/gRPC Grain 路径**：`connectStreams()` 只记录出站代理类型，无法识别入站是 XHTTP；因此无法安全实施 XHTTP-only 下行优化，生产 bridge 也不能证明 `controller.enqueue()` 后缓冲可复用。

Cloudflare Workers Free 的 CPU 限制是每个 HTTP 请求 10 ms；HTTP 流可以长时间保持，但活跃执行的 CPU 仍计入同一次请求。XHTTP `stream-one` 因而会把长连接期间的逐块 JS 成本持续累加到同一请求。

## 已复现现象

证据文件：

- `work-products/debug/xhttp-cpu-strict-before.json`
- `work-products/debug/xhttp-cpu-after.json`
- `work-products/debug/xhttp-cpu-checkpoint-c.md`

| 样本 | 迭代数 | 每轮逻辑数据 | 每轮 CPU 中位数 | CPU CV | 结论 |
| --- | ---: | ---: | ---: | ---: | --- |
| 优化前 `bidirectional-1kib` | 256 | 8 GiB | 7,328 ms | 18.7199% | 过量执行且不稳定 |
| 优化后 `downlink-64kib` | 2,000 | 31.25 GiB | 437 ms | 12.8768% | 未达到 2,000 ms 目标且不稳定 |
| 优化后 `bidirectional-16kib` | 272 | 8.5 GiB | 1,735 ms | 4.8807% | 稳定 |
| 优化后 `bidirectional-64kib` | 1,455 | 45.47 GiB | 500 ms | 6.2496% | 样本偏短但本轮通过 |

全部 profile 的实际每轮 CPU 中位数范围为约 `250..7,328 ms`，与固定 `2,000 ms` 目标明显不一致。失败发生在上下限两端，不支持把当前 NO-GO 直接解释为实现回退。

2026-07-30 当前工作树复跑 `downlink-64kib` 后再次失败：

- benchmark SHA：`ea8be8875107a89d8ed8cbdf6f8e56510a0964de71b5445e04f9870208f6634a`
- Worker SHA：`3a57a1dd665cbf737765b4685c7998eb407d01492ae1c389556283f0e277d808`
- 单次校准：CPU `0 ms`、wall `1.0555 ms`
- 自动迭代：`1,895`
- 7 轮 CPU 样本：`343, 422, 376, 437, 360, 734, 782 ms`
- CPU CV：`34.568%`

复跑结果保存于 `work-products/debug/xhttp-current-downlink-64kib-repro.json`。同一代码和 benchmark 的 CV 从此前 `12.8768%` 漂移到 `34.568%`，进一步证明当前阻塞首先是测量门问题。

## 根因证据

### 1. 测量校准是当前验收阻塞的直接根因

`work-products/benchmarks/xhttp_stream_benchmark.mjs:298-301`：

- 只使用一次校准结果；
- 用 `min(cpuMs, wallMs)` 选取观测值；
- 强制最少 256 次、最多 2048 次。

Windows/Node 单次 `process.cpuUsage()` 可返回 `0` 或受后台线程/JIT 影响的异常值。现有测试只覆盖 `16 ms CPU / 3 ms wall` 和 `0 ms CPU / 6 ms wall`，没有覆盖上下限截断、异常校准和目标样本时长。

### 2. 上行基准漏掉生产逐块 await

生产路径：

- `_worker.js:659-666`：`写入远端` 被声明为 `async`；
- `_worker.js:685-695`：每个 TCP body chunk 都执行 `await 写入远端(value)`；
- 小块即使只同步入队并且未到高水位，也至少产生一次 async continuation。

基准路径：

- `work-products/benchmarks/xhttp_stream_benchmark.mjs:186-204`：小块直接调用 `queue.写入()`；
- 只有达到高水位才 `await queue.等待低水位()`。

因此小块 profile 的本地结果只能证明队列算法，不代表完整 XHTTP request-body pump。

### 3. 下行 Grain 和缓冲所有权仍是生产热点

- `_worker.js:614-642`：XHTTP 用模拟 WebSocket 的 bridge 调用 `controller.enqueue(chunk)`；
- `_worker.js:2649-2703`：每次 Grain flush 先切换到新的 32 KiB `pendingBuffer`；
- 只有 `webSocket.发送后可复用缓冲 === true` 才回收发送缓冲；
- 生产 XHTTP bridge 没有该能力，严格代理结果仍为 `512 → 512` 次分配，仅 `.slice()` 复制从 16 MiB 降为 0。

不能把 `controller.enqueue()` 当作“消费者已完成读取”的确认，所以跳过旧 Task 4 的缓冲复用是正确的安全边界。

### 4. 普通 BYOB read 会放大小块开销

`_worker.js:2804-2842` 为所有传输共用 64 KiB BYOB buffer，并对每次 `reader.read()` 的结果调用 Grain sender。Cloudflare 官方文档说明，普通 BYOB `read()` 不保证最小返回量，实践中通常只填满约 1% 的传入缓冲。

这意味着 64 KiB buffer 可能频繁返回约数百字节；每个返回块都会触发：

- 一次读取循环；
- 一次 `await 下行发送器.发送(value)`；
- 一次 Grain copy/schedule；
- 可能的 microtask/timer/flush。

这与 Codex 交互流量的“小块、长时间、持续活跃”特征相吻合，是当前最可能的生产 CPU 热点，但仍需 handler-level 基准和生产指标验证。

### 5. 入站传输不可观测，限制了安全优化

`forwardataTCP()` 传给 `connectStreams()` 的 `transport` 是 `direct/http/https/socks5/...` 等出站方式，不是 `xhttp/ws/grpc` 入站方式。现有断流日志无法按 XHTTP 聚合，也无法在共享下行函数中只启用 XHTTP fast path。

## 未被证实的假设

- XMUX：本次范围保持不变，也没有证据显示它是 Worker CPU 根因。
- Cloudflare 或源站主动重置：可能是结果或并行故障，但已有 `exceededCpu` 生产证据时，不能优先归因于上游重置。
- 二级 SOCKS 并发不足、H2 主连接复用：当前代码与基准没有提供因果证据，不纳入本轮修复。

## 调试边界

- 只优化 XHTTP `stream-one`。
- 协议字节、默认连接参数、XMUX、WS 和 gRPC 行为不变。
- 不恢复未经所有权证明的 BYOB/Grain buffer 复用。
- Node 基准只作为本地回归门；最终结论必须来自用户手动部署后的 Cloudflare `exceededCpu` 和 Codex 长连接实测。
- 本轮只诊断并规划，不修改业务代码；RED 回归随计划 Task 1、Task 2 先行添加。

聚焦功能回归：

```text
node --test xhttp_stream_benchmark.test.mjs xhttp_stream_uplink.test.mjs xhttp_stream_downlink.test.mjs xhttp_stream_lifecycle.test.mjs xhttp_stream.test.mjs
26/26 passed
```

## 官方依据

- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/#cpu-time
- Cloudflare Streams: https://developers.cloudflare.com/workers/runtime-apis/streams/
- Cloudflare ReadableStream BYOBReader: https://developers.cloudflare.com/workers/runtime-apis/streams/readablestreambyobreader/
