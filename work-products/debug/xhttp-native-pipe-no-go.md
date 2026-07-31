# XHTTP 原生 `pipeTo` 性能门：NO-GO

## 结论

显式 SOCKS5/HTTP XHTTP TCP 的原生双向 `pipeTo` 方案未达到规格中的 CPU 降幅门，已从 `_worker.js` 回滚。保留 Trojan 首包 SHA-224 惰性单次计算修复、子 KiB 基准和本证据。

初版公平夹具错误地为双向 native 各启动两条 `pipeTo`，包含两条空管道；审查后已修复为一次 helper、两条真实管道，并以下列新数据重新判定。

## 公平对照

- Profile：`bidirectional-64b`
- 每方向负载：`1,048,576 B`
- 预热/测量：`2 / 7`
- Node：`v20.19.2`
- CPU：`Intel(R) Core(TM) Ultra 7 155H`
- Benchmark SHA-256：`973eedb5039da5a7b06c228a76ec1251306a5000d87b7c1bdaddea707557c813`
- Worker SHA-256：`5a860da1a29a1cb8e5bf56dfdf3d7d6715b35f3ff5ccdeca0a42b81142b5fb11`
- Fixture SHA-256：`b13261ceffb27a120f88c3466a3917bfb2875493d5f802422b433a3599407be6`

| 策略 | CPU 中位数 | CPU CV | Wall 中位数 |
|---|---:|---:|---:|
| 相同 Web Streams 的手动逐块泵送 | `44.234043 ms` | `5.8281%` | `44.030417 ms` |
| 原生双向 `pipeTo` | `42.255319 ms` | `4.1365%` | `43.954681 ms` |

两组 `CV ≤ 10%`，可用于结论。原生 `pipeTo` 相对手动泵送的 CPU 变化为：

`(42.255319 - 44.234043) / 44.234043 = -4.4733%`

中位数点估计为 `-4.4733%`，但该差异处于两组本地 CPU 波动尺度内，未证明可重复收益；同时远低于规格要求的 `50%` 降幅，因此仍判定 NO-GO。

## 原始数据

- `work-products/debug/xhttp-tiny-stream-pump-64b.json`
- `work-products/debug/xhttp-tiny-native-fair-64b.json`

## 边界

这是本地 Node 基准结论，不是 Cloudflare 生产 CPU 证明。`native` 策略是基准内保留的候选实现，当前 Worker 已回滚该分支；候选未达到预设收益门，不应先部署后试错。
