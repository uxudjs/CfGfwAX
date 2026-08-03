# Implementation Plan: WS 与 gRPC 稳态基准 v2 与协议专属候选

## 状态

已规划，日期：2026-08-02，等待后续 `@uxu-code:build` 授权执行。用户本轮显式调用 `@uxu-code:plan`，据此批准当前 `work-products/SPEC.md` 的第二轮测量修订并授权生成计划；本轮只更新流程产物和项目规定的发布元数据，不修改 WS、gRPC 或 XHTTP 运行逻辑，不执行 Cloudflare 部署或真实客户端操作。

第一轮 v2.4.22 计划与任务清单已原样归档为：

- `work-products/specs/ws-grpc-first-pass.completed.plan.md`
- `work-products/specs/ws-grpc-first-pass.completed.todo.md`

## 规划依据与充分性

- 修订规格已明确目标、范围、协议/接口兼容、测量算法上下限、32-profile 冻结矩阵、schema v2 字段、候选顺序、量化门槛、回滚和生产验证边界；没有需要另建规格的材料性开放问题。
- v2.4.22 的 `work-products/debug/ws-grpc-baseline.json` 已完成两个 32-profile run，但直接证据为 `INCONCLUSIVE`：最大 CPU CV 35.8509%，两个 run 分别有 9/5 个 `limited` profile，4 个 profile 跨 run CPU 中位数差超过 10%。该文件 SHA-256 `3321f9c2e38ebbdbcee7a46ef6af86e65894106cf24bc52800a20c059f27afb9` 必须保持不变。
- 当前 benchmark 已具备冻结 profile matrix、真实 Worker 热路径计量、候选接线探针、证据重算、子进程收敛和原子写入；第二轮只修复已定位的测量缺陷，不重定义 source/copy/allocation 指标，不删除 profile，不增加 fixture 负载。
- 当前缺口已经从源码和 v1 证据确认：每个 run 的 32 个 profile 共用一个 child；每个 profile 只有 2 次单迭代 warmup；校准阶段只有单样本；正式固定采 7 轮且逐轮要求落入时间窗；环境指纹尚未记录 logical cores 与 Windows power mode。
- WS `binaryType` 已在 `accept()` 前设置；`connectStreams()` 的 BYOB/Grain、`connectXHTTPStreams()` 的 XHTTP 专属直通、公共上行队列和断流诊断都是既有基线。本计划不把这些既有行为计为新收益。

因此可直接规划，无需再次调用 `@uxu-code:spec`。

## 规划具体化

为消除“趋势”和“最近连续窗口”的实现歧义，后续测试先固定以下纯算法合同：

1. 对长度为奇数的窗口，令 `half = floor(n / 2)`；`startMedian` 为前 `half` 个 CPU 样本中位数，`endMedian` 为后 `half` 个样本中位数，中间样本不参与端点趋势。`trend = abs(endMedian - startMedian) / startMedian`；分母非有限或不大于 0 时 fail-closed。
2. 稳态至少采 12 轮。每新增一轮后只检查尾部连续三个 5 轮窗口；三个窗口各自 CPU CV 与 trend 均 `<= 10%` 才进入正式测量。最多 24 轮。
3. 稳态尾部窗口 CPU 中位数不在 `1500–3500 ms` 时触发重新校准；最多重校准 2 次，即初次加两次，共 3 个校准/稳态 attempt。
4. 正式测量从第 7 轮起，每次只检查“当前最近 7 轮”；第一个通过 CPU CV、trend 及窗口中位数门的尾部窗口立即被选中并停止。最多采 14 轮，不允许事后从多个窗口中挑最佳结果。
5. 校准每阶段以同一 iterations 采 3 个样本并按 CPU 中位数决策；中位数低于 100 ms 时仅乘 4，达到 100 ms 后才按 `2000 / median` 比例调整，并受阶段数、iterations、profile child 与总时限约束。

这些具体化不改变规格阈值；若后续执行前要求采用另一趋势定义，应先修订规格和本计划，不得在实现中静默替换。

## 依赖图

```text
批准修订 SPEC
  -> T1 稳态与窗口选择纯合同
      -> T2 每 profile 独立 child、schema v2 与正式 CLI
          -> T3 双 run baseline v2
              -> Checkpoint A
                  ├─ INCONCLUSIVE -> 跳过 T4—T7 -> T8
                  └─ frozen -> T4 gRPC 增量解析
                                -> T5 gRPC 上行水位
                                    -> T6 gRPC 下行复用
                                        -> Checkpoint B
                                            -> T7 WS 上行水位
                                                -> T8
```

T1—T3 严格串行。T4—T7 也严格串行，因为每项必须以直接前序 Worker 为 A/B 基线；一个协议或候选的 NO-GO 不自动否定后续候选，但必须先回滚其业务代码。

## 共用完成标准

- 未通过 Checkpoint A 前，`_worker.js` 除补丁 Version 外不得出现 WS/gRPC 性能业务修改；XHTTP 运行逻辑在全部任务中保持不变。
- 正式矩阵精确保留 32 个 profile、每方向 1 MiB fixture、当前 metric definition；缺失、重复、额外或改名均使证据 `INCONCLUSIVE`。
- 正式 baseline/candidate 必须在相同 Worker、benchmark、fixture、profile matrix、metric definition 和环境指纹下完成两个独立 run；全部用于决策的 profile CPU CV/trend 与跨 run 中位数差均 `<= 10%`。
- 每个候选只改变一个机制；两个固定 A/B pair 的主 profile CPU 中位数均至少下降 10%，方向一致；非目标 CPU 和全部 profile wall time不得回退超过 5%。
- 字节、顺序、frame/message、队列硬上限、关闭、取消、重试、内存有界性、证据完整性或 child 收敛任一失败，baseline 为 `INCONCLUSIVE`，候选为回滚业务代码后的 `NO-GO`。
- `sourceBytes`、`copiedBytes`、`copyOperations`、`allocatedBytes`、writes、sends 和 peak queue 保持分离；CPU 计时与计数探针分离或严格对称。
- 所有新测试仅位于 `work-products/tests/`，从最终位置以相对路径引用产品文件；证据不含域名、URL、UUID、凭据或真实流量。
- 每个实际完成的任务按当时顶部版本取下一补丁号，同步顶部 `CHANGELOG`、`_worker.js` Version 和 `work-products/tests/chain_proxy.test.mjs`；历史 release 节不得改写。
- 每项至少通过目标测试、`node --test`、`node --check _worker.js`、CHANGELOG 标题测试和 `git diff --check`；不运行 Wrangler、不部署。

固定候选判定矩阵沿用批准规格：

| 候选 | 主 profile | 支撑 profile | 固定非目标 |
| --- | --- | --- | --- |
| gRPC parser | `grpc-upload-fragmented-64b` | `grpc-upload-multiframe-256b` | gRPC 上传/双向 1 KiB、16 KiB、64 KiB及全部 gRPC 下载 |
| gRPC uplink | `grpc-bidirectional-64b` | `grpc-upload-64b` | gRPC 上传/双向 1 KiB、16 KiB、64 KiB及全部 gRPC 下载 |
| gRPC buffer reuse | `grpc-bidirectional-64b` | `grpc-download-64b` | gRPC 下载/双向 1 KiB、16 KiB、64 KiB及全部 gRPC 上传 |
| WS uplink | `ws-bidirectional-64b` | `ws-upload-64b` | WS 上传/双向 1 KiB、16 KiB、64 KiB及全部 WS 下载 |

## Task 1：固化三样本校准、稳态和正式窗口合同

**范围**

- 在 `work-products/tests/ws_grpc_stream_benchmark.test.mjs` 先增加 RED 合同，再在 benchmark 中实现最小纯函数，使测试转绿。
- 将校准改为每阶段 3 样本 CPU 中位数；覆盖低于 100 ms 的 4 倍几何放大、达到 100 ms 后的比例修正、iterations/阶段上限和完整轨迹。
- 增加稳定窗口的 median/CV/trend 重算、至少 12/最多 24 轮、连续三个尾部 5 轮窗口、最多两次重校准，以及正式最近 7 轮/最多 14 轮的确定性选择。
- 只实现纯判定和单 profile 内部状态机；不改变父进程矩阵编排，不写 schema v2 正式证据，不修改协议运行逻辑。

**验收标准**

- [x] 单个高/低异常值不能驱动三样本校准；所有轨迹保留原始样本、中位数、iterations 和决策原因。
- [x] 合成下降、上升、高 CV、稳定但窗口外、重校准后稳定和始终不稳定序列得到唯一可重算结果。
- [x] 正式选择只取第一个通过门的当前尾部 7 轮，无法通过时在第 14 轮准确返回 `INCONCLUSIVE`，不挑最佳窗口。
- [x] v1 baseline SHA 不变，目标测试及全量门禁通过，本任务没有协议运行逻辑 diff。

**验证**

```powershell
node --test work-products/tests/ws_grpc_stream_benchmark.test.mjs
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**可能修改**：`work-products/benchmarks/ws_grpc_stream_benchmark.mjs`、`work-products/tests/ws_grpc_stream_benchmark.test.mjs`、`CHANGELOG`、`_worker.js`（仅 Version）、`work-products/tests/chain_proxy.test.mjs`。

**回滚**：成组回退纯算法、合同测试和本任务发布元数据；不触碰 v1 baseline、热路径探针或协议代码。

## Task 2：实现每 profile 独立 child 与 schema v2 正式证据

**范围**

- 父进程按 run 1 manifest 正序、run 2 反序依次启动 64 个 profile child，并发上限固定为 1；每个 child 独立加载 Worker，完成 warmup、校准、稳态、正式轮次、正确性和计数。
- 成功、失败、超时和取消都只回收当前 child；父进程内存中组装终态证据，只有完整、可校验的 `frozen` 或 `INCONCLUSIVE` schema v2 才原子替换输出。取消不覆盖既有证据。
- schema v2 记录 PID、run/order、三样本校准、全部稳态轮次、重校准原因、全部正式轮次、selected window、median/CV/trend、wall、既有热路径指标和五类哈希。
- 环境指纹增加 logical cores 和 Windows power mode；读取失败写 `unknown`，不得猜测。`--profile` 继续仅诊断，不得写正式证据或结论。
- 保持 32-profile、fixture 和指标定义冻结；测试用 fake child/短 fixture，不运行完整正式矩阵。

**验收标准**

- [x] fake child 证明 64 个 profile 严格串行、第二 run 反序、PID/order 唯一且最大并发为 1。
- [x] 超时、取消、非零退出、非法 JSON、缺失 profile 与子进程残留均 fail-closed；旧完整输出和 v1 baseline 不被破坏。
- [x] schema v2 能从原始校准/稳态/正式轮次重算所有摘要和 `baselineStatus`，篡改 process/order、selected window、环境、指标或哈希会被拒绝。
- [x] 计时与计数路径的探针语义不漂移，1 MiB gRPC download 复制量级合同继续通过。

**验证**

```powershell
node --test work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --help
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Task 1。

**可能修改**：benchmark、对应 benchmark 测试、`CHANGELOG`、`_worker.js`（仅 Version）和版本断言。

**回滚**：回退 schema v2/编排与发布元数据，保留 Task 1 的纯算法合同；不得删除或覆盖 v1 baseline。

## Task 3：生成并判定双 run baseline v2

**范围**

- 先校验 v1 baseline SHA，再以冻结 Worker/benchmark/fixture/profile matrix/metric definition 执行一次正式双 run，写入 `work-products/debug/ws-grpc-baseline-v2.json`。
- 仅精确放行该文件的 `.gitignore` 路径；不得放开整个 debug 目录，也不得覆盖 `ws-grpc-baseline.json`。
- 对 schema v2 重新验证完整性、敏感字段、child 收敛和哈希。通过全部 profile 的稳态、正式和跨 run 门才标记 `frozen`。
- 若任一门失败，记录一次完整可重算的 `INCONCLUSIVE`，不自动重复直到偶然通过；Checkpoint A 关闭并跳过 T4—T7。

**验收标准**

- [ ] 两个 run 各 32 个独立 child，顺序正向/反向，无遗留 child 或半成品输出。
- [ ] `frozen` 仅在全部 profile CPU median/CV/trend、窗口、跨 run 差、环境与哈希门通过时成立。
- [ ] `INCONCLUSIVE` 仍保存准确失败分类和完整原始轮次，但不得产生候选 GO/NO-GO 或 Worker 性能代码。
- [ ] v1 baseline SHA 保持批准值；schema v2 证据与实际最终文件哈希一致且无敏感数据。

**验证**

```powershell
node --test work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --runs 2 --output work-products/debug/ws-grpc-baseline-v2.json
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Task 2。

**可能修改/生成**：`.gitignore`、`work-products/debug/ws-grpc-baseline-v2.json`、benchmark（仅证据揭示的测量缺陷修复，若发生必须回到 T1/T2 重跑）、发布元数据。

**回滚**：只回退 v2 精确放行、v2 证据和本任务发布元数据；v1 证据、Task 1/2 通用测量修复保留。

## Checkpoint A：运行时候选入口

- [ ] T1/T2 目标测试和全量本地门禁通过。
- [ ] T3 `baselineStatus` 为 `frozen`，全部决策 profile 的 CPU CV/trend 与跨 run CPU 中位数差均 `<= 10%`。
- [ ] Worker、benchmark、fixture、profile matrix、metric definition 和环境指纹一致；无遗留 child、半成品或敏感数据。
- [ ] `_worker.js` 除发布 Version 外没有本轮协议性能修改，XHTTP 运行逻辑不变。

Checkpoint A 任一项失败即停止运行时候选；不得通过放宽阈值、删 profile、追加更多 run 或挑选最好窗口打开门禁。

## Task 4：评估 gRPC 增量帧解析候选

**范围**

- 新建 `work-products/tests/grpc_stream.test.mjs`，从最终位置以 `../../_worker.js` 引用产品文件；先固定 gRPC 头部 1/2/3/4 字节拆分、帧体跨块、单块多帧、空消息、连续 64 B、错误和取消合同。
- 只用游标、必要尾部和跨块帧体缓冲替换 `pending` 整段合并/剩余 `slice()`；不改压缩标志、长度、protobuf、路由、响应头、消息上限或关闭语义。
- 相对 Checkpoint A Worker 完成两个固定 A/B pair；未达门则回滚 parser 业务代码，保留差分/生命周期通用测试与 NO-GO 证据。

**验收标准**

- [ ] 基线与候选对全部正常/异常 fixture 的 payload、顺序、错误和收敛完全一致。
- [ ] 实际 copiedBytes/copyOperations/allocatedBytes 下降可解释，两个 pair 主 profile CPU 均改善至少 10%，非目标与 wall 门通过才 GO。
- [ ] 任一门失败即最终 Worker 精确恢复 predecessor；WS、XHTTP、UDP、代理选择与全量回归通过。

**验证**

```powershell
node --test work-products/tests/grpc_stream.test.mjs work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-parser --phase predecessor --runs 2 --output work-products/debug/ws-grpc-candidate-grpc-parser.json
# 候选功能回归通过后：
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-parser --phase candidate --runs 2 --evidence work-products/debug/ws-grpc-candidate-grpc-parser.json
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Checkpoint A 全部通过。

**回滚**：只回退 parser 候选和候选专属断言；保留通用 gRPC 回归、NO-GO 证据、测量基础和准确发布元数据。

## Task 5：评估 gRPC 已建连上行水位候选

**范围**

- 只改变已建连 gRPC TCP 上行的等待时机：小块同步入队，达到高水位才等待低水位，大块直接写并等待；保留严格顺序、16 MiB/4096 条硬上限、尾部 drain 和单次重试。
- 扩展 gRPC 生命周期测试覆盖正常 EOF、error/cancel/overflow、悬挂写入、writer 失败和重试；不改 parser、下行、响应 frame 或 XHTTP。
- 以 Task 4 最终 Worker 为直接前序完成两个固定 A/B pair；NO-GO 时回滚本候选后再进入 T6。

**验收标准**

- [ ] 小消息严格按序且 writes 下降；峰值排队、水位与硬上限均有确定性测试。
- [ ] 正常关闭写完尾部，异常路径有限收敛，无重复/丢失 payload 或未处理拒绝。
- [ ] 两个 pair 的性能、wall 和非目标门全部通过才 GO，否则最终 Worker 恢复 predecessor。

**验证**

```powershell
node --test work-products/tests/grpc_stream.test.mjs work-products/tests/xhttp_stream_uplink.test.mjs work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-uplink-watermark --phase predecessor --runs 2 --output work-products/debug/ws-grpc-candidate-grpc-uplink.json
# 候选功能回归通过后：
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-uplink-watermark --phase candidate --runs 2 --evidence work-products/debug/ws-grpc-candidate-grpc-uplink.json
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Task 4 完成；其 NO-GO 时以回滚后的 Worker 为前序。

**回滚**：只回退 gRPC 水位候选和候选专属断言，保留通用生命周期测试、NO-GO 证据与前序结论。

## Task 6：评估 gRPC 下行安全缓冲复用候选

**范围**

- 先用污染测试证明 `grpcBridge.send()` 同步复制到独立 gRPC frame；仅在证明成立后声明 Grain 输入缓冲可复用。
- 只改变 gRPC bridge 的复用能力，不融合 Grain/编码器，不改变空保活、响应头、protobuf 字节、关闭或 WS/XHTTP 复用语义。
- 以 Task 5 最终 Worker 为前序完成两个固定 A/B pair；失败时移除复用声明并保留 NO-GO。

**验收标准**

- [ ] 修改源缓冲后，已排队输出仍与前序逐字节一致；发送失败与取消有限收敛。
- [ ] 目标复制/分配下降且两个 pair CPU 达门，无 sends、peak queue、wall 或非目标回退。
- [ ] 任一安全/性能门失败即恢复 predecessor，不回退此前独立 GO。

**验证**

```powershell
node --test work-products/tests/grpc_stream.test.mjs work-products/tests/xhttp_stream_downlink.test.mjs work-products/tests/xhttp_stream_direct_downlink.test.mjs work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-buffer-reuse --phase predecessor --runs 2 --output work-products/debug/ws-grpc-candidate-grpc-buffer-reuse.json
# 候选功能回归通过后：
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-buffer-reuse --phase candidate --runs 2 --evidence work-products/debug/ws-grpc-candidate-grpc-buffer-reuse.json
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Task 5 完成；其 NO-GO 时以回滚后的 Worker 为前序。

**回滚**：只回退 gRPC 复用声明和候选专属断言；保留污染测试、NO-GO 证据和前序结论。

## Checkpoint B：gRPC 独立结论

- [ ] T4/T5/T6 各自为可复现 GO，或业务代码已回滚且有可重算 NO-GO。
- [ ] 所有保留候选的字节、顺序、生命周期、CPU、wall、复制/分配和排队门通过。
- [ ] XHTTP、WS、链式代理与全量回归通过；最终 Worker 精确对应每个 GO/NO-GO 证据链。

## Task 7：评估 WS 已建连上行水位候选

**范围**

- 只在 VLESS/Trojan TCP 已建连路径评估小块同步入队、高低水位等待；不改变 Early Data、Shadowsocks、UDP、下行 Grain/frame 边界或 `binaryType` 顺序。
- 保持显式消息任务顺序、16 MiB/4096 条硬上限、正常 close drain、异常 abort 和单次重试；补齐悬挂写入后的关闭/错误收敛测试。
- 以 Checkpoint B Worker 为前序完成两个固定 A/B pair；失败时回滚 WS 候选。

**验收标准**

- [ ] VLESS/Trojan 小消息按序且 writes 下降；首包、Early Data、SS、UDP、保活和下行 frame 策略不变。
- [ ] 水位、硬上限、close/error/cancel、重试及悬挂写入均有限收敛，无尾部丢失或未处理拒绝。
- [ ] 两个 pair 的 CPU、wall 和非目标门均通过才 GO，否则最终 Worker 恢复 predecessor。

**验证**

```powershell
node --test work-products/tests/ws_transport.test.mjs work-products/tests/xhttp_stream_uplink.test.mjs work-products/tests/connection_settings.test.mjs work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate ws-uplink-watermark --phase predecessor --runs 2 --output work-products/debug/ws-grpc-candidate-ws-uplink.json
# 候选功能回归通过后：
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate ws-uplink-watermark --phase candidate --runs 2 --evidence work-products/debug/ws-grpc-candidate-ws-uplink.json
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Checkpoint B。

**回滚**：只回退 WS 水位候选和专属断言；保留通用生命周期测试、NO-GO 证据及 gRPC 结论。

## Task 8：闭环证据、状态与最终本地门禁

**范围**

- 按实际 `frozen`、GO/NO-GO 或 `INCONCLUSIVE` 更新 plan/todo，并写最终本地判定；覆盖现有最终判定前先原样归档第一轮 v2.4.22 文档。
- 核对 v1/v2 baseline、候选证据、原始轮次、selected windows、环境/哈希、最终 Worker 和敏感字段；没有冻结 baseline 时明确 T4—T7 为 gate-skipped，而不是性能 NO-GO。
- 同步最后一个实际交付版本并运行全量门禁；Cloudflare、Workers 日志、真实客户端和 WS 下行直通继续由用户控制或另立规格。

**验收标准**

- [ ] 任务/checkpoint 状态与证据一致，`INCONCLUSIVE`、NO-GO、GO 和未执行边界没有混写。
- [ ] 版本三处一致，历史 CHANGELOG 与 v1 baseline 未改写；证据路径被精确跟踪且无敏感信息。
- [ ] 全量 Node、Worker 语法、标题和差异检查通过；未执行的生产验证明确列出。

**验证**

```powershell
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs work-products/tests/ws_grpc_stream_benchmark.test.mjs
git diff --check
git status --short
```

**依赖**：T7 完成；若 T3 `INCONCLUSIVE`，则跳过 T4—T7 后直接进入。

**回滚**：只回退本任务状态、最终判定和发布元数据；不删除 v1/v2 原始证据，不回退此前独立 GO。

## 上下文加载约定

- T1：修订规格测量算法段、benchmark 的校准/统计函数和目标测试。
- T2：T1 合同、child orchestration、evidence builder/validator、环境指纹和原子写入。
- T3：正式 CLI、v1 SHA、schema v2 校验和 `.gitignore` 精确路径。
- T4：gRPC 请求解析、分片 fixture、直接前序 baseline 和 gRPC 差分测试。
- T5：gRPC 已建连写入、公共上行队列、生命周期测试和 T4 最终状态。
- T6：`grpcBridge.send()`、Grain 发送器、污染测试和 T5 最终状态。
- T7：WS 消息任务链、已建连写入、WS 回归和 Checkpoint B 状态。
- T8：规格验收、所有证据摘要、最终 Worker、CHANGELOG 顶部和版本合同。

发现需要改变公开接口、frame/message 边界、配置、依赖、最大消息限制、XHTTP 运行逻辑或部署流程时，停止并请求新决策。

## 开放问题

无材料性开放问题。上述趋势与尾部窗口算法已在本计划中具体化；本计划不授权执行，下一步需显式调用 `@uxu-code:build` 或 `@uxu-code:build auto`。
