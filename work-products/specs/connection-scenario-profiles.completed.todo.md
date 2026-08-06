# Tasks: 连接场景紧凑交互修订

## Phase 1：RED 合同

- [x] T1.1 保留五项映射、四字段保存、最小值和 checkbox 现有回归。
- [x] T1.2 断言“使用场景”旁 `.inline-hint-btn`、可读名称和独立说明模态框。
- [x] T1.3 断言常驻说明移出主表单，模态框仍含当前场景说明和四条限制。
- [x] T1.4 断言四项控件位于 `connectionCustomSettings`，预设隐藏、`custom` 显示且不禁用。
- [x] T1.5 用最小 DOM 桩覆盖预设写值、`custom` 保值、编辑保持 `custom`、加载/取消推断和保存后不反推。
- [x] T1.6 运行目标测试并保存只对应本次缺口的 RED 证据。

## Phase 2：管理页实现

- [x] T2.1 用 `.label-with-hint` 和 `.inline-hint-btn` 重组场景标签，删除常驻说明及无用样式。
- [x] T2.2 用原生 `hidden` 容器包住现有四项控件，不改 ID、校验或保存读取。
- [x] T2.3 增加独立说明模态框、当前场景内容、四条限制和最小局部样式。
- [x] T2.4 增加容器可见性同步；预设写值并隐藏，`custom` 保值并显示。
- [x] T2.5 自定义编辑和保存保持 `custom`；加载、刷新和取消仍按保存值精确推断。
- [x] T2.6 实现遮罩、关闭按钮、Escape、Tab/Shift+Tab 焦点约束、焦点进入/返回和监听器清理。
- [x] T2.7 目标回归 GREEN，CGAX-Pages `git diff --check` 通过。

## Checkpoint A：前端验收

用户于 2026-08-01 明确排除浏览器预览并接受逻辑验证。下列项目保持未执行、未勾选，不阻塞 Phase 3，也不表述为视觉或真实浏览器验证。

- [ ] A1 四个预设只显示选择器和 `!`，隐藏容器不占空间。
- [ ] A2 `custom` 显示四项且保值；编辑到预设值也不自动收起。
- [ ] A3 保存当前会话、刷新和取消修改符合状态合同。
- [ ] A4 模态框内容随当前选择更新，四条限制完整。
- [ ] A5 Tab/Enter/Space/Escape、关闭按钮、遮罩和焦点返回通过。
- [ ] A6 320、768、1024、1440 px 无横向溢出或 checkbox 拉伸。
- [ ] A7 四条静态路径无新增控制台错误。
- [ ] A8 前后对比截图保存到 `../../../CGAX-Pages/work-products/debug/`；浏览器受阻时保持未完成。

## Phase 3：文档与发布

- [x] T3.1 同步 README 简体中文、繁体中文和英文的紧凑入口、`custom` 显示及适用边界。
- [x] T3.2 重新读取版本并在 CHANGELOG 顶部新增下一补丁节，不复用或改写历史标题。
- [x] T3.3 同步 `_worker.js` Version 与 `work-products/tests/chain_proxy.test.mjs` 断言，不改 Worker 运行逻辑。
- [x] T3.4 运行 CfGfwAX 全量 Node、语法、CHANGELOG 标题和差异检查。
- [x] T3.5 重跑 CGAX-Pages 连接设置、前端性能和差异检查。

## Checkpoint B：交付

- [x] B1 修订 SPEC 13 项验收标准逐项有逻辑、文档或明确排除证据。
- [x] B2 变更不含预设数值、API、Worker 连接逻辑、依赖或无关页面改动。
- [x] B3 三语文档、CHANGELOG、Version 和版本断言一致。
- [x] B4 保留 CGAX-Pages 先发布、CfGfwAX 后同步的顺序；不执行部署。
- [x] B5 未执行的 Cloudflare、Codex、视频和网页真实体验明确标记为生产未验证。

## 当前状态

Task 1 至 Task 3、审查修复及 Checkpoint B 已完成：CGAX-Pages 目标回归 15/15 通过，CfGfwAX 全量 Node、Worker 语法、CHANGELOG 标题与两仓库差异检查通过，v2.4.11 三处版本一致。浏览器预览由用户明确排除；部署和生产验证未执行。
