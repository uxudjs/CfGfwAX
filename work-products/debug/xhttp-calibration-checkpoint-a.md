# Checkpoint A：XHTTP 基准测量门

## 结论

**Task 1 PASS；Checkpoint A 等待用户确认后再进入 Worker 热路径修改。**

固定 `256..2048` 截断已替换为分阶段、多样本校准。校准使用 3 个样本的 CPU 中位数，目标为 2,000 ms，允许窗口为 1,500–3,500 ms；无法进入窗口时会输出结构化限制原因。

## RED/GREEN

- RED：`work-products/tests/xhttp_stream_calibration.test.mjs` 因缺少 `planCalibrationStage` 导出失败。
- GREEN：校准测试与现有 benchmark 回归 `14/14` 通过。
- 覆盖：CPU 为零时 wall 回退、快 profile 超过旧 2048 上限、目标窗口、单次过长、最大迭代保护。

## 两次严格 all-profile

| 运行 | 最大 CPU CV | 逐 profile 结果 | 计时轮 CPU 中位数范围 |
| --- | ---: | --- | ---: |
| `xhttp-calibration-strict-1.json` | 6.9283% | 9/9 PASS | 1,687–2,235 ms |
| `xhttp-calibration-strict-2.json` | 6.9024% | 9/9 PASS | 1,578–2,188 ms |

两次运行的全部 profile：

- `calibration.status === "ready"`；
- CPU CV 均不超过 10%；
- 没有 `256` 最小值或 `2048` 最大值的静默截断；
- 计时轮 CPU 位于明确目标窗口。

## 环境指纹

两次完全一致：

- Node：`v20.19.2`
- CPU：`Intel(R) Core(TM) Ultra 7 155H`
- 逻辑核心：`22`
- 电源模式：`balanced:381b4222-f694-41f0-9685-ff5bb260df2e`
- benchmark SHA：`ecc1fdc1bea056eace04ffc9565bd9b299652db4424cdc8b1f28f2c0306401f3`
- fixture SHA：`d59fcee807ed4a3b1febe4dc393ca64f7d4e4faeedcb9e1a927dee8712fc20d5`
- Worker SHA：`3a57a1dd665cbf737765b4685c7998eb407d01492ae1c389556283f0e277d808`

## 证据

- `work-products/debug/xhttp-calibration-strict-1.json`
- `work-products/debug/xhttp-calibration-strict-2.json`
- `work-products/tests/xhttp_stream_calibration.test.mjs`

## 边界

- 本任务没有修改 `_worker.js`。
- 本地 Node 稳定性只证明回归测量门可信，不证明 Cloudflare Workers Free 生产 CPU 已达标。
- 按计划，用户确认 Checkpoint A 后才能开始 Task 2。
