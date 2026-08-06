# Tasks: WS 与 gRPC 稳态基准 v2 与协议专属候选

## 已完成前置事实

- [x] 用户通过 `@uxu-code:plan` 批准 2026-08-02 修订规格进入规划。
- [x] 第一轮 plan/todo 已原样归档到 `work-products/specs/ws-grpc-first-pass.completed.*.md`。
- [x] v1 baseline 为 `INCONCLUSIVE`，SHA-256 固定为 `3321f9c2e38ebbdbcee7a46ef6af86e65894106cf24bc52800a20c059f27afb9`。
- [x] XHTTP 运行逻辑与 Cloudflare/真实客户端操作不在本轮自动执行范围。

## Phase 1：测量合同 v2

- [x] T1 固化三样本中位数校准、5 轮稳态窗口、7 轮正式尾部窗口、趋势公式、重校准与轮数上限；目标测试和全量门禁通过（v2.4.25）。
- [x] T2 实现每 profile 独立 child、run 1 正序/run 2 反序、schema v2、环境指纹、当前 child 回收和原子终态证据；审查回归与连续两次全量门禁通过（v2.4.27），未改协议运行逻辑。
- [ ] T3 运行一次双 run 完整矩阵，写 `ws-grpc-baseline-v2.json`；只在全部门通过时冻结，否则保留一次 `INCONCLUSIVE` 并停止候选。

## Checkpoint A：运行时候选入口

- [x] A1 T1/T2 合同、目标测试和全量本地门禁通过。
- [ ] A2 v2 baseline 的全部 32 profiles 完成独立 child、稳态和正式选中窗口。
- [ ] A3 每个决策 profile CPU CV/trend 与跨 run CPU 中位数差均 `<= 10%`，环境和五类哈希一致。
- [ ] A4 v1 baseline SHA 未变，无遗留 child、半成品、敏感数据或协议运行逻辑 diff。

若 A1—A4 任一失败：T4—T7 标记 `GATE-SKIPPED`，直接进入 T8；不得自动加 run、放宽门槛或挑最佳窗口。

## Phase 2：gRPC 独立候选

- [ ] T4 创建 gRPC 分片/差分/生命周期合同并评估增量 parser；两个 A/B pair 未全部达门则回滚业务代码并记录 NO-GO。
- [ ] T5 评估 gRPC 已建连上行高低水位；保持顺序、硬上限、尾部 drain 和单次重试，未达门则独立回滚。
- [ ] T6 先通过源缓冲污染测试，再评估 gRPC 下行 Grain 缓冲复用；安全或性能门失败即移除复用声明。

## Checkpoint B：gRPC 独立结论

- [ ] B1 T4/T5/T6 各自为可复现 GO，或业务代码已回滚且有可重算 NO-GO。
- [ ] B2 所有保留候选的字节、顺序、生命周期、CPU、wall、复制/分配和排队门通过。
- [ ] B3 XHTTP、WS、链式代理和全量回归通过，最终 Worker 与证据链一致。

## Phase 3：WS 独立候选

- [ ] T7 只评估 VLESS/Trojan 已建连 TCP 上行水位；不改 Early Data、SS、UDP、下行 frame 或 `binaryType`，未达门则回滚并记录 NO-GO。

## Phase 4：闭环

- [ ] T8 归档第一轮最终判定，更新 plan/todo 与最终本地结论，核对证据/哈希/最终 Worker/敏感字段并完成版本与全量门禁。

## 执行规则

- 本计划不等于实施授权；只接受后续公开入口 `@uxu-code:build` 或 `@uxu-code:build auto`。
- T1—T3 前禁止运行时候选；Checkpoint A 未全绿时 T4—T7 必须 gate-skipped。
- 每个候选使用 plan 固定的主/支撑/非目标 profile 和两个 A/B pair，禁止运行后改判定集合。
- GO 最终 Worker 必须精确对应 candidate；NO-GO 最终 Worker 必须精确恢复 predecessor，同时保留通用测试与证据。
- 每个完成任务按当前顶部版本递增补丁，同步 `CHANGELOG`、Worker Version 和版本断言。
- 不运行 Wrangler、不部署 Cloudflare、不把 Node CPU 数字表述为 Workers 生产证明。

## 当前状态

T1 已发布为 v2.4.25；T2 经审查修复四项 fail-closed 缺口后以 v2.4.27 完成，32/32 目标测试及最终代码状态连续两次 134/134 全量套件通过。T3 尚未执行，Checkpoint A 的 A2—A4 继续关闭；WS/gRPC/XHTTP 运行逻辑未因本轮测量工作改变。
