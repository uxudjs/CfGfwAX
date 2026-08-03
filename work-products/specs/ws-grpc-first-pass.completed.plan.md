# Implementation Plan: WS 与 gRPC CPU 证据门与协议专属优化

## 状态

T3 已于 2026-08-02 生成两个独立完整矩阵 run，但 baseline 因 limited profile、高 CV 与跨 run 差超限判为 INCONCLUSIVE；Checkpoint A 关闭，T4—T7 按门禁跳过，当前执行 T8 测量闭环。授权不包含 Cloudflare 部署或真实客户端操作。

## 规划依据

- WS `binaryType` 顺序修复与 WS/gRPC benchmark 骨架是已完成前置事实，不再列为当前任务，也不计作本轮性能收益。
- 当前 benchmark 的一次探测、约 100 ms 目标、同步子进程、非原子写入和输入字节式 `copiedBytes` 不能支撑性能决策；baseline 尚未冻结。
- 候选顺序已由规格冻结：gRPC 增量解析、gRPC 已建连上行水位、gRPC 下行缓冲复用、WS 已建连上行水位。
- XHTTP 本轮只做回归；本地 Node CPU 只用于相同环境相对 A/B，Cloudflare 部署、日志和真实客户端验证由用户控制。
- 规格没有材料性开放问题，足以形成依赖有序、可验证、可回滚的任务。

## 关键决策

1. **先修测量，再动运行时**：Task 1—3 与 Checkpoint A 通过前，`_worker.js` 只允许发布版本元数据变化。
2. **计时与计数分离**：CPU/wall 原始轮次运行未插桩 Worker；复制、分配、写入、发送和排队指标以同一 profile 的独立计数轮次采集。
3. **正式与诊断分离**：正式 baseline/candidate 自动校准完整冻结矩阵并产生证据；`--profile` 只诊断、只输出标准输出，不写正式证据。
4. **单候选单机制**：四个候选串行，以任务开始时的直接前序 Worker 做两组独立 A/B；NO-GO 只回滚候选业务代码，保留证据和通用回归。
5. **XHTTP 隔离**：不恢复原生 `pipeTo`，不把 Node `9.980198 ms` 当作 Workers CPU 余量；公共 helper 修改必须运行 XHTTP 回归。
6. **发布不污染 A/B**：每个候选在 predecessor 测量前先把 `_worker.js` Version 与版本断言预留为本任务补丁版本，predecessor/candidate 全程保持该 Version；GO 最终 Worker 必须精确匹配 candidate SHA，NO-GO 最终 Worker 必须精确匹配 predecessor SHA，最后再写入准确 CHANGELOG。

## 依赖图

```text
批准修订 SPEC
  -> T1 分阶段校准、时限与子进程收敛
      -> T2 真实热路径计量与正式证据合同
          -> T3 双运行完整矩阵 baseline
              -> Checkpoint A
                  -> T4 gRPC 增量解析
                      -> T5 gRPC 上行水位
                          -> T6 gRPC 下行缓冲复用
                              -> Checkpoint B
                                  -> T7 WS 上行水位
                                      -> T8 证据闭环与最终门禁
```

性能任务必须串行，因为它们共享 `_worker.js`，且每项都依赖直接前序状态。

## 共用完成标准

- schema 必须从原始轮次重算状态与 decision，不信任可覆写摘要。
- 冻结矩阵精确为 32 个 profile：WS/gRPC × 上传/下载/双向 × 64 B/256 B/1 KiB/16 KiB/64 KiB 共 30 个，加 `grpc-upload-fragmented-64b` 与 `grpc-upload-multiframe-256b`；`grpc-upload-64b` 同时覆盖大量小帧。缺失、重复、额外或改名均拒绝正式证据。
- 每个正式 run 的全部冻结 profile 均 ready、CPU CV `<= 10%`；同阶段两次 run 的 CPU 中位数相对差 `<= 10%`，环境及四类哈希一致。
- 每个候选固定 `pairId=1/2`，predecessor/candidate 各两个全局唯一 run ID；每个 pair 单独比较且环境、Version、benchmark/fixture/profile schema 哈希必须一致。任一 pair 漂移或失败即拒绝 GO，并以回滚业务代码后的 NO-GO 完成任务。
- 候选两个 A/B pair 的固定主 profile CPU 中位数均至少下降 `10%`；固定非目标 CPU 与全部 profile wall time不得回退超过 `5%`。
- 字节、顺序、帧、关闭、取消、重试、队列上限或证据完整性任一失败，baseline 为 INCONCLUSIVE，候选为回滚业务代码后的 NO-GO。
- 新测试仅位于 `work-products/tests/`，以最终位置相对路径引用产品文件；证据不得含域名、URL、UUID、凭据或真实流量。
- 每项完成时同步下一补丁版本的顶部 `CHANGELOG`、`_worker.js` Version 和版本断言；候选任务在 predecessor 前预留同一 Version，历史 CHANGELOG 不改写。
- 每项至少通过目标测试、`node --test`、`node --check _worker.js`、CHANGELOG 标题测试和 `git diff --check`；不运行 Wrangler 或部署。

固定候选判定矩阵：

| 候选 | 主 profile | 支撑 profile | 固定非目标 |
| --- | --- | --- | --- |
| gRPC parser | `grpc-upload-fragmented-64b` | `grpc-upload-multiframe-256b` | gRPC 上传/双向的 1 KiB、16 KiB、64 KiB及全部 gRPC 下载 |
| gRPC uplink | `grpc-bidirectional-64b` | `grpc-upload-64b` | gRPC 上传/双向的 1 KiB、16 KiB、64 KiB及全部 gRPC 下载 |
| gRPC buffer reuse | `grpc-bidirectional-64b` | `grpc-download-64b` | gRPC 下载/双向的 1 KiB、16 KiB、64 KiB及全部 gRPC 上传 |
| WS uplink | `ws-bidirectional-64b` | `ws-upload-64b` | WS 上传/双向的 1 KiB、16 KiB、64 KiB及全部 WS 下载 |

## Task 1：建立有界分阶段校准与进程收敛

**范围**

- 把单探测放大改为分阶段校准：先按固定几何倍率放大，再按已测总 CPU 修正；正式原始轮次目标 `2000 ms`、接受窗口 `1500–3500 ms`。
- 以命名常量固定最大阶段、最大迭代、单 profile、单完整矩阵和父进程总时限；达到上限仍不入窗即 `limited`。
- 父进程最多一个并发 child；成功、失败、超时、取消均回收。正式证据以同目录临时文件原子替换，失败不留半成品、不覆盖完整证据。

**验收标准**

- [x] 测试覆盖几何阶段、测量修正、上下界、`limited`、校准轨迹与窗口判定；原始轮次同时保留总 CPU 和每迭代 CPU。
- [x] 伪 child 覆盖成功/失败/超时/取消，证明无遗留进程、并发数不超过 1、失败不写坏证据。
- [x] 短合成 fixture 完成目标测试；本任务不改协议运行逻辑。

**验证**

```powershell
node --test work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --help
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：修订 SPEC 已批准。

**可能修改**：`work-products/benchmarks/ws_grpc_stream_benchmark.mjs`、`work-products/tests/ws_grpc_stream_benchmark.test.mjs`、`_worker.js`（仅版本）、`CHANGELOG`、`work-products/tests/chain_proxy.test.mjs`。

**规模**：M，5 个文件。

**回滚**：回退校准/进程合同与发布元数据；保留 benchmark 骨架和 WS 兼容修复。

## Task 2：建立真实 Worker 热路径计量与正式证据合同

**范围**

- `sourceBytes` 表示 fixture 输入量（上传/下载各 1 MiB，双向 2 MiB）；`copiedBytes` 只计 Worker 显式目标缓冲复制，并分别记录 `copyOperations`、协议临时/输出 `allocatedBytes`、writes、sends、`peakQueuedBytes`。
- fail-closed 插桩覆盖 gRPC pending 合并/剩余切片/封帧、WS/gRPC TCP 写入、下行 Grain 与发送路径；插桩点数量或源码形状漂移即拒绝。CPU/wall 使用未插桩 Worker，计数独立运行。
- 正式 baseline/candidate 自动校准完整矩阵；删除 `--calibrate`。禁止 `--profile` 与正式 output/evidence/decision 组合；schema 精确锁定上述 32 项 manifest，并记录轨迹、原始轮次、环境、四类哈希和指标定义版本。

**验收标准**

- [x] fixture 精确区分 source/copy/allocation；1 MiB gRPC download 复制量不得退化成帧头级数值，摘要、指标、哈希或插桩篡改均被拒绝。
- [x] 单 profile、`limited`、高 CV、跨 run 差超限、缺失指标或环境/哈希漂移不能产生正式 GO。
- [x] 合同测试使用相对路径和合成数据，敏感字段扫描通过；本任务不改协议运行逻辑。

**验证**

```powershell
node --test work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --profile grpc-download-64b
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --help
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Task 1。

**可能修改**：`work-products/benchmarks/ws_grpc_stream_benchmark.mjs`、`work-products/tests/ws_grpc_stream_benchmark.test.mjs`、`_worker.js`（仅版本）、`CHANGELOG`、`work-products/tests/chain_proxy.test.mjs`。

**规模**：M，5 个文件。

**回滚**：回退指标/schema/CLI 合同与发布元数据；不得恢复用输入 chunk 长度冒充复制量。

## Task 3：生成并冻结双运行完整矩阵 baseline

**范围**

- 先预留本任务补丁 Version，再在相同环境和四类哈希下执行两个独立完整矩阵 run，原子生成 `work-products/debug/ws-grpc-baseline.json`；最终交付 Worker SHA 必须与 evidence 精确一致。
- `.gitignore` 只精确放行 baseline、四个候选证据与最终判定文件，不放开整个 debug 目录。
- 任一 profile limited、CV/跨 run 差超限、超时、哈希漂移、指标缺失或遗留 child 时保存完整 INCONCLUSIVE 并关闭 Checkpoint A；全部通过才写 `baselineStatus: frozen`。

**验收标准**

- [x] 证据明确为 INCONCLUSIVE 并阻止候选；两个 run 均有 limited profile，最大 CV 35.8509%，4 个 profile 跨 run 差超过 10%。
- [x] JSON 含轨迹、原始轮次、真实计数、环境/哈希、唯一 run ID 和敏感字段检查，schema 可重建状态。
- [x] 未记录 WS 下行直通结论，未修改 `_worker.js` 业务逻辑。

**验证**

```powershell
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --runs 2 --output work-products/debug/ws-grpc-baseline.json
node --test work-products/tests/ws_grpc_stream_benchmark.test.mjs
git check-ignore -v work-products/debug/ws-grpc-baseline.json
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Task 2。

**可能修改**：`work-products/debug/ws-grpc-baseline.json`、`.gitignore`、`_worker.js`（仅版本）、`CHANGELOG`、`work-products/tests/chain_proxy.test.mjs`。

**规模**：M，5 个文件。

**回滚**：回退 allow 规则、证据和发布元数据；保留测量工具。INCONCLUSIVE 不得被绕过。

## Checkpoint A：运行时候选入口

- [x] Task 1/2 合同及全量门禁通过。
- [ ] Task 3 为 `baselineStatus: frozen`：未通过，实际为 INCONCLUSIVE。
- [x] Worker、benchmark、fixture、profile schema 与 baseline 哈希一致。
- [x] `_worker.js` 除版本外尚无本轮性能修改，XHTTP 运行逻辑不变。

**结果**：Checkpoint A CLOSED；Task 4—7 均为 SKIPPED，不得运行候选。

## Task 4：评估 gRPC 增量帧解析候选

**范围**

- 新增 `grpc_stream.test.mjs`，差分覆盖 1/2/3/4 字节帧头、跨块帧体、单块多帧、空消息、连续 64 B、EOF/取消/错误和 payload 顺序。
- 仅改为游标与最小尾部状态，消除每块合并全部 pending 和每帧复制全部剩余数据；不新增消息上限、压缩、校验或协议行为。
- 先预留本任务补丁 Version并保存 `pairId=1/2` 的直接前序完整 run，再保持同一 Version只加入 parser并保存对应 candidate run；按固定 profile、逐 pair 字节差分和共用性能门生成 `ws-grpc-candidate-grpc-parser.json`。

**验收标准**

- [ ] 正常/异常 fixture 的 payload、顺序、错误和收敛与直接前序一致。
- [ ] 重复复制确实下降，且无无法解释的分配、写入、发送或排队增长；两个 A/B pair 同向通过才 GO。
- [ ] 未达门则回滚 parser 业务代码并保留 NO-GO；XHTTP、WS、UDP、代理握手回归通过。

**验证**

```powershell
node --test work-products/tests/grpc_stream.test.mjs work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-parser --phase predecessor --runs 2 --output work-products/debug/ws-grpc-candidate-grpc-parser.json
# 加入 parser 并通过功能回归后：
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-parser --phase candidate --runs 2 --evidence work-products/debug/ws-grpc-candidate-grpc-parser.json
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Checkpoint A。

**可能修改**：`_worker.js`、`work-products/tests/grpc_stream.test.mjs`、`work-products/debug/ws-grpc-candidate-grpc-parser.json`、`CHANGELOG`、`work-products/tests/chain_proxy.test.mjs`。

**规模**：M，5 个文件。

**回滚**：只移除 parser helper/接线和专属断言；保留通用差分测试、NO-GO 证据和发布元数据。

## Task 5：评估 gRPC 已建连上行水位候选

**范围**

- 仅在已建连 TCP 主链路比较逐帧等待与“小块同步入队、高水位等待低水位、大块直接等待”。
- 保持顺序、16 MiB/4096 条硬上限和单次重试；正常 EOF drain，取消/解析失败/overflow/最终 writer 失败 abort，in-flight write 返回后不得继续连接或写入。
- 预留同一补丁 Version，相对 Task 4 实际交付状态按 `pairId=1/2` 完成两组完整矩阵 A/B，生成 `ws-grpc-candidate-grpc-uplink.json`；不改 UDP 或首包解析。

**验收标准**

- [ ] 小消息严格按序且 writes 下降，水位、峰值排队与硬上限可重复验证。
- [ ] EOF 尾部写完；异常路径有限时间收敛，无重复/丢失 payload 或未处理拒绝。
- [ ] 两个 A/B pair 通过才 GO；否则回滚本候选并保留 NO-GO 与前序结论。

**验证**

```powershell
node --test work-products/tests/grpc_stream.test.mjs work-products/tests/xhttp_stream_uplink.test.mjs work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-uplink-watermark --phase predecessor --runs 2 --output work-products/debug/ws-grpc-candidate-grpc-uplink.json
# 加入水位候选并通过功能回归后：
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-uplink-watermark --phase candidate --runs 2 --evidence work-products/debug/ws-grpc-candidate-grpc-uplink.json
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Task 4；其 NO-GO 时以回滚后的 Worker 为直接前序。

**可能修改**：`_worker.js`、`work-products/tests/grpc_stream.test.mjs`、`work-products/debug/ws-grpc-candidate-grpc-uplink.json`、`CHANGELOG`、`work-products/tests/chain_proxy.test.mjs`。

**规模**：M，5 个文件。

**回滚**：只回退 gRPC 水位策略和专属断言；保留生命周期测试、NO-GO 证据、发布元数据及前序结论。

## Task 6：评估 gRPC 下行安全缓冲复用候选

**范围**

- 发送 Grain 源缓冲后立即改写，证明 `grpcBridge.send()` 同步复制到独立 frame 后才允许复用。
- 只改变 gRPC bridge/Grain 复用标记，不融合编码器、不扩展到 WS/XHTTP、不改变空保活、响应头、关闭或 frame 字节。
- 预留同一补丁 Version，相对 Task 5 实际状态按 `pairId=1/2` 完成两组完整矩阵 A/B，生成 `ws-grpc-candidate-grpc-buffer-reuse.json`。

**验收标准**

- [ ] 污染源缓冲后已排队响应仍与直接前序一致，WS/XHTTP 复用语义不变。
- [ ] 目标复制/分配下降且 CPU 达门，无发送、排队或 wall 超限；两个 A/B pair 通过才 GO。
- [ ] 任一安全或性能门失败即移除复用声明并保留 NO-GO，不回退前序结论。

**验证**

```powershell
node --test work-products/tests/grpc_stream.test.mjs work-products/tests/xhttp_stream_downlink.test.mjs work-products/tests/xhttp_stream_direct_downlink.test.mjs work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-buffer-reuse --phase predecessor --runs 2 --output work-products/debug/ws-grpc-candidate-grpc-buffer-reuse.json
# 加入复用候选并通过功能回归后：
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate grpc-buffer-reuse --phase candidate --runs 2 --evidence work-products/debug/ws-grpc-candidate-grpc-buffer-reuse.json
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Task 5；其 NO-GO 时以回滚后的 Worker 为直接前序。

**可能修改**：`_worker.js`、`work-products/tests/grpc_stream.test.mjs`、`work-products/debug/ws-grpc-candidate-grpc-buffer-reuse.json`、`CHANGELOG`、`work-products/tests/chain_proxy.test.mjs`。

**规模**：M，5 个文件。

**回滚**：只移除 gRPC 复用声明和专属断言；保留污染测试、NO-GO 证据、发布元数据与前序结论。

## Checkpoint B：gRPC 独立结论

- [ ] Task 4/5/6 各自为可复现 GO 或业务代码已回滚的 NO-GO。
- [ ] 所有保留候选的字节、顺序、生命周期、CPU、wall、复制/分配和排队门通过。
- [ ] XHTTP、WS、链式代理与全量回归通过，证据可由原始轮次重算。

## Task 7：评估 WS 已建连上行水位候选

**范围**

- 只在 VLESS/Trojan TCP 已建连路径评估水位策略；不改变 Early Data、Shadowsocks、UDP 或下行 frame 边界。
- 保持消息任务顺序、16 MiB/4096 条硬上限和单次重试；正常 close drain，error/cancel/overflow/最终 writer 失败 abort，in-flight write 返回后不得继续连接或写入。
- 预留同一补丁 Version，相对 Checkpoint B 的 Worker 按 `pairId=1/2` 完成两组完整矩阵 A/B，生成 `ws-grpc-candidate-ws-uplink.json`。

**验收标准**

- [ ] VLESS/Trojan 小消息按序且 writes 下降；首包、Early Data、SS、UDP 和下行 frame 策略不变。
- [ ] 水位、硬上限、close/error/cancel、重试和悬挂写入均有限收敛，无尾部丢失或未处理拒绝。
- [ ] 两个 A/B pair 通过才 GO；否则回滚 WS 水位候选并保留 NO-GO。

**验证**

```powershell
node --test work-products/tests/ws_transport.test.mjs work-products/tests/xhttp_stream_uplink.test.mjs work-products/tests/connection_settings.test.mjs work-products/tests/ws_grpc_stream_benchmark.test.mjs
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate ws-uplink-watermark --phase predecessor --runs 2 --output work-products/debug/ws-grpc-candidate-ws-uplink.json
# 加入 WS 水位候选并通过功能回归后：
node work-products/benchmarks/ws_grpc_stream_benchmark.mjs --candidate ws-uplink-watermark --phase candidate --runs 2 --evidence work-products/debug/ws-grpc-candidate-ws-uplink.json
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
```

**依赖**：Checkpoint B。

**可能修改**：`_worker.js`、`work-products/tests/ws_transport.test.mjs`、`work-products/debug/ws-grpc-candidate-ws-uplink.json`、`CHANGELOG`、`work-products/tests/chain_proxy.test.mjs`。

**规模**：M，5 个文件。

**回滚**：只移除 WS 水位策略和专属断言；保留生命周期测试、NO-GO 证据、发布元数据与 gRPC 结论。

## Task 8：闭环证据、状态与最终本地门禁

**范围**

- 保持批准版 SPEC 不变；按实际 baseline/GO/NO-GO/INCONCLUSIVE 更新 plan/todo，并写入 `work-products/debug/ws-grpc-final-decision.md`，核对原始轮次、轨迹、哈希、指标、敏感字段和最终 Worker 对应关系。
- 同步发布元数据并运行全量门禁；只报告 baseline frozen、本地候选 GO/NO-GO 或 INCONCLUSIVE。
- Cloudflare 部署、Workers 日志、真实客户端继续由用户控制；WS 下行直通若值得研究，另写规格。

**验收标准**

- [x] 八项任务与 checkpoint 状态和证据一致，INCONCLUSIVE 未写成优化成功。
- [x] 版本三处一致、历史 CHANGELOG 未改写、测试/证据正确跟踪且无敏感数据。
- [x] 全量 Node、语法、标题、差异检查通过；XHTTP 运行逻辑与生产未验证边界明确。

**验证**

```powershell
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs work-products/tests/ws_grpc_stream_benchmark.test.mjs
git diff --check
git status --short
```

**依赖**：Task 7 完成或 NO-GO；若 Task 3 INCONCLUSIVE，则跳过 Task 4—7，直接执行测量闭环。

**可能修改**：`work-products/plan.md`、`work-products/todo.md`、`work-products/debug/ws-grpc-final-decision.md`、`_worker.js`（仅版本）、`CHANGELOG`、`work-products/tests/chain_proxy.test.mjs`。

**规模**：M，6 个文件；唯一超过 5 个文件的状态闭环，不改业务逻辑，也不改批准版 SPEC。

**回滚**：只回退闭环状态与本任务发布元数据；不回退前序独立 GO。

## Checkpoint C：最终本地交付

- [x] 规格 12 项验收均有功能、INCONCLUSIVE 或用户控制边界证据。
- [x] 候选复现项不适用：Checkpoint A 关闭，未生成或运行任何候选。
- [x] 所有完成任务符合发布合同；未执行 Cloudflare/真实客户端操作。
- [x] 用户已用 `@uxu-code:build auto` 批准连续执行；仍须逐任务通过验证与 checkpoint。

## 上下文加载约定

- T1：规格校准/进程段、benchmark calibration/child/output 和目标测试。
- T2：规格指标段、WS/gRPC 热路径、Grain/上行队列和 benchmark schema/计数测试。
- T3：冻结门、正式 CLI、`.gitignore` debug 规则和 evidence schema。
- T4：gRPC 请求解析循环、parser profile、baseline 和 gRPC 差分测试。
- T5：gRPC 已建连写入、`创建上行写入队列()`、生命周期测试和直接前序证据。
- T6：`grpcBridge.send()`、Grain 发送器、污染测试和直接前序证据。
- T7：WS 消息任务链、已建连写入、水位 helper、WS 测试和直接前序证据。
- T8：规格验收、任务状态、证据摘要、CHANGELOG 顶部和版本合同。
- 若需改变公开接口、frame/message 边界、配置、依赖、最大消息限制或部署流程，立即停止并询问。

## 开放问题

无材料性实施问题。用户已批准 `auto` 连续执行；Checkpoint A 前保持所有运行时候选冻结。
