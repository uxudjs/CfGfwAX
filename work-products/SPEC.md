# Spec: XHTTP stream-one 的 Workers Free CPU 预算优化

## 状态

已批准（2026-07-29，依据用户在待批准规格后显式调用 `@uxu-code:plan`）。

本规格取代上一版“流式响应断连修复与诊断”作为后续优化工作的当前规格。上一版已经完成或正在工作树中的修复及其测试继续作为历史基线保留，不因本次修订而删除、回退或重新归因。

本规格定义目标、接口、风险和验收标准，不直接修改 `_worker.js`、测试或部署状态。后续实施必须依据已批准的 `work-products/plan.md` 和 `work-products/todo.md` 逐项进行。

## 目标

在 Cloudflare Workers Free 每次调用 10 ms CPU 预算约束下，降低 XHTTP `stream-one` 双向转发的每字节 CPU 成本和临时缓冲分配，使通过 CfGfwAX 承载的 Codex 长连接会话显著减少 `Exceeded CPU Time Limits` 和由此产生的异常断开。

目标用户是使用 CfGfwAX 的 XHTTP `stream-one` 节点访问 Codex 等长连接服务的客户端用户。

本任务不承诺任意时长的单次连接永不超过 10 ms。Free 方案的 CPU 按整次请求累计；如果最小实现优化后仍不能满足验收门槛，任务必须返回 NO-GO，并在“请求分段”或“升级 Workers 套餐”之间重新修订规格，不得静默改变架构。

## 已知证据与基线

2026-07-29 对 Cloudflare Dashboard 当前生产部署 `acb52711` 的 24 小时指标观察到：

- 调用量约 15,000。
- 错误约 1,000，当前部署错误率约 8.4%。
- 主要错误为 `Exceeded CPU Time Limits`；另有少量未捕获异常，没有内存超限。
- CPU 时间约为 P50 6.28 ms、P90 19.82 ms、P99 291 ms。
- 请求持续时间约为 P90 167 秒、P99 528 秒，符合长连接调用特征。
- Dashboard 中客户端断开主要记录为 `cancelled`，没有显示 `response stream disconnected`；该指标不能替代 CPU 超限和真实客户端验证。

这些数字是诊断快照，不直接作为最终对照分母。实施开始前和生产验证前必须记录固定窗口、部署 ID、调用量、CPU 分位数和 `exceededCpu` 数量，形成可比较基线。

已定位的代码成本集中在：

1. `处理XHTTP请求()` 对每个 TCP 上传块调用 `写入并等待()`，形成逐块 Promise、完成回调和调度开销，并限制既有合包队列积累多个小块。
2. `创建下行Grain发送器()` 在尾块 flush 时复制缓冲、重建固定缓冲，并使用微任务和定时器调度。
3. `connectStreams()` 的 BYOB 分支仍可能为连续读取反复创建 `ArrayBuffer`，且共享于多个传输路径。

以上是待基准验证的热路径，不是预先批准的具体实现方案。

## 用户场景

### 主要场景

客户端通过以下传输配置建立 XHTTP 单流连接：

```text
xhttp&mode=stream-one
```

该连接在一次长时间 HTTP 请求内双向转发 Codex 应用使用的 WebSocket 长连接数据。会话持续时间较长、数据块大小不固定，既包含大量小块，也包含较大的代码或工具输出。

### 成功体验

- 长会话不再因 Worker `exceededCpu` 被主动终止。
- 数据内容、顺序、重试、背压、EOF 和取消行为与优化前一致。
- 用户不需要启用 XMUX、修改默认连接参数或更换传输协议。

## 假设与已定决策

1. 当前主要生产根因是单次长连接调用累计触发 CPU 上限，而不是 XMUX 缺失。
2. 运行约束固定为 Workers Free 的 10 ms CPU 预算；本任务不能用升级套餐掩盖代码成本。
3. 只允许优化 XHTTP `stream-one`。WebSocket、gRPC、XMUX 和其他传输的可观察行为必须保持不变。
4. 不启用、禁用、重新解释或新增 XMUX 字段；不声称 Cloudflare 原生支持 XMUX。
5. 不改变连接并发、保活、预加载竞速或代理并发默认值。
6. 本地 Node 基准只能证明相对 CPU/分配变化，不能代替 Cloudflare 生产指标。
7. Cloudflare 部署和 Codex 客户端验证均由用户手动完成；仓库不加入 Wrangler 部署路径。
8. 现有工作树中的 XHTTP 上传异常关闭远端 socket 修复属于前置状态，优化必须保留该行为及其回归。

## 范围

### 1. 可重复的分块传输基准

在修改热路径前新增一个独立、无第三方依赖的 Node 基准入口：

```text
work-products/benchmarks/xhttp_stream_benchmark.mjs
```

基准必须：

- 直接驱动与 XHTTP 上行队列、下行 Grain 发送器和 BYOB 读取等价的内部路径，而不是只测一个脱离生产逻辑的复制循环。
- 固定伪随机种子、总字节数、块大小序列、预热轮次和测量轮次。
- 覆盖上行、下行和双向三类 profile。
- 至少覆盖 1 KiB、16 KiB 和 64 KiB 块；每个方向每轮至少传输 16 MiB。
- 默认预热 2 轮、测量 7 轮，逐轮记录，不只输出平均值。
- 使用 `process.cpuUsage()` 报告 `cpuMicrosPerMiB`，同时报告 wall time，但不得把 wall time当作 CPU。
- 报告可重复的分配代理指标，至少包括显式新建缓冲数量、显式复制字节数和 `process.memoryUsage().arrayBuffers` 峰值；如果峰值受 GC 噪声影响，只能作为辅助指标。
- 对输入和输出计算摘要，证明基准前后字节内容、顺序和总长度一致。
- 支持 JSON 输出到 `work-products/debug/xhttp-cpu-baseline.json` 或同结构结果文件。
- 在同一 Node 版本、同一机器且无其他高负载进程时，主要 profile 的 CPU 中位数变异系数不超过 10%；不满足时先修复基准，不得开始优化。

基准结果的最小 JSON 字段：

```json
{
  "profile": "downlink-16k",
  "payloadBytes": 16777216,
  "chunkBytes": 16384,
  "rounds": 7,
  "cpuMicrosPerMiBMedian": 0,
  "wallMsPerMiBMedian": 0,
  "bufferAllocationsPerMiB": 0,
  "copiedBytesPerMiB": 0,
  "arrayBufferPeakBytes": 0,
  "outputSha256": ""
}
```

字段名可以根据实现做最小调整，但基线和优化后结果必须使用同一 schema、同一夹具和同一命令。

### 2. XHTTP 上行逐块等待优化

- 减少每个上传块创建 Promise、完成回调和微任务的固定成本。
- 允许既有有界合包机制真正处理连续小块，但不能形成无界待处理写入。
- 保持背压：生产者不得无限领先于远端 writer。
- 保持上行队列的 16 MiB、4096 条上限或更严格的等价有界约束。
- 写入失败、重试失败、上传取消和队列溢出必须关闭正确的远端连接并拒绝尚未完成的数据。
- 不得丢失、重复、乱序或自动重放已经成功写出的字节。

本规格不预先规定使用批量 await、有限 in-flight 窗口或其他具体实现；方案必须由失败回归和基准共同选择。

### 3. XHTTP 下行复制与 Grain 缓冲优化

- 减少完整块已可直接发送时的复制。
- 减少 flush 后固定缓冲的反复分配和无必要 `.slice()`。
- 只有在底层发送已经完成、且不存在别名写入风险时才能复用缓冲。
- 保持既有 32 KiB Grain 容量、尾部阈值、发送顺序和 flush/EOF 语义。
- 响应头与首个数据块仍按原顺序、恰好一次交付。
- 下游取消、发送失败或远端 EOF 时，定时器、reader、writer、socket 和待处理缓冲均能结束或释放。

### 4. XHTTP 使用的 BYOB 缓冲生命周期优化

- 避免在连续大块读取中无条件重建同尺寸 `ArrayBuffer`。
- 只有在 ReadableStream/BYOB 所有权规则允许时才复用缓冲；被移交、detached 或仍被发送端引用的缓冲不得重用。
- 如果修改共享 `connectStreams()`，默认分支对 WS、gRPC 和其他传输必须保持字节、时序、关闭和重试行为不变。
- 优先采用仅由 `transport === 'xhttp'` 启用的内部策略；共享优化只有在所有既有传输回归通过且无可观察行为变化时才允许。

### 5. 本地与生产双重验收

优化完成后必须使用未改变的 fixture 和命令重新运行基准，并保存优化后 JSON。随后通过完整 Node 回归和静态检查，才允许交由用户手动部署。

部署后以部署时间为边界采集 Cloudflare 指标，并执行真实 Codex 长连接验证。生产验证失败不得以本地基准通过替代。

## 非目标

- 不修改 XHTTP、VLESS 或 Trojan 的线上协议格式、路径、认证或响应头。
- 不增加 XHTTP multi-stream、packet-up、分段请求、断点续传或会话迁移。
- 不启用或调整 XMUX。
- 不修改 WS、gRPC 或其他传输行为。
- 不修改 `PRELOAD_RACE_DIAL`、`TCP_CONCURRENT_DIAL`、`PROXY_CONCURRENT_DIAL`、`KEEPALIVE_INTERVAL` 的默认值。
- 不增加、删除或重命名环境变量、KV 字段或管理页设置。
- 不修改 `CGAX-Pages`。
- 不重构 TLS、代理选择、链式代理协议或整个 Worker。
- 不新增第三方依赖、构建系统或包管理清单。
- 不创建 `wrangler.toml`、部署脚本、直接部署说明或自动发布流程。
- 不把优化后的内部性能数字宣传为 Cloudflare 或 Codex 官方保证。

## 接口与兼容性契约

### 外部传输契约

以下内容必须保持不变：

- 订阅输出仍为 `xhttp&mode=stream-one`。
- 请求路径、查询参数、Content-Type、认证及首包解析格式。
- 响应状态码及以下响应头：

```text
Content-Type: application/octet-stream
X-Accel-Buffering: no
Cache-Control: no-store
```

- 上下行字节内容、顺序和恰好一次交付。
- 远端正常 EOF、客户端取消、写入失败和读取失败的关闭语义。
- 显式链式代理失败继续 fail closed，不回退到其他出口。

### 共享内部接口契约

`创建上行写入队列()`、`创建下行Grain发送器()` 和 `connectStreams()` 是多个传输共享的内部接口。允许修改内部实现，但：

- 现有调用签名默认语义不变。
- 非 XHTTP 调用不得自动启用新的批处理、缓冲或调度策略。
- 新增内部参数必须可选、具有保持当前行为的默认值，并只由 XHTTP `stream-one` 显式使用。
- 不向公开配置、环境变量、KV 或订阅格式暴露性能旋钮。

### 可观察的分块契约

尽管 TCP 字节流理论上不保证应用块边界，现有 Grain 大小、尾部 flush 和首包拼接属于可能被客户端依赖的可观察行为。优化必须用回归证明：

```text
输入字节序列
    ↓
既有 Grain/首包策略
    ↓
输出字节内容与顺序一致 → flush 完成 → EOF/关闭
```

没有单独批准时，不改变 Grain 常量和外部可见分块策略。

## 项目结构

- `_worker.js`：XHTTP 请求处理、共享上行队列、下行 Grain 发送器和 stream 转发。
- `work-products/benchmarks/xhttp_stream_benchmark.mjs`：独立性能与分配基准，不加入生产 Worker。
- `xhttp_stream.test.mjs`：聚焦 XHTTP 字节、背压、缓冲所有权和取消回归；如最小实现适合现有结构，可复用 `chain_proxy.test.mjs`，但不得继续堆积无关性能夹具。
- `chain_proxy.test.mjs`：保留链式代理和现有 XHTTP 上传异常关闭连接回归。
- `work-products/debug/xhttp-cpu-baseline.json`：本地基线证据。
- `work-products/debug/xhttp-cpu-after.json`：相同环境下的优化后结果。
- `CHANGELOG`：实现完成时追加准确的用户可见说明，不覆盖或重命名历史版本标题。

`work-products/SPEC.md`、`work-products/debug/` 与 `work-products/rollback/` 统一承载本地工作流文件；基准程序位于 `work-products/benchmarks/`，并由 `.gitignore` 显式放行。

## 代码风格

沿用现有 JavaScript 风格：制表符缩进、分号、`const` 优先、`let` 仅用于重赋值、异步资源显式释放、简体中文注释。

示意：

```javascript
const 写入结果 = 上行写入队列.写入(data);
if (!写入结果) throw new Error('Remote socket is not ready');
await 上行写入队列.等待背压();
```

该片段只说明“入队”和“有界背压”应分离，不批准具体方法名或实现。最终代码必须复用现有队列和流接口，避免为单一用途建立新框架。

## 命令

基准命令：

```powershell
node --expose-gc work-products/benchmarks/xhttp_stream_benchmark.mjs --profile all --warmup 2 --rounds 7 --output work-products/debug/xhttp-cpu-baseline.json
node --expose-gc work-products/benchmarks/xhttp_stream_benchmark.mjs --profile all --warmup 2 --rounds 7 --output work-products/debug/xhttp-cpu-after.json
```

本地完整验证：

```powershell
node --test
node --check _worker.js
git diff --check
```

不得添加或运行 Wrangler 部署命令。

## 测试策略

### 基准先行

1. 基准脚本必须在业务优化前落地并生成基线。
2. 基准自身需要契约测试，验证参数解析、固定种子、JSON schema、摘要一致性和失败退出码。
3. 基线文件生成后不得因优化结果不理想而修改 fixture、块分布、轮次或统计口径。
4. 如确需修正基准缺陷，必须同时重跑基线和优化后版本，并在结果中记录基准版本或源文件 SHA。

### 功能回归

最低覆盖：

1. XHTTP 上行 1 字节、小块、16 KiB、32 KiB、64 KiB 和跨阈值混合块。
2. XHTTP 下行首包响应头、完整 Grain、短尾部、连续大块和随机确定性分块。
3. 慢 writer 产生背压时队列保持有界，数据不丢失、不重复、不乱序。
4. 写入中途失败、重试成功、重试失败和队列溢出。
5. 请求 body 正常 EOF、上传异常、响应取消和远端正常 EOF。
6. BYOB 缓冲被移交或仍在发送时不被提前覆写。
7. 现有 XHTTP 上传异常关闭远端 socket 回归继续通过。
8. WS、gRPC、SOCKS5、HTTP/HTTPS CONNECT、TLS KeyUpdate 和连接设置测试全部继续通过。

### 性能回归

相同机器、Node 版本、fixture 和命令下：

- 1 KiB 与 16 KiB 主要 XHTTP profile 的 `cpuMicrosPerMiBMedian` 至少降低 25%。
- 受改动路径的 `bufferAllocationsPerMiB` 或 `copiedBytesPerMiB` 至少降低 30%。
- 64 KiB profile 的 CPU 和分配指标均不得回退超过 5%。
- 任一 profile 的输出摘要、字节数或顺序不得变化。
- 如果基准噪声超过 10%，不得用单次最好结果声称达标。

这些门槛证明优化方向有效，但不单独构成生产 GO。

## 生产验收

### 指标窗口

用户手动部署后记录：

- 部署 ID 和部署时间。
- 观察窗口起止时间。
- 总调用量。
- `exceededCpu` 数量和占比。
- CPU P50、P90、P99。
- 其他错误分类及数量。

使用部署前后相同长度、尽量相近使用模式的窗口比较。默认观察 24 小时；若部署后调用量不足 1,000，则延长至最多 7 天，直到达到 1,000 次调用或明确标注样本不足。

### Cloudflare 指标门槛

同时满足：

1. `exceededCpu` 占比不高于 1.0%。
2. `exceededCpu` 占比相对部署前基线降低至少 80%。
3. CPU P90 不高于 10 ms。
4. 未捕获异常、内存错误和其他 Worker 错误不比基线增加超过 0.5 个百分点。

如果调用构成明显不同或样本不足，只能标记“生产证据不足”，不能标记通过。

### Codex 长连接门槛

用户在真实客户端上完成至少 3 个独立会话，每个会话：

- 持续至少 30 分钟。
- 至少包含 10 次对话往返。
- 至少包含一次长代码输出或工具调用产生的持续响应。
- 不出现 `stream disconnected before completion`、`Transport error: network error`、`error decoding response body` 或客户端自动重连。

同时核对会话时间段没有对应的 `exceededCpu`。客户端通过而指标失败，或指标通过而客户端失败，都不能标记完整通过。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Free 方案对任意长单次请求存在结构性 CPU 上限 | 设本地与生产双门；失败后停止并重新批准分段请求或付费方案 |
| Node 基准不能代表 Cloudflare V8 isolate | 基准只做相对优化证据，最终以生产指标和真实客户端为准 |
| 基准受 GC、系统负载或计时噪声影响 | 固定环境、预热、多轮中位数、变异系数门槛和原始逐轮数据 |
| 缓冲复用导致已发送数据被覆写 | 增加慢发送与别名生命周期回归，只有发送完成后才复用 |
| 批量上行削弱背压并增加内存 | 保持明确的字节/条目上限，测试慢 writer 和溢出关闭 |
| 修改共享流函数影响 WS/gRPC | XHTTP 显式启用策略，运行所有共享传输回归 |
| 优化改变外部可见 Grain 边界 | 固定 Grain/尾部策略并做分块序列回归 |
| 工作树已有未提交修复导致归因混淆 | 记录实现前 diff；保留既有修复测试；计划中按当前磁盘状态建立基线 |
| 生产前后流量组成不同 | 记录窗口、调用量和客户端验证；样本不可比时标记证据不足 |

## 边界

### 始终执行

- 先建立可重复基准和失败回归，再改生产热路径。
- 保持协议字节、顺序、恰好一次、背压和资源释放。
- 保留当前工作树中的既有修复，不覆盖用户或前序任务变更。
- 每个实现任务都给出回滚范围和验证命令。
- 完成实现时准确更新 `CHANGELOG`。
- 运行基准、完整 Node 测试、语法检查和 diff 检查。
- 将本地证据与生产证据明确分开表述。

### 需先确认

- 改变 25%/30% 本地性能门槛或 1%/80% 生产门槛。
- 改变 Grain 大小、尾部阈值、上行队列容量或条目上限。
- 修改共享 WS/gRPC 行为。
- 增加环境变量、KV、公开配置或第三方依赖。
- 采用请求分段、升级套餐或新增传输模式。
- 执行版本发布；若后续明确为发布任务，必须同步 `_worker.js` 版本、全新 CHANGELOG 语义版本标题和测试断言。

### 禁止

- 为达标筛选单次最好基准、改变优化前后 fixture 或隐藏失败 profile。
- 以 wall time 代替 CPU time。
- 记录隧道内容、UUID、Authorization、Cookie、代理凭据或目标完整 URL。
- 用无限队列或无界内存换取更低调度次数。
- 静默启用 XMUX、改变客户端协议或调整默认连接参数。
- 创建或运行 Wrangler 直接部署路径。
- 把本地测试、基准或短会话表述为生产修复完成。

## 成功标准

1. 新基准在优化前生成稳定、可重复、带摘要的 CPU 与分配基线。
2. 优化后主要小块 profile 的 CPU 中位数至少降低 25%，分配或复制指标至少降低 30%，大块 profile 不回退超过 5%。
3. XHTTP 的协议、响应头、字节内容、顺序、Grain 策略、背压、EOF、取消和错误关闭行为保持不变。
4. WS、gRPC、XMUX、连接默认参数和其他代理传输无行为变化，全部既有测试通过。
5. `node --test`、`node --check _worker.js` 和 `git diff --check` 全部通过。
6. 用户手动部署后的可比生产窗口同时满足 `exceededCpu` ≤1%、相对下降 ≥80%、CPU P90 ≤10 ms，且其他错误无显著回退。
7. 三个真实 Codex 长连接会话满足时长与交互要求，且没有定义的异常断开或对应 CPU 超限。
8. `CHANGELOG` 准确描述优化及证据边界；没有新增部署配置或直接部署流程。

只有 1–8 全部满足，才能把本任务标记为生产验收通过。只满足本地条件时，状态必须是“本地优化已验证，等待用户部署和生产验收”。

## 回滚

- 业务实现必须按上行、下行、BYOB 三个可独立回滚的切片组织。
- 任一切片功能回归或生产指标变差时，只回退该切片，不回退既有 XHTTP 上传异常关闭连接修复。
- 回滚后重新运行完整 Node 验证，并由用户重新部署。
- 如果全部代码优化回滚后恢复基线行为，保留基准和生产证据用于下一次架构决策。

## 开放问题

无未决实现范围。以下数值作为本规格的待批准默认值：

- 本地 CPU 降低至少 25%。
- 分配或复制降低至少 30%。
- 生产 `exceededCpu` ≤1%，且相对下降至少 80%。
- 三个独立、每个至少 30 分钟的真实 Codex 会话。

批准本规格即批准这些门槛；如需调整，应在进入 `@uxu-code:plan` 前修改。
