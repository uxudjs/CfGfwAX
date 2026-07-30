# XHTTP Task 4 上行 fast path NO-GO

## 结论

移除 XHTTP 小块上行的无条件 `await` 没有降低本地 handler-level CPU，中间版本还因共享队列开始合包而增加复制与抖动。该 Worker 热路径实验已完整回退；保留现有逐块完成等待、顺序、背压、重试、取消、EOF 和队列上限。

## 同 SHA 严格 A/B

两组均使用相同 benchmark SHA `472a4c100f4526c0fd0e8708044d1c607fa902fb9b6274eb18b4df1dd7f9b039` 和 Worker SHA `4171cacd84a6d623704c38391951e9f41dbba1c0cc8810c66f582b881fd067a8`：

| profile | 精确旧路径 CPU 中位数 | fast path CPU 中位数 | 变化 | fast path CV | 旧路径 CV |
| --- | ---: | ---: | ---: | ---: | ---: |
| `uplink-1kib` | 7.365019 ms | 7.485915 ms | +1.64% | 2.80% | 3.63% |
| `uplink-16kib` | 0.500421 ms | 0.545788 ms | +9.07% | 4.21% | 3.31% |
| `uplink-64kib` | 0.122266 ms | 0.116713 ms | -4.54% | 3.01% | 6.62% |

小块真实 pump await 分别从 `16384 → 168`、`1024 → 204`，但 CPU 未改善，证明 Promise 等待次数不是当前可独立兑现的 CPU 瓶颈。64 KiB 两边均保持逐块完成等待，并满足不回退超过 5% 的对照门。

证据：

- `work-products/debug/xhttp-task4-uplink-nobundle-buffered-await-final.json`
- `work-products/debug/xhttp-task4-uplink-nobundle-auto-final.json`

## 决策

- Task 4 未达到 1/16 KiB CPU 至少下降 25% 的验收门，判定 NO-GO。
- 回退 Worker fast path、XHTTP-only 禁用合包和临时 benchmark 模式。
- 保留独立发现的 benchmark 子进程空 `stderr` 处理修复。
- Task 5 改为直接依赖 Task 3，从 XHTTP-only 下行分配、复制与共享 Grain bridge 继续寻找可验证收益。

本结果只证明本地 Node 模型下该假设无收益，不替代 Cloudflare Workers 生产 CPU 指标。
