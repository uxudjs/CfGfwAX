# XHTTP Task 5 下行专用 pump：本地 GO

## 生产报错归类

- `POST /.../video/REDACTED/?ed=2560` 的请求为 HTTP/2、`content-type: application/grpc-web`，但 `Referer` 含 `x_padding`，按 `_worker.js` 路由规则实际进入 XHTTP，而不是 gRPC。
- 同一类事件记录为 `outcome=exceededCpu`、`cpuTimeMs=10`、`wallTimeMs=1151`，配套异常为 `Worker exceeded CPU time limit.`；这直接证明生产基线触达 Workers Free 的 10 ms CPU 上限。
- 另外三份日志属于同一个 `Upgrade: websocket` 请求及无效链式代理密文，不是 XHTTP POST CPU 事件，本轮不修改其行为。
- 报错来自部署版本 `acb52711-de72-4cc4-bf4b-e444f4645996`。当前修复尚未由用户部署，因此这些日志只作为优化前基线，不能证明修复后的生产结果。

## 根因与实现

- 旧 XHTTP 下行复用 WS/gRPC 的 32 KiB Grain bridge：每个 Grain 都需要缓冲、重建与发送等待，小块流产生额外分配、复制和 Promise 调度。
- 新增 XHTTP-only default-reader pump，原始块按序直送 `ReadableStream`；响应头只在首块合并一次，同步 `enqueue()` 不再强制多等一个 Promise turn。
- WS/gRPC 继续使用既有 BYOB/Grain 路径。协议格式、默认连接参数、XMUX、重试、取消、EOF、半关闭和诊断语义不变。

## 同版严格 A/B

基准 SHA `e320a2771467d2f514426ec2167220a71bf912e7909f1bcbeed14d45da0b7625`，Worker SHA `dd2582260373ee8c5d74785abf54da653926f7521be32e1fef1a1a4366639442`，夹具 SHA `d59fcee807ed4a3b1febe4dc393ca64f7d4e4faeedcb9e1a927dee8712fc20d5`。

| profile | 共享 Grain CPU ms | XHTTP 直通 CPU ms | 变化 |
| --- | ---: | ---: | ---: |
| downlink-1kib | 10.697531 | 3.053435 | -71.46% |
| downlink-16kib | 7.954955 | 0.200562 | -97.48% |
| downlink-64kib | 7.098305 | 0.068564 | -99.03% |
| bidirectional-1kib | 20.409091 | 12.317647 | -39.65% |
| bidirectional-16kib | 6.322957 | 0.766312 | -87.88% |
| bidirectional-64kib | 5.924157 | 0.214390 | -96.38% |

- 1/16 KiB 共享路径分配代理为 `512`、复制代理为 `16 MiB`；直通路径均为 `0`。64 KiB 为 `256/16 MiB → 0/0`。
- `bufferReuseCapabilityProxy=false`：没有虚构 `ReadableStream.enqueue()` 的缓冲所有权能力。
- 输出字节数与 SHA 全部一致；64 KiB 没有性能回退。

原始结果：

- `work-products/debug/xhttp-task5-downlink-shared-grain.json`
- `work-products/debug/xhttp-task5-downlink-direct.json`
- `work-products/debug/xhttp-task5-bidirectional-shared-grain.json`
- `work-products/debug/xhttp-task5-bidirectional-direct.json`

## 测试超限根因

- 正式测量偶尔在第 4 轮发生运行时台阶换挡；旧逻辑只取固定 7 轮，导致把两个稳态混入同一 CV，形成虚假超限。
- 基准现在最多透明采集 14 轮，仅接受最后连续 7 轮同时满足 `CPU CV ≤ 10%` 与趋势 `≤ 10%` 的后缀；保留全部原始轮次和丢弃数，不重试正式失败、不事后删除单轮。
- 全量测试唯一失败是旧 handler 断言仍预期 4 次 Grain 分配/128 次发送等待；生产直通路径的正确计数为 128 次原块发送、0 次分配、0 次复制、0 次额外发送等待，断言已同步。

## Checkpoint B

当前基准 SHA `336584220c91cbd8884d222117d76cf15cf5ee85e12808ad613daf93d90aaa84`，Worker SHA 与夹具 SHA 不变，电源计划为 `balanced:381b4222-f694-41f0-9685-ff5bb260df2e`。

- 严格 all-profile 第一次：9 个独立 PID、全部一次成功，最大 CPU CV `6.45%`；仅 downlink-1kib 采集 10 轮并透明丢弃前 3 轮。
- 严格 all-profile 第二次：9 个独立 PID、全部一次成功，最大 CPU CV `5.34%`；所有 profile 均为 7 轮且无丢弃。
- 原始结果：`work-products/debug/xhttp-task5-checkpoint-b-pass1.json`、`work-products/debug/xhttp-task5-checkpoint-b-pass2.json`。

## 结论与边界

Task 5 达到本地 GO：功能合同、性能相对门和测量稳定性门通过。`bidirectional-1kib` 是 32 MiB 总流量压力模型，本地中位数仍约 `11.1–11.7 ms`，不能据此承诺生产不再 exceededCpu；最终结论必须等待用户手动部署后的生产错误率、CPU P90 与 Codex 长连接实测。
