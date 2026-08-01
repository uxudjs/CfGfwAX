# Implementation Plan: 连接场景预设与自定义

## 规划依据

依据已批准的 `work-products/SPEC.md`。规格已经明确目标用户、五个选项、四组精确数值、交互行为、配置兼容、非目标、测试策略和验收标准，开放问题为零，足以进入实施计划。

本计划不授权自适应策略、应用域名识别、KV 自动改写、Worker 连接逻辑变更或 Cloudflare 部署。

## 目标与边界

在 `../../CGAX-Pages/admin/index.html` 的“连接竞速与保活”区域增加场景下拉框，使用户能把已批准预设填入现有四项设置，并在手动修改时可靠切换为“自定义”。继续保存现有 `连接设置` 四字段，不持久化预设 ID，不改变 Worker API、默认值或运行行为。

## 关键决策

- **UI 映射而非新配置字段**：预设 ID 不进入 KV，避免前后端协议和迁移成本。
- **精确匹配而非近似匹配**：四项值完全相等才显示预设，其他组合均为 `custom`。
- **单文件实现**：沿用 CGAX-Pages 的自包含 HTML/CSS/JavaScript，不增加依赖或抽象层。
- **既有测试扩展**：只扩展 `../../CGAX-Pages/work-products/tests/connection-settings.test.mjs`；该测试继续从最终位置以 `../../admin/index.html` 引用产品文件。
- **静态合同 + 手工交互**：Node 回归覆盖源码合同，浏览器检查覆盖 DOM 状态、键盘操作、响应式和控制台。
- **顺序实施**：测试、UI、文档/发布共享同一合同，不并行修改。

## 依赖图

```text
已批准 SPEC
  → Task 1：连接预设 RED 合同
    → Task 2：管理页完整交互
      → Checkpoint A：前端功能与视觉
        → Task 3：三语文档与发布同步
          → Checkpoint B：两仓库最终验收
```

## Task 1：建立连接预设前端 RED 合同

**描述**

扩展现有管理页源码回归，先证明五个选项、精确映射、推断/填充入口、限制说明和自定义保值行为尚未实现。不得修改 `admin/index.html`。

**范围**

- 修改 `../../CGAX-Pages/work-products/tests/connection-settings.test.mjs`。
- 保留现有四项控件、最小值、checkbox 宽度和保存合同断言。
- 新增断言覆盖：
  - `balanced`、`long_lived`、`weak_network`、`resource_saver`、`custom` 五项；
  - 四个预设的精确数值；
  - 选择预设、读取当前值、精确推断和手动修改同步入口；
  - `custom` 分支不写四项值；
  - 环境变量优先、仅新连接生效、吞吐边界和 XHTTP 限制说明。

**验收标准**

- [ ] 新断言在现有页面上失败，且失败原因只指向预设功能缺失。
- [ ] 既有三组连接设置断言仍通过。
- [ ] 测试仍使用 `new URL('../../admin/index.html', import.meta.url)`，不出现机器绝对路径。

**验证**

从 `CGAX-Pages` 运行：

```powershell
node --test work-products/tests/connection-settings.test.mjs
```

预期：新增断言 RED，既有断言不回退。保存完整失败输出作为本任务 RED 证据。

**依赖**：无。

**可能修改文件**

- `../../CGAX-Pages/work-products/tests/connection-settings.test.mjs`

**规模**：S，1 个文件。

**回滚**

只移除本任务新增断言，恢复原测试文件；不触碰产品页面。

## Task 2：实现管理页预设与自定义完整交互

**描述**

在现有“连接竞速与保活”区域加入下拉框和紧邻说明，使用一个不可变预设对象及小型读、写、推断函数打通加载、选择、手动编辑、取消修改和保存后刷新。

**范围**

- 修改 `../../CGAX-Pages/admin/index.html`。
- 在四项控件前增加带可见 `<label>` 的原生 `<select>` 及说明区域。
- 实现以下最小职责：
  - 读取当前四项表单值；
  - 用精确四字段匹配推断预设或 `custom`；
  - 选择非 `custom` 时填入四项值并调用 `markModified('proxy')`；
  - 选择 `custom` 时只更新选择状态，不写入四项控件；
  - 手动修改任一现有控件时重新推断并标记修改；
  - `applyProxyConfigToForm()` 回填四项后同步推断选择状态。
- 固定显示四条限制说明：环境变量优先、仅新连接生效、竞速不等于视频吞吐、XHTTP 不使用该保活定时器。
- 保留现有整数/最小值校验、`currentConfig.连接设置` 形状及 checkbox 固定宽度。

**验收标准**

- [ ] 四个预设分别填入 SPEC 中的精确值。
- [ ] `custom` 不修改现值；非预设组合显示 `custom`；改回精确组合恢复对应预设。
- [ ] 加载、取消修改和保存后刷新均根据四项值推断，不持久化预设 ID。
- [ ] 既有保存、校验、ProxyIP 和显式代理设置不受影响。
- [ ] 页面无新增依赖、弹窗、卡片或 Worker API 调用。

**验证**

从 `CGAX-Pages` 运行：

```powershell
node --test work-products/tests/connection-settings.test.mjs work-products/tests/frontend-performance.test.mjs
git -c safe.directory='C:/Users/brand/SynologyDrive/Code/CGAX-Pages' diff --check
```

**依赖**：Task 1。

**可能修改文件**

- `../../CGAX-Pages/admin/index.html`

**规模**：S，1 个文件。

**回滚**

移除预设 markup、常量与辅助函数；恢复四项控件原 `onchange="markModified('proxy')"`，保持既有四字段保存逻辑。

## Checkpoint A：前端功能与视觉

- [ ] Task 1 的 RED 已转为 GREEN，原有连接设置与前端性能回归通过。
- [ ] 使用 `python -m http.server 8000 --directory ../CGAX-Pages` 预览 `/admin/`。
- [ ] 依次选择四个预设并核对值、说明、修改状态和 `custom` 保值行为。
- [ ] 保存、刷新、取消修改后推断一致。
- [ ] 键盘可聚焦、展开、选择和保存；控制台无新增错误。
- [ ] 在 320、768、1024、1440 px 检查换行、控件尺寸和横向溢出。
- [ ] 烟测 `/login/`、`/noADMIN/`、`/noKV/`，确认静态路径未受影响。
- [ ] 为 PR 保留管理页桌面与移动端前后对比截图；过程截图只放在 `../../CGAX-Pages/work-products/debug/`。

未通过 Checkpoint A 不得进入文档和发布同步。

## Task 3：同步三语文档与跨仓库发布合同

**描述**

在前端行为通过后，更新 CfGfwAX 三语说明与发布元数据。文档只描述已实际实现的预设 UI，不宣称视频吞吐加速、自动识别或生产效果。

**范围**

- 修改 `README.md` 的简体中文、繁体中文和英文连接设置段落，保持三种语言语义一致。
- 按实际当前版本执行下一语义化补丁发布：
  - 在 `CHANGELOG` 顶部新增独立版本节，仅使用允许的 `### ADD` 或 `### Change`；
  - 更新 `_worker.js` 的 `const Version`；
  - 更新 `work-products/tests/chain_proxy.test.mjs` 的版本断言。
- CHANGELOG 明确：新增场景预设与自定义、现有四字段/API 不变、不包含自动模式。
- 保留所有既有发布节和用户未提交变更，不复用历史版本标题。

**验收标准**

- [ ] 三语说明覆盖五项选择、环境变量优先、仅新连接生效、XHTTP 限制和非吞吐承诺。
- [ ] Worker、CHANGELOG 顶部和版本断言完全一致，且为实际当前版本的下一补丁版本。
- [ ] CHANGELOG 只使用管理页允许的三级标题，旧版本节原文不变。
- [ ] 未增加 Worker 运行逻辑、配置字段或部署命令。

**验证**

从 `CfGfwAX` 运行：

```powershell
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git -c safe.directory='C:/Users/brand/SynologyDrive/Code/CfGfwAX' diff --check
```

从 `CGAX-Pages` 重跑：

```powershell
node --test work-products/tests/connection-settings.test.mjs work-products/tests/frontend-performance.test.mjs
git -c safe.directory='C:/Users/brand/SynologyDrive/Code/CGAX-Pages' diff --check
```

**依赖**：Task 2 与 Checkpoint A。

**可能修改文件**

- `README.md`
- `CHANGELOG`
- `_worker.js`
- `work-products/tests/chain_proxy.test.mjs`

**规模**：M，4 个文件。

**回滚**

将本任务新增的顶部发布节、版本值、版本断言和三语段落作为一个发布元数据补丁回退；不得改写更早版本节。

## Checkpoint B：最终验收

- [ ] SPEC 的 10 项验收标准逐项有证据。
- [ ] 两仓库目标测试、全量 Node 回归、语法和差异检查全部通过。
- [ ] 管理页桌面/移动端视觉及键盘交互通过，无新增控制台错误。
- [ ] Worker、CHANGELOG 和版本断言一致。
- [ ] 变更集仅包含本功能、计划发布元数据及实施前已有用户基线。
- [ ] CGAX-Pages 应先发布静态管理页；CfGfwAX 后续发布只同步版本与文档，不新增 Worker API。
- [ ] Cloudflare/GitHub Pages 发布和真实 Codex、视频、网页体验验证仍由用户控制，未执行时标记为生产未验证。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 预设覆盖自定义值 | 高 | `custom` 分支禁止写值；未知组合精确归类为 `custom` |
| 页面显示预设但 KV 值不一致 | 高 | 不保存预设 ID；显示状态始终由四项实际表单值推断 |
| 环境变量让管理页值未实际生效 | 中 | 固定显示环境变量优先提示，不声称显示运行有效值 |
| 新事件处理破坏修改/取消流程 | 中 | 复用 `markModified('proxy')` 和 `applyProxyConfigToForm()`，覆盖加载与取消检查 |
| 单文件页面布局回归 | 中 | 复用现有表单样式，保留 checkbox 回归，并做四断点视觉检查 |
| 文档夸大性能 | 中 | 明确只影响建连/保活，不承诺吞吐、断流或生产收益 |
| 两仓库发布错序 | 低 | 先发布 CGAX-Pages 静态页，再同步 CfGfwAX 发布元数据 |

## 上下文加载约定

- Task 1 只加载 SPEC 的预设、交互、测试段和现有 `connection-settings.test.mjs`。
- Task 2 只加载 Task 1 RED、`admin/index.html` 的连接设置 markup、`applyProxyConfigToForm()`、保存逻辑及相邻 select 模式。
- Task 3 只加载已验证 UI 行为、README 三语连接设置段、CHANGELOG 顶部和版本合同。
- 任一任务发现规格外接口、数值或范围决策时停止，不自行扩展。

## 开放问题

无。计划不引入新的产品或架构决策。
