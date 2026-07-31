# XHTTP 多对话 CPU 超时诊断

## 结论

示例节点使用 `stream-one` 和全局、带认证的 SOCKS5 链式代理。问题不是多个对话共享同一 Worker 队列后出现超线性退化，而是免费套餐的单次 HTTP invocation 只有 `10 ms` CPU：每个长寿命 `stream-one` 请求都会累计 JavaScript 流转发成本，多路并发同时增加了触及该上限的请求数量。

当前 Worker 的主要可修复成本位于小块上行：请求体每块已经因 `reader.read()` 让出一次微任务，正常同步入队后又无条件 `await` 一次立即完成的结果。修复后，仅背压等待和大块直写继续等待 Promise；同步小块直接继续读取。

## 复现

环境：

- Node `v20.19.2`
- CPU `Intel(R) Core(TM) Ultra 7 155H`
- 负载：每方向 `1,048,576 B`
- 分块：`64 B`
- 校准：单轮 CPU 目标 `1,500–3,500 ms`
- 稳定门：CPU CV `≤ 10%`

修改前：

| Profile | CPU 中位数 | CPU CV | 判定 |
|---|---:|---:|---|
| `uplink-64b` | `7.444043 ms` | `8.9583%` | 稳定 |
| `downlink-64b` | `2.970859 ms` | `7.6709%` | 稳定 |
| `bidirectional-64b` | `10.715116 ms` | `1.7173%` | 稳定，超过 10 ms |

并发 `1/2/4/8` 路短样本没有出现每路 CPU 随并发增长的趋势；Windows 短 CPU 样本存在量化噪声，因此该组只用于排除明显的超线性并发缺陷，不用于性能收益判定。

## RED

`work-products/tests/xhttp_stream_uplink.test.mjs` 记录同步写入后的微任务顺序。修改前为：

```text
read-1 → write → write-microtask → read-2
```

这证明同步入队成功仍被额外 `await`。目标顺序为：

```text
read-1 → write → read-2 → write-microtask
```

## 修复

- `转发XHTTP上行请求体()` 只在写入结果为 thenable 时等待。
- XHTTP 小块正常入队同步返回 `true`。
- 达到高水位时仍等待低水位；大块仍等待直接写入完成。
- 失败、重试、取消、队列上限、字节顺序和 EOF 行为不变。
- 基准同步更新为与生产转发器相同的条件等待语义。

## 修改后

| Profile | CPU 中位数 | CPU CV | 变化 |
|---|---:|---:|---:|
| `uplink-64b` | `6.531773 ms` | `3.2904%` | `-12.2550%` |
| `bidirectional-64b` | `9.980198 ms` | `3.3799%` | `-6.8587%` |

修改后双向本地中位数只比 `10 ms` 低 `0.1980%`，因此修复可降低超限概率，但没有足够余量证明免费套餐下的真实 Cloudflare 请求一定不再超限。

代码指纹：

- 修改前 Worker SHA-256：`3ad6ac7d6254a7d91e116b56e25a7c174b36d8ef2e0b21e1f7a1d588f51c659f`
- 修改后性能基准 Worker SHA-256（版本号更新前）：`3609f2b59eded3633d26237283a027e6794ced82e0990ad6991feb6208a4e2ce`
- `v2.4.4` 发布 Worker SHA-256：`e3cd329547d2ce349404d7db83d6e4b7c47007dfb4ca603324b8af62517e22f0`
- 修改后基准 SHA-256：`e41a2ba370e8614d478f07c6f682578ba1ea394bfa518eb029dacfa54d75f9b4`

## 平台边界

Cloudflare 官方文档说明：

- 免费 Workers 的 CPU 上限为每次 HTTP 请求 `10 ms`。
- CPU 超限返回 `1102`，Invocation Status 为 `exceededCpu`。
- 等待网络 I/O 不计入 CPU，但同一长寿命请求内执行的 JavaScript CPU 会累计。
- CPU 限制按 invocation 计算；每个 isolate 可并发处理多个请求。

参考：

- https://developers.cloudflare.com/workers/platform/limits/#cpu-time
- https://developers.cloudflare.com/workers/observability/errors/

## 剩余验证

- 本地 Node 功能与性能门通过后，仍需用户手动部署。
- 在 Cloudflare `Metrics > Errors > Invocation Statuses` 或日志中确认 `exceededCpu` 是否下降。
- 若真实请求仍触及 `10 ms`，优先使用付费套餐并在控制台提高单次 CPU 限额；本仓库不增加 Wrangler 部署配置。
- 不应把本地 Node 基准当作 Cloudflare 生产 CPU 证明。
