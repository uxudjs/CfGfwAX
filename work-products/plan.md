# Implementation Plan: XHTTP stream-one CPU 瓶颈修复

## 目标与范围

先修复不可重复的本地性能门，再让基准覆盖完整 XHTTP pump，随后只优化 XHTTP 小块上行和下行。协议格式、默认连接参数、XMUX、WS、gRPC 与用户手动部署流程保持不变。

规划依据：`work-products/debug/xhttp-bottleneck-analysis.md`、现有 XHTTP 规格、严格 A/B JSON 和 Cloudflare Workers Free 每 HTTP 请求 10 ms CPU 合同。

## 前序计划合并说明

本计划已合并并取代原 `tasks/plan.md`。前序计划完成了工作树与生产基线冻结、初版 CPU/分配基准、XHTTP 上下行切片及 BYOB 所有权审查；其首次 Checkpoint C 因 CPU CV 超过 10% 判定 NO-GO，随后进入本计划的可信校准、完整 pump 建模、逐 profile 进程隔离和 XHTTP-only 下行方案。以下任务状态与验收结论为当前权威记录，前序 NO-GO 不再作为待办入口。

## 依赖顺序

```text
可信校准
  → handler-level 基准
    → 入站传输上下文
      → XHTTP 上行 fast path
      → XHTTP 下行专用 pump
        → 本地性能门
          → 用户手动生产验收
```

## Task 1：修复基准校准与稳定性门

**依赖**：无。

**范围**

- 为异常单次 CPU、最小/最大截断、过短和过长样本先加 RED 测试。
- 用分阶段、多样本校准替代固定 `256..2048` 截断。
- 保留 fixture、输出摘要、CPU/wall 原始轮次和环境指纹。

**验收**

- 每个 profile 的计时轮达到明确的目标 CPU 窗口；无法达到时输出结构化原因，不能静默截断。
- 同环境连续两次严格运行的全部 profile `CPU CV ≤ 10%`。
- 优化前与优化后必须使用同一 benchmark SHA、fixture SHA、Node、CPU 与电源模式。

**验证**

- `node --test xhttp_stream_benchmark.test.mjs`
- 连续两次严格 all-profile 基准；结果保存到 `work-products/debug/`。
- `node --check work-products/benchmarks/xhttp_stream_benchmark.mjs`

**回滚**

- 只回退 benchmark 与其测试；不触碰 `_worker.js`。

## Checkpoint A：测量门可信

- [x] 校准 RED/GREEN 完成。
- [x] 两次严格基准全部满足 CV 门。
- [x] 复核每轮 CPU、逻辑字节量和环境指纹，无上下限截断伪影。
- [x] 用户通过 `@uxu-code:build auto` 确认测量门后继续。
- [ ] 未通过则停止，不修改 Worker 热路径。

## Task 2：建立完整 XHTTP pump 基准

**依赖**：Checkpoint A。

**范围**

- 基准经过实际 XHTTP request-body/downlink pump，不能只调用队列和 Grain helper。
- 保留 1/16/64 KiB、上行/下行/双向、字节顺序与 EOF/取消/失败覆盖。
- 增加逐块读取数、同步入队数、真实 await 次数、高/低水位等待、flush、分配和复制代理。
- 生产 XHTTP bridge 不注入虚假的“发送后可复用缓冲”能力。

**验收**

- 1 KiB 小块能复现生产路径当前“每块 await”。
- 下行能复现生产 `512` 次 Grain 分配和 0 次 `.slice()` 复制。
- 输出字节数和 SHA 与 fixture 完全一致。

**验证**

- `node --test xhttp_stream_benchmark.test.mjs xhttp_stream.test.mjs`
- 新旧 Worker 使用同一版 handler-level 基准各跑两次。

**回滚**

- 删除 handler-level fixture/计数器，恢复 Task 1 已验证的基准。

> Task 2 状态（2026-07-30）：PASS。handler-level 基准已复现 1 KiB 上行每块 await、下行 512 次 Grain 分配、0 次 `.slice()` 复制和无缓冲复用能力；Task 2A 修复测量稳定性后，连续两轮严格全 profile 门禁通过。

## Task 2A：隔离每个性能 profile 的 Node 进程

**依赖**：Task 2；根因依据为 `work-products/debug/xhttp-handler-cv-root-cause.md`。

**范围**

- 精确单 profile 继续在当前进程执行。
- `all` 和方向组按固定顺序为每个精确 profile 启动独立 Node 子进程；每个子进程独立校准、预热、测量和验证。
- 父进程只验证环境指纹并聚合结果；仅当子进程在正式测量前耗尽 24 轮稳态预热时，允许丢弃整次子进程并重采一次，正式 CV、正确性及其他错误不重试。
- JSON 增加 profile 进程隔离证据；保留现有 CLI、profile、摘要、代理计数、字节校验和失败退出语义。

**验收**

- 多 profile 的每项结果来自不同 PID；除 PID 外的 Node、CPU、电源模式、benchmark、fixture 和 Worker 指纹完全一致。
- 同环境连续两次严格 all-profile 的全部 profile `CPU CV ≤ 10%`。
- JSON 记录每个 profile 的尝试次数；每个 profile 最多两次，不能挑选正式测量结果。
- 精确单 profile 不派生子进程，现有单 profile API 与测试行为不变。

**验证**

- 先在 `work-products/tests/` 添加执行模式、聚合与指纹不一致的 RED 测试。
- `node --test work-products/tests/xhttp_stream_process_isolation.test.mjs xhttp_stream_benchmark.test.mjs`
- 连续两次严格 all-profile，结果保存到 `work-products/debug/`。
- `node --check work-products/benchmarks/xhttp_stream_benchmark.mjs`

**回滚**

- 只回退 benchmark 编排、测试和新证据；不触碰 `_worker.js`。

## Checkpoint A2：handler-level 测量门可信

- [x] 两次严格 all-profile 全部 `CPU CV ≤ 10%`。
- [x] 每轮 9 个不同 PID，非 PID 指纹一致。
- [x] 代理计数、输出长度和 SHA 与 Task 2 基线一致。
- [x] 门禁通过，可以进入 Task 3。

> 2026-07-30 PASS：移除每轮强制完整 GC，增加自适应稳态门，将预热 CV/趋势与正式 `0.10` 门槛统一，并仅对“预热 24 轮未稳”允许一次全新进程重采。`xhttp-steady-strict-1.json` 与 `xhttp-steady-strict-2.json` 的最大 CV 分别为 `8.6446%`、`8.4009%`；两轮各 9 个不同 PID，18 个 profile 均首次尝试通过。

## Task 3：分离入站传输上下文

**依赖**：Checkpoint A2。

**范围**

- 将 `xhttp/ws/grpc` 入站类型与 `direct/http/https/socks5/...` 出站类型分开传递。
- 断流诊断只增加白名单枚举字段，不记录目标、凭据、路径或原始数据。
- 此任务不启用任何性能 fast path。

**验收**

- XHTTP 断流可按入站传输聚合，同时保留出站代理诊断。
- WS/gRPC 的字节、关闭、重试、保活和定时器行为无变化。

**验证**

- 先加 XHTTP/WS/gRPC 传输分类 RED 测试。
- `node --test xhttp_stream_lifecycle.test.mjs chain_proxy.test.mjs`

**回滚**

- 移除新增入站字段和参数，恢复原诊断结构。

> Task 3 状态（2026-07-30）：PASS。`构建断流诊断` 已拆分 `inboundTransport` 与 `outboundTransport` 白名单；XHTTP、WebSocket、gRPC 的 TCP 与 Trojan UDP 下行均显式传递入站类型。聚焦回归 28/28 通过，未改变数据、关闭、重试、保活或定时器行为。

## Task 4：移除 XHTTP 小块上行无条件 await

**依赖**：Task 3。

**范围**

- `<64 KiB` 常规路径同步入队，仅在达到高水位时等待低水位。
- `≥64 KiB`、重试、错误、队列溢出与 EOF 继续等待真实写入完成。
- 不改变 WS/gRPC 的 `写入并等待` 行为。

**验收**

- 1/16 KiB handler-level 基准的逐块 await 计数显著下降。
- 稳定 CPU 中位数相对 Task 2 基线下降至少 25%。
- 64 KiB CPU 不回退超过 5%；字节顺序、背压、失败取消和半关闭语义不变。

**验证**

- `node --test xhttp_stream_uplink.test.mjs xhttp_stream_lifecycle.test.mjs xhttp_stream.test.mjs chain_proxy.test.mjs`
- 严格 uplink 与 bidirectional A/B。

**回滚**

- 恢复 XHTTP 小块 await；不回退共享队列错误修复。

> Task 4 状态（2026-07-30）：NO-GO，已回退。相同 benchmark/Worker SHA 的严格 A/B 中，1/16 KiB CPU 分别变化 `+1.64%`、`+9.07%`，64 KiB 为 `-4.54%`；虽将真实 pump await 从 `16384 → 168`、`1024 → 204`，仍未达到小块 CPU 至少下降 25% 的门。证据见 `work-products/debug/xhttp-task4-uplink-no-go.md`。Worker 上行热路径和临时 benchmark 模式已恢复，保留现有逐块完成等待语义。

## Task 5：建立 XHTTP-only 下行 pump

**依赖**：Task 3；Task 4 已按性能门 NO-GO 并回退。继续按顺序执行以避免在 `_worker.js` 共享区域产生不可归因的性能变化。

**范围**

- XHTTP 不再通过无法区分入站类型的 WS/gRPC Grain bridge。
- 优先验证 default-reader 原始块直送 XHTTP `ReadableStream`，首个响应头只合并一次。
- 只有在同时满足交互延迟门时才评估 `readAtLeast()`；不得为了吞吐等待大块而阻塞 Codex 小消息。
- 不启用无完成确认的 BYOB/Grain backing-buffer 复用。

**验收**

- 协议字节、首包、顺序、背压、错误、取消、EOF 和重试语义保持一致。
- 1/16 KiB 下行分配或复制代理至少下降 30%。
- 小消息首字节和块间延迟相对基线不增加超过 5 ms。
- WS/gRPC 仍走原路径，所有相关回归结果不变。

**验证**

- 先加 direct-reader、小块延迟、取消、EOF 和 header-once RED 测试。
- `node --test xhttp_stream_downlink.test.mjs xhttp_stream_lifecycle.test.mjs xhttp_stream.test.mjs chain_proxy.test.mjs`
- 严格 downlink 与 bidirectional A/B。

**回滚**

- XHTTP 恢复共享 Grain bridge；WS/gRPC 无需回滚。

> Task 5 状态（2026-07-30）：本地 GO。XHTTP 下行已改为 default-reader 原块直通，WS/gRPC 保持共享 BYOB/Grain 路径；同版 A/B 的 downlink 1/16/64 KiB CPU 分别下降 `71.46%`、`97.48%`、`99.03%`，bidirectional 分别下降 `39.65%`、`87.88%`、`96.38%`，分配/复制代理归零且输出 SHA 不变。两轮严格 all-profile 最大 CPU CV 为 `6.45%` 与 `5.34%`。生产 `exceededCpu` 仍须用户手动部署后验证，证据见 `work-products/debug/xhttp-task5-downlink-go.md`。

## Checkpoint B：本地性能与功能门

- [x] 同一环境连续两次 all-profile `CPU CV ≤ 10%`。
- [x] 1/16 KiB CPU 达到既定改善，64 KiB 无超过 5% 回退。
- [x] 分配/复制代理达到目标，且无虚假 buffer-reuse 能力。
- [x] `node --test`
- [x] `node --check _worker.js`
- [x] `node --check work-products/benchmarks/xhttp_stream_benchmark.mjs`
- [x] `git diff --check`

未通过任一项即 NO-GO，不进入部署。

## Task 6：重建可逆补丁与审计交付范围

**依赖**：Checkpoint B。

**范围**

- 从已冻结 Task 0 基线和最终 Worker 变更重建任务级 reverse patch。
- 不生成会覆盖用户既有未提交修改的全工作树补丁。
- 更新准确的变更记录，但不重写历史 release section。

**验收**

- 每个 patch 在隔离副本中 `git apply --check` 和实际回退验证通过。
- 最终 diff 只包含 XHTTP、对应测试、基准及工作产物。

**验证**

- 在隔离副本执行任务级 patch 的 apply/reverse apply。
- `git diff --check`
- `git status --short`

**回滚**

- 使用已验证的任务级 reverse patch；生产回滚仍由用户执行。

> Task 6 状态（2026-07-30）：完成。`work-products/rollback/xhttp-final.reverse.patch` 已在当前工作树通过 `git apply --check`，并在隔离仓库实际应用后恢复到冻结基线；补丁 SHA-256 为 `b34062f8efb8c4cc3dd23b3bfcb9ad6ded6ee7af237982f2c2bae0883144027f`。最终变更范围审计未发现 XMUX、WS/gRPC 行为或默认连接参数变化。

## Task 6A：标准化 XHTTP 工具与过程产物路径

**依赖**：Task 6；不依赖 Task 7 的生产指标验收。

**范围**

- 将 XHTTP 基准程序迁入 `work-products/benchmarks/`，同步 Worker、测试与 CLI 路径。
- 将旧 `tasks/` 中的诊断证据迁入 `work-products/debug/`，补丁与清单迁入 `work-products/rollback/`。
- 删除旧 `tasks/` 忽略规则，并显式跟踪基准程序。

**验收**

- 仓库不再存在 `tasks/` 或根目录基准程序。
- 当前代码与文档不再引用旧路径；历史补丁正文保持冻结快照语义。
- Node 回归、Worker/基准语法和 Git 差异检查通过。

**回滚**

- 反向移动文件并恢复本任务的路径引用；不修改 `_worker.js` 行为。

> Task 6A 状态（2026-07-31）：PASS。39 个旧 `tasks/` 文件已分类迁移，基准程序已迁入 `work-products/benchmarks/`；聚焦回归 20/20、完整回归 94/94、Worker/基准语法与 Git 差异检查通过。

## Task 7：用户手动生产验收

**依赖**：Task 6。

**范围**

- 仅在 Checkpoint B PASS 后由用户手动部署并收集生产证据。

**验收**

- 至少 24 小时、至少 1,000 次调用，并保留同星期窗口对照。
- `exceededCpu < 1%`，且相对基线下降至少 80%。
- CPU P90 `< 10 ms`。
- uncaught/memory/internal error 不高于每小时 0.5。
- 3 个独立会话，每个至少 30 分钟、10 轮交互，并包含持续输出。
- 无 `stream disconnected before completion`、`Transport error: network error` 或 `error decoding response body`。

**验证**

- 保存 Cloudflare Metrics 的时间窗口、调用数、CPU 分位数和 invocation outcome。
- 保存 3 个 Codex 会话的起止时间、轮次和断流结果。
- Cloudflare 与 Codex 两组都通过才 GO。

**回滚**

- 任一生产门失败时，由用户恢复上一 Worker 版本，并按新增证据重新进入调试。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Node 与 workerd CPU 不等价 | 本地改善无法映射为生产 10 ms | 本地只做回归门，生产指标作最终门 |
| `readAtLeast()` 增加交互延迟 | Codex 消息被攒批 | 延迟 RED 测试；无有界等待证明则不采用 |
| 共享函数误伤 WS/gRPC | 超出明确范围 | 先分离入站上下文，XHTTP-only 分支，跑完整回归 |
| `enqueue()` 无完成确认 | 复用后数据被覆盖 | 保持不可复用，除非得到可验证所有权合同 |
| 旧 reverse patch 已漂移 | 无法安全回滚 | 最终实现稳定后从冻结基线重建并隔离验证 |

## 明确不做

- 不修改 XMUX、WS、gRPC、连接默认参数或代理并发参数。
- 不添加 Wrangler 或自动部署流程。
- 不把本地 Node PASS 表述为 Cloudflare/Codex 生产 PASS。
