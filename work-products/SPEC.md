# Spec: WS 与 gRPC 基准驱动协议迭代

## 状态

已批准，日期：2026-08-02。用户通过 `@uxu-code:plan` 批准第二轮测量修订进入规划。v2.4.22 已完成 WS/gRPC 基准骨架、真实热路径计量和两个完整 32-profile run，但 baseline 为 `INCONCLUSIVE`；本次修订定位测量不稳定原因并定义第二轮测量修复，Checkpoint A 继续关闭。

本规格由 `@uxu-code:spec` 产出，只定义修复范围、证据门和验收合同；`@uxu-code:plan` 已重写现有已闭环计划。规格批准与计划生成均不等于授权修改 WS、gRPC 或 XHTTP 运行逻辑。

## 假设

- “如 XHTTP 的升级”指降低 Worker JavaScript CPU、复制和分配开销，同时保持协议字节、顺序、生命周期和客户端兼容性，不要求把 XHTTP 的具体实现逐行移植。
- WS 与 gRPC 独立判定：一个协议达到门槛不代表另一个也必须修改；任一候选证据不足时可以单独 NO-GO。
- WS `binaryType` 调用顺序修复已经完成，不再作为本轮性能候选或收益来源。
- 当前 high CV、窗口失配和跨 run 差异只构成测量缺陷诊断，不能作为任何运行时改动的 GO/NO-GO 证据。
- v2.4.22 的 `ws-grpc-baseline.json` 是不可覆盖的失败基线；修复后的 schema v2 证据另写新文件，保留前后可追溯性。
- 不新增管理页配置、环境变量、URL、鉴权方式或客户端参数。
- Cloudflare 部署、真实节点日志和真实客户端长连接验证继续由用户控制；本地结果不得表述为生产证明。
- 当前优先处理 VLESS/Trojan 的 WS 与 gRPC TCP 主链路；Shadowsocks、UDP、XMUX 和显式代理握手只做回归，不借机重构。

## 目标

先修复 WS/gRPC 性能测量基础，再用稳定证据决定是否实施最小、协议专属的优化：

1. 让正式证据模式在有界时间内完成分阶段长窗口校准、全部固定 profile 和两次独立运行，且不遗留子进程或半成品证据。
2. 将输入源字节与 Worker 热路径实际发生的复制、分配、写入和发送操作分开计量。
3. 只有稳定 baseline 冻结后，才依次评估 gRPC 解析、gRPC 上行背压、gRPC 下行缓冲复用和 WS 上行背压候选。
4. XHTTP 本轮不改运行逻辑；仅保留既有稳定本地证据和 Cloudflare/真实客户端生产验证门。
5. 任何性能候选只有在稳定基准、字节合同和生命周期回归同时通过后才进入 `_worker.js`。

目标用户是通过 WS 或 gRPC 使用 CfGfwAX 的现有客户端。成功意味着在不要求客户端改配置的前提下，至少一个已证实热点获得可重复收益；若没有候选达标，也应交付可复现的 NO-GO 证据而不是强行改代码。

## 当前事实与可行性结论

### 共用基础

- `_worker.js` 已有 16 KiB 上行合包、有界队列、64/16 KiB 高低水位、32 KiB 下行 Grain、BYOB 读取和断流诊断。
- WS 与 gRPC 下行均通过 `connectStreams()` 使用 BYOB/Grain；XHTTP 已分流到 `connectXHTTPStreams()` 的 default-reader 原块直通。
- 既有全量本地回归、语法和差异检查已通过，但当前 WS/gRPC 性能基准尚无可用于决策的稳定 baseline。
- 既有 XHTTP 原生 `pipeTo` 候选仅取得约 4.47% 的本地 CPU 中位数下降，低于既定门槛且处于波动尺度内，已经 NO-GO；因此本规格不把 `pipeTo` 当作默认答案。
- v2.4.22 的两个 run 均完成 32 个 profile，环境与 Worker、benchmark、fixture、profile matrix 哈希一致，无 child 超时或证据损坏；失败集中于 9/5 个 `limited` profile、最大 CPU CV 35.8509% 和 4 个跨 run 差异超限。
- `sourceBytes`、`copiedBytes`、`copyOperations`、`allocatedBytes`、writes、sends 与峰值排队已经分离并通过 schema 重算；本次不再改指标定义。

### 本次根因定位

结论：`INCONCLUSIVE` 的直接原因是测量没有先进入可验证稳态，并非 WS 或 gRPC 热路径已证明回归。

1. **缺少稳态门**：每个 profile 只有 2 次单迭代 warmup，之后直接校准和测量。`grpc-upload-64b` run 1 在 14 iterations 的校准样本为 1609 ms，正式 7 轮却依次为 2391、1110、1311、1001、1016、1093、1078 ms；首轮与后续近 2 倍差异表明 JIT、GC 或运行时热状态仍在迁移。
2. **单样本校准放大噪声**：每个校准阶段只测 1 次，并据此直接调整迭代数。相同 profile 两个 run 的 selected iterations 可明显不同，例如 `grpc-download-256b` 为 137/186，说明迭代选择受瞬时样本影响。
3. **短样本 CPU 分辨率不足**：Windows 证据中的早期 CPU 样本大量为 0、15、16、31、94 ms 等离散值；低于 100 ms 的单样本不适合按比例估算 2000 ms 迭代数，只能用于有界几何放大。
4. **profile 未隔离**：一个 child 以固定顺序运行全部 32 个 profile，并共享 V8 进程、模块缓存、GC 与累计 CPU 计时环境。现有证据不能区分协议成本、前序 profile 热状态和进程级后台开销。
5. **窗口判定语义过严且与校准脱节**：校准只要求一个样本进入 1500–3500 ms，正式判定却要求 7 轮每一轮都在窗口内；多项 `limited` 仅由 1499、1485、1438 ms 等接近下限的轮次触发，即使 CV 仍小于 10%。1500–3500 ms 是样本持续时间目标，应约束稳定窗口中位数，而不是把 1 ms 边界抖动当作协议失败。

以下不是本次根因：Worker/benchmark/fixture/profile 哈希漂移、环境字段漂移、child 超时、输出字节错误、指标缺失或敏感字段泄漏；这些门在 v2.4.22 证据中均通过。

### WS

结论：可迭代，但当前实现并非未优化旧路径。

- 已有 Early Data 上限与认证、显式顺序任务链、16 MiB/4096 条溢出保护、公共上行队列、BYOB/Grain 下行和保活。
- `serverSock.binaryType = 'arraybuffer'` 已在 `accept()` 前设置，首帧类型兼容修复已经完成并由回归覆盖。
- 已建连 TCP 上行仍通过 `写入并等待()` 逐消息等待，可能使 16 KiB 合包能力无法形成；可比较“严格逐消息等待”与“同步入队 + 高低水位等待”。
- WS 下行直通可能减少 Grain CPU，也可能增加 WebSocket frame 数和改变可观察边界。它只作为研究候选；若不能保持客户端兼容或收益不稳定，保留现有 BYOB/Grain。

### gRPC

结论：可迭代，且存在比 WS 更明确的复制热点。

- 每个请求块都通过新 `Uint8Array` 合并到 `pending`，每取出一帧又以 `slice()` 复制剩余数据；高碎片输入会重复复制。
- 已建连 TCP 上行同样逐帧 `写入并等待()`，公共合包能力可能无法形成。
- 下行先由 Grain 组成块，再由 `grpcBridge.send()` 复制为 protobuf/gRPC 帧，随后发送队列再次合并；可验证的第一候选是仅在同步复制完成后声明 Grain 缓冲可复用。
- gRPC 必须保留 1 字节压缩标志、4 字节大端长度以及既有 protobuf 字段封装；不能像 XHTTP 一样发送裸 TCP 字节。

## 权威平台与协议约束

- Cloudflare Workers 当前支持 Streams、BYOB Reader 和 TCP socket 的 readable/writable 流：<https://developers.cloudflare.com/workers/runtime-apis/streams/>、<https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/>。
- Cloudflare WebSocket 的 `send()` 接受字符串、`ArrayBuffer` 或 `ArrayBufferView`；兼容日期自 2026-03-17 起默认二进制类型改为 `Blob`，如需同步字节处理应在 `accept()` 前设置 `binaryType="arraybuffer"`：<https://developers.cloudflare.com/workers/runtime-apis/websockets/>。
- Cloudflare 当前 Free 计划 HTTP 请求 CPU 上限为 10 ms，内存为 128 MB；等待网络 I/O 不计 CPU：<https://developers.cloudflare.com/workers/platform/limits/>。本规格使用相对 CPU 门，不假定用户套餐。
- gRPC 消息必须保持 `Compressed-Flag + 4-byte Message-Length + Message` 的长度前缀合同：<https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md>。

## 范围

### 阶段 A1：修复测量合同

先修基准，不写运行时候选：

- 正式矩阵、1 MiB 每方向 fixture、32 个 profile 和指标定义保持冻结，不通过删 profile、增负载或降低门槛制造稳定结果。
- 每个 profile 在独立 Node child 中完成加载、warmup、校准、稳态确认、正式轮次、正确性与计量；父进程最多同时运行 1 个 child。run 1 按 manifest 顺序，run 2 按反向顺序，顺序写入证据以暴露时间漂移。
- 校准每阶段固定采集 3 个样本，以 CPU 中位数决策。CPU 中位数低于 100 ms 时只按 4 倍几何放大；达到 100 ms 后才按目标 2000 ms 比例修正。阶段、迭代、profile child、完整矩阵和总时限均有显式上限。
- 校准后先建立稳态：至少 12 轮、最近 5 轮为一个窗口，连续 3 个窗口同时满足 CPU CV `<= 10%`、首尾中位数趋势 `<= 10%` 才可进入正式测量；最多 24 轮，稳态窗口中位 CPU 不在 1500–3500 ms 时最多重新校准 2 次。
- 正式测量默认需要 7 个连续稳定轮次；最多采集 14 轮，按预先固定的“最近 7 轮连续窗口”规则检查 CPU CV 与趋势，记录所有采集轮次、选中起点和丢弃原因，禁止运行后挑选任意最佳轮次。
- 1500–3500 ms 只约束稳态和正式选中窗口的 CPU 总时长中位数；单轮略过边界不会单独触发 `limited`，但 CV、趋势、最大轮数或重校准上限任一失败仍为 `INCONCLUSIVE`。
- schema v2 为每个 profile 记录 child process ID、执行顺序、三样本校准轨迹、稳态阶段、全部正式轮次、选中窗口、CPU 中位数/CV/趋势、wall time 和既有热路径指标。环境指纹增加 logical cores 与 Windows power mode；无法读取时明确为 `unknown`，不伪造值。
- 正式证据模式仍自动运行完整矩阵；`--profile` 只用于诊断，不写正式证据、不产生 GO/NO-GO。父进程在成功、失败、超时和取消路径回收当前 child，并只原子写入完整证据。
- `sourceBytes` 只表示 fixture 提供的源字节；`copiedBytes` 只累计 Worker 热路径显式复制到目标缓冲的字节，另报 `copyOperations` 和协议临时/输出缓冲的 `allocatedBytes`。不得用输入 chunk 长度推测复制。
- 计量探针必须落在被测 Worker 路径：gRPC `pending` 合并/剩余切片/封帧、WS/gRPC TCP 写入与下行发送。计数测试与 CPU 计时分离，或保证 baseline/candidate 使用完全相同的探针开销。
- 当前 `work-products/debug/ws-grpc-baseline.json` 保持原样；修复后的正式输出写入 `work-products/debug/ws-grpc-baseline-v2.json`，不得记录目标、凭据或真实代理数据。

### 阶段 A2：冻结 baseline

- 在相同 Worker、benchmark、fixture、profile matrix 和 metric definition 哈希下完成两次独立正式运行；两次 run 的 profile 顺序相反且每个 profile 独立进程。
- 全部决策 profile 均完成校准、稳态和正式选中窗口，CPU CV/趋势均 `<= 10%`，且两次运行的 CPU 中位数相对差 `<= 10%`，才可冻结 baseline。
- 任一 profile 无法进入稳态、超时、`limited`、哈希/环境漂移、指标缺失、半成品证据或遗留 child，整次运行标为 `INCONCLUSIVE`；不得开始阶段 B/C，也不得自动重复直到偶然通过。

### 阶段 B：gRPC 独立候选

按以下顺序逐个比较，每项必须只含一个机制，并与其直接前序版本做 A/B；未达门即保留前序版本：

1. 增量帧解析状态：头部只缓存必要尾部，跨块帧体按需累积，单块多帧用游标前进，不复制尚未消费的整段。
2. 已建连 TCP 上行：小块同步入队、达到高水位才等待低水位、大块直接写入并等待，保持解析顺序、硬上限和单次重试。
3. 下行缓冲复用：只有 `grpcBridge.send()` 已同步复制到独立 gRPC frame 且污染测试通过，才声明 Grain 输入可复用。

本轮不融合 Grain 与 gRPC 编码器；只有前三项全部有稳定证据且双重封装仍是主热点时，另写规格。

### 阶段 C：WS 独立候选

- 只评估已建连 TCP 上行的同类高低水位策略，保持显式传输任务顺序、溢出关闭和单次重试。
- `binaryType` 修复作为现状回归，不计入性能收益。
- WS 下行直通默认不实施；改变 frame 边界仍需后续单独批准和真实客户端验证。

### 阶段 D：XHTTP 生产边界

- 不修改 XHTTP 运行逻辑，不恢复已 NO-GO 的原生 `pipeTo` 候选。
- 既有稳定 Node 证据只说明本地回归与相对趋势；双向 64 B 的历史 CPU 中位数 `9.980198 ms` 不能等同于 Workers `cpuTimeMs`，也不能证明 Free 计划已有安全余量。
- 是否继续优化 XHTTP 由部署后的 `exceededCpu`、`cpuTimeMs` 分布和真实客户端流式行为决定；部署与生产验证继续由用户控制。

## 接口与兼容合同

- 不修改 WS Upgrade 路径、gRPC POST 路由、URL、查询参数、鉴权、订阅格式、配置字段、状态码或响应头。
- WS 输入继续接受现有 VLESS、Trojan、Shadowsocks 和 Early Data；输出字节与顺序不变。
- WS 文本保活帧、关闭事件、错误事件和现有溢出关闭语义不变。
- gRPC 请求继续接受现有 `application/grpc*` 路由行为；响应继续保持当前 `application/grpc`、`grpc-status: 0`、`X-Accel-Buffering: no` 和 `Cache-Control: no-store`。
- gRPC 压缩标志、长度字段、protobuf 字段、空保活消息、响应头位置和 payload 字节不变。
- 直连、ProxyIP、SOCKS5、HTTP、HTTPS、TURN、SSTP 和 Trojan fallback 的选择与重试规则不变。
- 不改变 XHTTP 实现；公共 helper 的修改必须证明 XHTTP 专属分支没有回归。

## 项目结构与计划文件

允许的后续修复与实现文件：

- `_worker.js`：批准且达标的最小 WS/gRPC 修改。
- `work-products/benchmarks/ws_grpc_stream_benchmark.mjs`：可重复的合成基准。
- `work-products/tests/ws_transport.test.mjs`：WS 类型、顺序、队列、关闭与重试回归；从最终位置以 `../../_worker.js` 引用产品文件。
- `work-products/tests/grpc_stream.test.mjs`：gRPC 分片、封帧、缓冲复用、关闭与重试回归；从最终位置以 `../../_worker.js` 引用产品文件。
- `.gitignore`：只放行当前 v1 baseline、schema v2 baseline、四个候选证据和最终判定，不放开整个 debug 目录。
- `work-products/tests/ws_grpc_stream_benchmark.test.mjs`：profile、校准、哈希和判定合同。
- `work-products/debug/ws-grpc-*.json` 与 `work-products/debug/ws-grpc-*.md`：脱敏原始数据与 GO/NO-GO 结论。
- `CHANGELOG` 与 `work-products/tests/chain_proxy.test.mjs`：按发布规则同步实际版本和交付描述。

不得把测试放回仓库根目录，不得使用机器专属绝对路径引用产品文件。

## 代码风格

- 保持 `_worker.js` 现有 tab 缩进、中文标识符、分号和小范围 helper 风格。
- 不引入依赖、类层级、通用传输框架或新的配置抽象。
- WS 与 gRPC 的协议专属逻辑保持分离；只复用已经稳定的队列/计量原语。
- 优先通过游标、尾部缓存和已有缓冲复用减少复制，不用定时睡眠或任意批量大小掩盖问题。

示意合同：

```javascript
serverSock.binaryType = 'arraybuffer';
try { serverSock.accept({ allowHalfOpen: true }) }
catch (_) { serverSock.accept() }
```

## 测试策略

### 功能回归

- WS：`binaryType` 在 `accept()` 前生效；首帧、Early Data、连续消息、关闭、错误、保活停止、队列溢出和远端重试顺序正确。
- WS：VLESS/Trojan 响应头仅一次；Shadowsocks 加密发送链不因主链路优化改变。
- gRPC：帧头按 1/2/3/4 字节拆分、帧体跨任意块、一个块包含多帧、空消息和连续 64 B 小消息均按原顺序解析。
- gRPC：候选解析器与基线对同一 fixture 产生完全相同的 payload 序列。
- gRPC：候选下行与基线产生完全相同的 gRPC/protobuf 响应字节；复用缓冲后修改源缓冲不得污染已排队输出。
- 共用：远端 EOF、读取失败、发送失败、flush 失败、重试失败、客户端取消、半关闭和 stream lock 释放在有限超时内收敛，无未处理拒绝。
- XHTTP：既有全量 XHTTP 与链式代理回归继续通过。

### 测量合同回归

- 用合成 CPU 序列证明三样本中位数不会被单个高/低异常值驱动，低于 100 ms 时只几何放大。
- 用下降、上升、高 CV、稳定但窗口外和最终稳定的序列覆盖稳态、趋势、重校准、最大轮数与最近连续窗口选择。
- 用 fake child 证明两个 run 的 64 个 profile child 严格串行、顺序正向/反向、超时/取消只终止当前 child，且不会留下半成品证据。
- schema v2 必须从原始校准、稳态和正式轮次重算所有状态；篡改 process/order、selected window、指标、环境或哈希时 fail-closed。
- v2.4.22 的 `ws-grpc-baseline.json` SHA-256 `3321f9c2e38ebbdbcee7a46ef6af86e65894106cf24bc52800a20c059f27afb9` 保持不变。

### 性能判定

- 稳态与正式选中窗口的 CPU 总时长中位数必须落入 `1500–3500 ms`；单轮边界抖动由 CV/趋势门处理，`limited` profile 仍不得用于决策。
- 每个用于决策的 baseline/candidate profile CPU CV 与趋势必须 `<= 10%`。`baseline` 两次运行的 CPU 中位数相对差也必须 `<= 10%`。
- 同一 baseline 或候选至少完成两次独立正式运行，Worker、基准、fixture 哈希和 profile schema 一致。
- 候选在其目标主 profile 的 CPU 中位数至少下降 `10%`，且两次运行方向一致；否则 NO-GO。
- 非目标的 1 KiB、16 KiB、64 KiB profile CPU 中位数不得回退超过 `5%`。
- wall time 不得回退超过 `5%`；发送次数、写入次数、实际复制/分配或峰值排队不得出现无法解释的增长。
- 任一功能、生命周期、内存有界性、兼容合同、证据完整性或子进程收敛失败，性能数字无条件作废。
- 报告实际百分比和误差，不使用“飞跃式”替代量化证据。

### 验证命令

```powershell
node --test work-products/tests/ws_transport.test.mjs work-products/tests/grpc_stream.test.mjs work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --runs 2 --output work-products/debug/ws-grpc-baseline-v2.json
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

## 可量化验收标准

1. 未冻结稳定 baseline 前，`_worker.js` 不新增任何 WS/gRPC 性能候选。
2. 每个 profile 独立 child；校准每阶段 3 个样本，稳态至少 12 轮并连续通过 3 个五轮窗口，正式选中窗口为预先确定的连续 7 轮。
3. 两次反向顺序完整矩阵运行的全部决策 profile CPU CV/趋势 `<= 10%`、CPU 中位数相对差 `<= 10%`，且 Worker、benchmark、fixture、profile matrix 和 metric definition 哈希一致。
4. `sourceBytes`、`copiedBytes`、`copyOperations` 和 `allocatedBytes` 语义分离；fixture 断言能识别 1 MiB gRPC 下载不可能只有帧头级复制。
5. WS 的 `binaryType` 继续在 `accept()` 前设置，且既有 Upgrade、Early Data、保活和关闭行为不变。
6. gRPC 解析、gRPC 上行、gRPC 下行和 WS 上行分别作为独立候选；每次只改变一个机制并对直接前序版本比较。
7. gRPC 分片解析和下行候选对全部 fixture 输出与基线完全相同；任何缓冲复用都通过源缓冲污染测试。
8. 队列仍有 16 MiB/4096 条硬上限，高低水位、严格顺序、关闭收敛和单次重试不退化。
9. XHTTP 运行逻辑保持不变；历史 Node 结果仅保留为本地证据，Cloudflare CPU 与真实客户端状态仍标为未验证。
10. 全量 Node 回归、语法、变更日志标题、版本一致性和差异检查通过。
11. 新测试均在 `work-products/tests/`，产品引用均为最终位置相对路径；schema v2 证据包含 process/order、三样本校准、稳态、全部正式轮次、选中窗口、环境和哈希，不含敏感连接数据。
12. 本地交付只报告“baseline 已冻结”“本地候选 GO/NO-GO”或“INCONCLUSIVE”；不得把 Node CPU 数字表述为 Cloudflare 生产证明。

## 非目标

- 不把 WS/gRPC 合并为新的通用传输框架。
- 不修改 XHTTP、XMUX、UDP、Shadowsocks 密码学或代理握手算法。
- 不新增自适应 chunk、自动应用识别、管理页开关或 KV 字段。
- 不改变 WS frame 边界来换取局部基准收益，除非后续单独批准且真实客户端通过。
- 不添加 gRPC 压缩、trailers、协议版本或新的最大消息限制。
- 不运行 Wrangler，不部署 Cloudflare，不自动执行真实客户端测试。
- 不把 Node CPU 数字等同于 Workers `cpuTimeMs`。

## 风险与控制

- **WS 首帧类型竞态**：先设置 `binaryType` 再 accept，并用执行型 WebSocketPair mock 断言调用顺序。
- **上行重排或重复**：候选仅改变等待时机，不改变入队顺序；失败重试最多一次，精确断言写入序列。
- **队列增长**：保留硬上限和高低水位；基准记录峰值排队字节和条目。
- **WS frame 边界兼容**：直通只做研究；默认保留 Grain frame 策略。
- **gRPC 分片解析错误**：基线/候选差分测试覆盖所有头部拆分和多帧组合。
- **缓冲复用污染**：只有同步复制路径声明可复用，并在源缓冲后改写测试中证明输出不变。
- **校准失控或孤儿进程**：三样本分阶段放大、稳态/重校准/轮数/时限上限和父进程统一回收共同约束；失败写可重算的完整 `INCONCLUSIVE`，取消不覆盖既有证据。
- **伪复制指标**：计数落在实际 Worker 复制/分配点，输入源字节单列，并用已知 1 MiB fixture 断言指标量级。
- **探针扰动 CPU**：计数与 CPU 计时分离，或保证 baseline/candidate 探针完全对称。
- **基准噪声**：每 profile 进程隔离、三样本校准、显式稳态、反向顺序双 run、CV/趋势门、哈希和完整原始轮次共同约束；不通过时停止而非放宽门槛。
- **局部优化伤害共用路径**：WS、gRPC、XHTTP 分别回归；协议未达标则独立回滚。
- **生产差异**：由用户在 Cloudflare 日志和真实客户端中验证，未验证前不作生产承诺。

## 边界

### 始终执行

- 先修复测量合同并冻结稳定 baseline，再写性能业务改动。
- 保持字节、顺序、帧合同、关闭、取消、重试和敏感信息边界。
- 每个协议单独 GO/NO-GO，保留失败候选证据。
- 同步 `_worker.js` 版本、顶部 `CHANGELOG` 和版本断言。

### 先询问

- 改变 WS frame 边界或 gRPC 消息边界。
- 新增配置项、依赖、最大消息限制或客户端参数。
- 把研究性直通路径设为默认。
- 执行 Cloudflare 部署或真实客户端操作。

### 永不执行

- 为了跑分删除背压、队列上限、关闭或重试保护。
- 记录域名、路径、UUID、代理凭据或原始真实流量。
- 将高 CV、单轮、`limited`、诊断 profile 或未校准数据用于 GO 结论。
- 用输入 chunk 长度冒充 Worker 实际复制/分配指标。
- 将本地 Node 结果冒充 Cloudflare 生产结果。

## 开放问题

无产品范围阻塞问题。本修订已由用户通过 `@uxu-code:plan` 批准并生成新的依赖顺序；T1/T2 已完成，下一步等待显式 `@uxu-code:build` 授权执行 T3 schema v2 正式 baseline。现有 T4–T7 在新 Checkpoint A 通过前继续冻结。
