# Tasks: WS 与 gRPC CPU 证据门与协议专属优化

## 已完成前置事实

- [x] WS `binaryType` 已在 `accept()` 前设置并有回归覆盖；不计入本轮性能收益。
- [x] WS/gRPC benchmark/profile 骨架已存在；当前校准、进程与复制指标合同仍不可用于决策。
- [x] 修订 SPEC 已获准进入规划；XHTTP 本轮运行逻辑冻结。

## Phase 1：测量基础

- [x] T1 建立 `1500–3500 ms` 分阶段校准、资源上限、单 child 收敛和原子证据写入；不改协议运行逻辑。
- [x] T2 分离 `sourceBytes`、真实 `copiedBytes`、`copyOperations`、`allocatedBytes`、writes/sends/peak queue；正式模式自动校准完整矩阵，`--profile` 仅诊断。
- [x] T3 已生成两个独立完整矩阵 run；环境与四类哈希一致，但两个 run 均含 limited profile，记录 INCONCLUSIVE 并停止候选。

## Checkpoint A：运行时候选入口

- [x] A1 T1/T2 合同与全量本地门禁通过。
- [ ] A2 未通过：baseline 为 INCONCLUSIVE，未冻结。
- [x] A3 四类哈希一致且无遗留 child/半成品证据。
- [x] A4 `_worker.js` 除版本外尚无本轮性能修改，XHTTP 运行逻辑不变。

## Phase 2：gRPC 独立候选

- [x] T4 SKIPPED：T3 INCONCLUSIVE，未运行 gRPC 增量解析候选。
- [x] T5 SKIPPED：Checkpoint A 关闭，未运行 gRPC 已建连上行水位候选。
- [x] T6 SKIPPED：Checkpoint A 关闭，未运行 gRPC 下行缓冲复用候选。

## Checkpoint B：gRPC 独立结论

- [x] B1 不适用：T4/T5/T6 均被 Checkpoint A fail-closed 跳过。
- [x] B2 不适用：没有保留的运行时候选。
- [x] B3 XHTTP、WS、链式代理与全量回归通过，INCONCLUSIVE 证据可由原始轮次重算。

## Phase 3：WS 独立候选

- [x] T7 SKIPPED：Checkpoint A 关闭，未运行 WS 已建连上行水位候选。

## Phase 4：闭环

- [x] T8 保持批准版 SPEC 不变，按真实 INCONCLUSIVE 更新 plan/todo，核对证据与最终 Worker，完成版本和全量本地门禁。

## Checkpoint C：最终本地交付

- [x] C1 规格 12 项验收均有明确证据或用户控制边界。
- [x] C2 不适用：Checkpoint A 关闭，未生成或运行候选。
- [x] C3 版本三处一致，历史 CHANGELOG 未改写，测试路径/证据跟踪/敏感字段合同通过。
- [x] C4 Cloudflare、真实 WS/gRPC 客户端和 WS 下行直通未自动执行，明确生产未验证。

## 执行规则

- 用户已用 `@uxu-code:build auto` 批准连续执行；每项仍须独立验证、发布和回滚。
- 每个候选的主/支撑/非目标 profile 使用 plan 固定表，`pairId=1/2` 逐 pair 判定，禁止运行后挑选。
- T1—T3 未打开 Checkpoint A 前禁止运行时候选；T3 INCONCLUSIVE 时跳过 T4—T7，仅进入测量闭环。
- T4—T7 每次先预留同一补丁 Version，再记录直接前序与候选各两个完整 run；GO 最终 SHA 等于 candidate，NO-GO 最终 SHA 等于 predecessor，任一合同失败即回滚业务代码。
- 候选 NO-GO 仍是完成的证据交付：保留通用回归、NO-GO JSON 和准确发布元数据，只移除候选逻辑与专属断言。
- 不运行 Wrangler、不部署 Cloudflare、不把 Node CPU 数字表述为 Workers 生产证明。

## 当前状态

T8 已完成：本地结论为 INCONCLUSIVE，Checkpoint A 关闭，T4—T7 已跳过；v2.4.22 证据、状态、版本和全量本地门禁闭环完成。
