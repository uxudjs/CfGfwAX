# Tasks: XHTTP stream-one CPU 瓶颈修复

## 前序任务合并

- [x] 冻结工作树、工具链与生产基线。
- [x] 建立初版 CPU、分配和字节正确性基准。
- [x] 完成初版 XHTTP 上下行切片与回滚证据。
- [x] 完成 BYOB 所有权审查并按用户决定跳过不安全实现。
- [x] 首次本地性能门因 CPU CV 超限判定 NO-GO，并由下列可信测量与完整 pump 任务取代。

## Phase 1：可信测量

- [x] Task 1：为异常校准与截断添加 RED 测试。
- [x] Task 1：实现分阶段、多样本校准。
- [x] Task 1：连续两次严格 all-profile 基准全部 `CPU CV ≤ 10%`。
- [x] Checkpoint A：人工复核样本时长、逻辑字节量与环境指纹。

## Phase 2：生产模型对齐

- [x] Task 2：建立完整 XHTTP request-body/downlink pump 基准。
- [x] Task 2：记录真实 await、读取、背压、flush、分配和复制代理。
- [x] Task 2：同版基准采集优化前与当前基线。
- [x] Task 2A：为多 profile 基准增加逐 profile Node 进程隔离。
- [x] Task 2A：增加自适应稳态门，移除强制 GC，并仅对预热耗尽做一次受限重采样。
- [x] Task 2A：验证父进程拒绝非 PID 环境指纹漂移，正式测量失败不重试。
- [x] Checkpoint A2：连续两次严格 all-profile 全部 `CPU CV ≤ 10%`。
- [x] Checkpoint A2：每轮 9 个不同 PID，代理计数和输出 SHA 不变。

## Phase 3：XHTTP-only 实现

- [x] Task 3：分离入站传输和出站代理诊断字段。
- [x] Task 3：证明 WS/gRPC 行为未变。
- [x] Task 4：完成小块上行 fast path 严格 A/B，因未达 CPU 门判定 NO-GO 并回退。
- [x] Task 4：保留 64 KiB 无回退证据及完整失败分析。
- [x] Task 5：建立 XHTTP-only 下行 pump。
- [x] Task 5：验证首包一次、字节顺序、取消、EOF 和交互延迟。
- [x] Task 5：确认生产路径没有虚假 buffer-reuse 能力。

## Phase 4：本地门与回滚

- [x] Checkpoint B：连续两次 all-profile 稳定性通过。
- [x] Checkpoint B：`node --test`（94/94）。
- [x] Checkpoint B：`node --check _worker.js`。
- [x] Checkpoint B：`node --check xhttp_stream_benchmark.mjs`。
- [x] Checkpoint B：`git diff --check`。
- [x] Task 6：从冻结基线重建并隔离验证任务级 reverse patch。
- [x] Task 6：审计最终 diff 只触及批准范围。

## Phase 5：用户手动生产验收

- [x] Task 7：用户手动部署。
- [ ] Task 7：收集至少 24 小时、1,000 次调用的 Cloudflare 指标。
- [ ] Task 7：验证 `exceededCpu < 1%`、相对下降至少 80%、CPU P90 `< 10 ms`。
- [ ] Task 7：完成 3 个 Codex 长连接会话实测。
- [ ] Task 7：Cloudflare 与 Codex 双门通过后给出 GO；否则回滚。

> 2026-07-30：用户已完成 Cloudflare 实地部署与 Codex 长连接试用，当前未观察到超时或断流；量化指标及 3 会话正式验收门仍待补充。
