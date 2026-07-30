# XHTTP handler-level 基准阻塞记录（已解除）

## 结论

Task 2 的生产模型对齐与功能计数已通过。早期连续两轮严格 all-profile 基线未满足 `CPU CV ≤ 10%`，`@uxu-code:build auto` 曾按失败门禁停在 Task 3 前；2026-07-30 修复基准稳态判定后，连续两轮严格门禁通过，阻塞解除。

## 功能证据

- 上行/下行均标记为 `worker-xhttp-stream-one`，实际经过 Worker 请求体 pump 与 `connectStreams()`。
- 16 MiB / 1 KiB 上行：`16,384` 个输入块、`16,385` 次读取、`16,384` 次写入 await、`16,384` 次同步入队。
- 16 MiB / 1 KiB 下行：`16,384` 个输入块、`16,385` 次读取、`16,384` 次发送 await、`512` 次 Grain 发送与分配、`0` 次 `.slice()` 复制。
- 生产 XHTTP bridge 未声明 `发送后可复用缓冲`，基准记录 `bufferReuseCapabilityProxy=false`。
- 所有 profile 的输出长度和 SHA 与固定夹具一致。

## 稳定性证据

相同环境指纹：

- Node：`v20.19.2`
- CPU：`Intel(R) Core(TM) Ultra 7 155H`
- 逻辑核心：`22`
- 电源模式：`balanced:381b4222-f694-41f0-9685-ff5bb260df2e`
- benchmark SHA：`d1bf49b16eed59c904513b5f541a5bb25377bca7c3ca402efe16f05ab8289a64`
- fixture SHA：`d59fcee807ed4a3b1febe4dc393ca64f7d4e4faeedcb9e1a927dee8712fc20d5`
- Worker SHA：`9fee3263733fc5412ccad63a1e85c68cae391c7410edec0987535bcdd42c6a76`

两轮结果：

| 文件 | 最大 CPU CV | 失败 profile |
| --- | ---: | --- |
| `xhttp-handler-baseline-1.json` | 12.12% | `uplink-1kib`、`uplink-64kib` |
| `xhttp-handler-baseline-2.json` | 12.02% | `uplink-16kib`、`uplink-64kib` |

`uplink-64kib` 连续两轮超限，不能把当前基线用于证明后续 CPU 改善。两轮校准状态均为 `ready`，失败不是静默迭代截断。

## 解除证据

- 移除每轮强制完整 GC 与 `--expose-gc` 子进程传播。
- 用 5 轮滚动窗口、连续 3 个合格窗口和 12–24 轮自适应预热替代固定 warmup。
- 预热与正式测量统一使用 `CPU CV ≤ 10%`；只有预热耗尽可在全新进程重采一次。
- `xhttp-steady-strict-1.json`：最大 CV `8.6446%`，9 个不同 PID，全部首次通过。
- `xhttp-steady-strict-2.json`：最大 CV `8.4009%`，9 个不同 PID，全部首次通过。

## 已通过验证

```text
node --test work-products/tests/xhttp_stream_handler_benchmark.test.mjs xhttp_stream_benchmark.test.mjs xhttp_stream.test.mjs
13/13 passed
```

## 边界

- 没有执行 Wrangler 或部署。
- 没有修改 XMUX、WS、gRPC、默认连接参数或代理并发参数。
- 本地 Node 结果不是 Cloudflare/Codex 生产证明。
