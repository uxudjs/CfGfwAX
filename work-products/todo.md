# Tasks: 剔除 Shadowsocks，收敛为 VLESS-only

## 规划与授权

- [x] 已批准 `work-products/SPEC.md` 中的两个决策：保留 VLESS 上游出口能力；实施版本为 `3.0.0`。
- [x] 已用 CodeGraph 核对 CfGfwAX、CGAX-Pages、BestCfCdn 的当前合同边界。
- [x] 旧 WS/gRPC 活动计划已保留为 `work-products/specs/ws-grpc-schema-v2-optimization.paused.*.md`。
- [x] 用户审阅并批准本计划。
- [x] 用户明确调用 `@uxu-code:build auto`；提交、推送、PR、部署仍未授权。

## Phase 1：Worker VLESS-only

- [x] T1 记录三仓工作树、版本合同与测试基线；不得清理既有改动。
- [x] T2 RED/GREEN：删除 Worker Shadowsocks 入站、AEAD、`enc` 选路和 SS Early Data 分支。
- [x] T3 RED/GREEN：默认/旧 KV/管理 API 固定 `协议类型: "vless"`，删除 `SS`，LINK 固定 `vless://`。
- [x] T4 RED/GREEN：明文、base64、订阅生成器与 API 合并边界仅保留 `vless://` URI，同时保留 IP 候选行。

## Checkpoint A：Worker 合同

- [x] 每个缺口都有可归因的 RED，并在同任务内转为 GREEN。
- [x] CfGfwAX 全量 Node 测试、Worker 语法和 diff 检查通过。
- [x] VLESS WS/gRPC/XHTTP、TCP、UDP/DNS、Early Data 与批准的上游出口能力保持通过。
- [x] 最终订阅中的完整节点 URI 只有 `vless://`。

## Phase 2：管理 UI 与发布合同

- [x] T5 RED/GREEN：CGAX-Pages 只显示/保存 VLESS，删除全部 SS 控件、弹窗、动态加载与保存逻辑。
- [ ] T5 本地 smoke：浏览器客户端拦截 `127.0.0.1`，未形成 `/admin/`、`/login/` 真实渲染证据；静态与自动化检查已通过。
- [x] T6 README 简中、繁中、英文同步为 VLESS-only，并说明旧 SS 节点失效且无自动转换。
- [x] T6 prepend `v3.0.0` CHANGELOG `### Delete`，同步 `_worker.js` Version 与版本断言。

## Checkpoint B：跨仓合同

- [x] CGAX-Pages 自动化与跨仓 Worker 回归通过。
- [x] `_worker.js`、CHANGELOG 顶部、`chain_proxy.test.mjs` 三点一致为 `3.0.1`。
- [x] BestCfCdn 未被本次实施修改。

## Phase 3：三仓本地门禁

- [x] T7 CfGfwAX：`node --test`、`node --check _worker.js`、CHANGELOG 标题、diff 检查通过。
- [x] T7 CGAX-Pages：`node --test`、跨仓 Worker 回归、静态 smoke、diff 检查通过。
- [x] T7 BestCfCdn：项目 `.venv` 下聚焦 `test_chain_proxy.py` 通过，且无本次新增差异。
- [x] 本次新增差异仅含批准文件，高信号 secret 扫描无命中；既有连接场景工作区改动原样保留。
- [x] 最终结论仅声明本地验证；提交、推送、部署、Cloudflare 与真实客户端验证保持未执行。

## 回滚准备

- [x] 审查后 RED/GREEN：管理 API 保存 `config.json` 仅写入一次，且持久化前完成 VLESS-only 归一化。
- [x] 基准不稳定 RED/GREEN：字节正确性测试显式关闭真实 CPU 稳态门禁并固定预热，正式基准默认行为不变。
- [x] 发布契约已同步到 `3.0.1`：Worker Version、CHANGELOG 顶部与版本回归断言一致。

- [x] 每个任务只反向应用任务自有文件差异，不使用 `reset`、`checkout` 或工作树清理。
- [ ] 未来部署前由用户备份 KV `config.json`；代码回滚不能自动恢复已经删除的 `SS` 字段。
- [ ] 若部署获授权，记录 UI 先、Worker 后的发布顺序；回滚时协调恢复 UI、Worker 与 KV 备份。
