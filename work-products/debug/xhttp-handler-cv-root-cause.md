# XHTTP handler-level CPU CV 超限根因

## 结论

超限根因在基准尚未进入稳态，不在 XHTTP Worker 热路径。固定两轮 warmup 不能保证 V8/JIT 与堆状态稳定；校准时落入 1.5–3.5 秒目标窗的 profile，正式测量中仍会持续加速或振荡。`profile=all` 的同进程编排是一个干扰因素，但独立进程只消除了跨 profile 污染，同时也让每个 profile 从冷 JIT 状态开始，不能单独解决稳态问题。

全 profile 门还要求 9 项同时满足 `CPU CV ≤ 10%`，会把任一未稳态 profile 放大为整轮失败。

## 复现

两次同进程 all-profile 严格基线：

| 文件 | 最大 CPU CV | 失败 profile |
| --- | ---: | --- |
| `xhttp-handler-baseline-1.json` | 12.12% | `uplink-1kib`、`uplink-64kib` |
| `xhttp-handler-baseline-2.json` | 12.02% | `uplink-16kib`、`uplink-64kib` |

共同失败的 `uplink-64kib`：

- 第一轮 CPU CV：`12.1228%`
- 第二轮 CPU CV：`11.2627%`
- 两轮校准均为 `ready`
- CPU 与 wall 同向变化，不是单独的 `process.cpuUsage()` 读数跳动
- benchmark、fixture、Worker、Node、CPU 和电源模式指纹一致

## 隔离实验

保持 benchmark、fixture、Worker、Node、CPU 和电源模式不变，只把 `uplink-64kib` 改为单 profile 新进程：

| 文件 | CPU 中位数 | CPU CV |
| --- | ---: | ---: |
| `xhttp-uplink-64kib-isolated-1.json` | 0.135517 ms | 2.5498% |
| `xhttp-uplink-64kib-isolated-2.json` | 0.137036 ms | 3.1340% |

两次独立进程中位数相差约 `1.12%`，且 CV 均远低于 10%。仅运行三个上行 profile 的 `xhttp-uplink-sequence-repro.json` 虽然通过，但 `uplink-1kib` 已升至 `9.9063%`，表明长进程/多 profile 编排会显著压缩稳定性余量。

## 排除项

- 不是固定 `256..2048` 迭代截断：所有失败 profile 都使用分阶段校准并落入目标 CPU 窗口。
- 不是字节或 fixture 漂移：全部输出长度和 SHA 一致。
- 不是 Worker 协议回退：独立实验使用相同 Worker SHA。
- 不是 XMUX、WS、gRPC 或连接默认参数：这些路径和参数未参与实验。

## 进程隔离假设的反证

逐 profile 子进程的第一轮严格 all-profile 通过，最大 CV 为 `8.6296%`；第二轮在 9 个不同 PID、非 PID 指纹一致的条件下再次失败：

| profile | CPU CV | 原始轮次特征 |
| --- | ---: | --- |
| `uplink-1kib` | 12.8968% | 单轮 CPU 在 `1,828..2,641 ms` 间振荡 |
| `downlink-1kib` | 10.1029% | 单轮 CPU 在 `1,578..2,047 ms` 间振荡 |
| `downlink-64kib` | 13.7620% | 单轮 CPU 从 `1,734 ms` 下降到 `1,156 ms` |
| `bidirectional-64kib` | 11.7499% | 单轮 CPU 从 `2,157 ms` 下降到 `1,563 ms` |

`downlink-64kib` 和 `bidirectional-64kib` 呈明显单调加速，且正式轮次跌出校准目标窗，证明测量开始时仍在 JIT/运行时收敛阶段。进程隔离是有效的实验隔离手段，但不是充分修复。

## 下一修复条件

1. 精确单 profile 保持当前进程内运行。
2. `all` 或方向组由父进程按固定顺序为每个精确 profile 启动一个新 Node 子进程。
3. 在正式测量前增加可证明的稳态门，不能再用固定两轮 warmup 代替稳态判定。
4. 稳态门必须同时限制最近窗口的离散度与趋势；达到最大 warmup 仍未稳定时输出结构化原因。父进程只可丢弃整个预热失败子进程并重采一次，不能重试正式 CV、正确性或其他错误。
5. 父进程验证除 PID 外的环境指纹一致，再聚合 profile 与稳定性；记录每个 profile 的尝试次数，不挑选正式测量结果。

## 最终修复与复核

- A/B 证明每轮 `globalThis.gc()` 会制造双平台耗时和稳态抖动；基准不再主动完整 GC，也不向子进程传播 `--expose-gc`。
- 预热使用 5 轮滚动窗口、至少 12 轮、最多 24 轮，并要求连续 3 个窗口同时满足 CV 与趋势门。
- 预热 CV/趋势和正式 CV 共用 `0.10` 验收边界；正式 7 轮仍独立判定，不因预热通过而放宽。
- 仅 `max-steady-state-rounds-reached` 可在全新进程中重采一次；两轮最终严格验证均未实际触发重采。

| 文件 | 最大 CPU CV | 独立 PID | 重采样 |
| --- | ---: | ---: | ---: |
| `xhttp-steady-strict-1.json` | 8.6446% | 9 | 0 |
| `xhttp-steady-strict-2.json` | 8.4009% | 9 | 0 |

## 验收

- 单元测试证明精确 profile 不递归派生子进程，多 profile 必须隔离。
- 两次严格 all-profile 的全部 profile `CPU CV ≤ 10%`，且正式轮次不再出现持续单调加速。
- 每轮包含 9 个不同子进程 PID，且 benchmark/fixture/Worker/Node/CPU/电源模式指纹一致。
- 不修改 `_worker.js`、XMUX、WS、gRPC、默认连接参数或部署流程。
