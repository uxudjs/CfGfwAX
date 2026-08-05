# Implementation Plan: 连接场景紧凑交互修订

## 状态

实施与审查修复完成。Task 1 至 Task 3、焦点约束调试及 Checkpoint B 的逻辑、文档和本地发布合同均已通过；用户于 2026-08-01 明确排除浏览器预览并接受逻辑验证，因此 Checkpoint A 的视觉、真实键盘、四断点、控制台与截图项目未执行，但不阻塞本轮交付，且仍保持“未验证”边界。

## 规划依据

- 用户本轮显式调用 `@uxu-code:plan`，授权把当前 `work-products/SPEC.md` 的 2026-08-01 交互修订草案转换为实施计划；这不等于授权执行计划。
- 修订规格已明确目标、范围、交互状态、配置兼容、可访问性、测试策略、13 项验收标准、非目标和回滚边界，且没有材料性开放问题，足以规划，无需另建规格。
- 当前实现基线已经核对：
  - `../../CGAX-Pages/admin/index.html` 已有五个场景和四组精确映射；
  - `connectionProfileDescription` 与 `connectionProfileNotes` 常驻主表单；
  - 四项底层控件始终显示；
  - `handleConnectionSettingChange()` 会立即调用 `syncConnectionProfileSelection()`；
  - `saveProxy()` 保存后也会重新推断，无法保留显式 `custom` 会话状态；
  - UUID 的 `.label-with-hint`、`.inline-hint-btn` 和通用模态框样式可复用，但连接说明必须使用独立模态框和独立焦点/关闭逻辑。
- 当前发布基线为 v2.4.9。实施时若基线未变化，下一补丁版本为 v2.4.10；若期间已有新版本，必须重新读取并选择新的下一补丁版本，不能复用旧标题。

## 目标与边界

把管理页“连接竞速与保活”收敛为紧凑、可逆的表示层交互：预设模式只显示“使用场景”和 `!` 说明入口；只有 `custom` 显示四项底层控件。说明模态框每次打开都反映当前选择，隐藏字段继续参与校验和原接口保存。

不得改变：

- 五个稳定 ID、四组预设数值或精确匹配规则；
- `GET/POST /admin/config.json` 的字段、鉴权或状态码；
- 环境变量优先级、Worker 默认值和连接运行逻辑；
- `login/`、`noADMIN/`、`noKV/`、vendor/data 或其他无关页面；
- Cloudflare 部署流程。

## 关键状态合同

| 事件 | 选择状态 | 四项控件 | 四项值 |
| --- | --- | --- | --- |
| 加载、刷新、取消修改 | 按已保存四项值精确推断 | 仅 `custom` 显示 | 回填保存值 |
| 选择四个预设之一 | 保持所选预设 | 隐藏 | 写入该预设精确值 |
| 选择 `custom` | 保持 `custom` | 显示 | 不改写 |
| 编辑任一自定义控件 | 保持 `custom` | 显示 | 只改用户编辑项 |
| 自定义保存成功 | 本次会话保持 `custom` | 显示 | 保存现有四项值 |
| 后续刷新 | 重新精确推断 | 由推断结果决定 | 回填保存值 |

## 依赖顺序

```text
修订 SPEC + 当前实现基线
  -> Task 1：新增 RED 交互合同
    -> Task 2：实现紧凑 UI、状态与模态框
      -> Checkpoint A：前端自动化与手工验收
        -> Task 3：三语文档和发布合同同步
          -> Checkpoint B：两仓库最终门禁
```

## Task 1：建立交互修订 RED 合同

**范围**

只修改 `../../CGAX-Pages/work-products/tests/connection-settings.test.mjs`，不得修改产品页面。

在保留现有五项映射、配置保存、最小值和 checkbox 固定宽度断言的基础上，增加以下回归：

- “使用场景”标签使用 `.label-with-hint`，旁边存在 `.inline-hint-btn`、`title` 和 `aria-label="查看使用场景说明"`；
- 主表单不再包含常驻 `connectionProfileDescription`/`connectionProfileNotes`，独立说明模态框仍包含当前场景说明和四条共同限制；
- 模态框具有可读标题、对话框语义、关闭按钮、遮罩关闭、`Escape` 关闭和焦点返回合同；
- 四个现有控件完整位于一个自定义设置容器中，预设时 `hidden`，`custom` 时显示，且控件不使用 `disabled`；
- 选择 `custom` 不写值；选择预设先写四项精确值，再同步隐藏状态；
- 自定义编辑强制并保持 `custom`，即使数值刚好匹配预设也不自动收起；
- 加载和取消修改仍按值推断；保存后不重新推断当前显式 `custom` 会话；
- 既有保存对象继续读取隐藏控件并输出原四字段。

优先扩展当前 Node 测试：静态结构用源码断言，状态转换用最小 `document` 桩和函数提取执行，不引入 `jsdom`、包清单或新依赖。

**验收标准**

- [x] 新断言在当前页面上按预期失败，失败只对应本次交互修订缺失。
- [x] 现有五项映射、保存基线、最小值和 checkbox 回归仍通过。
- [x] 测试继续以 `new URL('../../admin/index.html', import.meta.url)` 引用产品文件，不含机器绝对路径。
- [x] RED 输出被记录为实施证据，不把预期失败表述为仓库回归通过。

**验证**

从 `CGAX-Pages` 运行：

```powershell
node --test work-products/tests/connection-settings.test.mjs
```

预期：新增合同 RED，既有合同无额外回退。

**依赖**：无。

**回滚**：仅撤销本任务新增测试，不触碰产品页面。

## Task 2：实现紧凑 UI、显式 custom 状态与说明模态框

**范围**

只修改 `../../CGAX-Pages/admin/index.html`，使 Task 1 转绿。

### 2.1 标记与样式

- 用 `.label-with-hint` 包裹“使用场景”标签和 `!` 按钮，复用 `.inline-hint-btn` 的现有视觉、深色模式和焦点样式。
- 删除主表单常驻说明段落与限制列表及其无用专属样式。
- 用一个 `connectionCustomSettings` 容器包住现有四项控件；只切换原生 `hidden`，不得禁用、清空、复制或改名控件。
- 新增独立“使用场景说明”模态框，复用现有 overlay/modal 视觉；提供 `role="dialog"`、`aria-modal="true"`、标题关联及有名称的关闭按钮。
- 只补充该模态框内容所需的最小局部样式，保持 320、768、1024、1440 px 无横向溢出。

### 2.2 状态函数

- 保留 `CONNECTION_PROFILES`、`readConnectionSettingsForm()` 和 `inferConnectionProfile()` 的精确映射。
- 增加一个小函数同步 `connectionCustomSettings.hidden`。
- 让加载/刷新/取消路径调用“按当前值推断 + 同步容器”；未知组合稳定为 `custom`。
- 选择非 `custom` 时写入预设值、同步隐藏状态并调用 `markModified('proxy')`。
- 选择 `custom` 时只显示容器，不改值、不反推、不凭空标记配置值变化。
- `handleConnectionSettingChange()` 只保持 `custom`、显示容器并标记修改，不再按数值反推预设。
- 保存后不调用会把显式 `custom` 改回预设的推断函数；刷新和取消仍通过 `applyProxyConfigToForm()` 重新推断。

### 2.3 模态框行为

- 每次打开时读取 `connectionProfile.value`，填入对应 UI 名称、说明和四条共同限制。
- 打开后把焦点移入模态框；`Tab` 与 `Shift+Tab` 循环约束在模态框内；关闭按钮、遮罩或 `Escape` 都可关闭，并把焦点返回场景 `!` 按钮。
- 关闭时移除本模态框的临时键盘监听，避免重复打开后累积监听器。
- 不复用 `authTokenHelpModal` 的内容切换状态，不改变 UUID/TOKEN/自定义优选现有行为。

**验收标准**

- [x] Task 1 的目标测试全部 GREEN。
- [x] 预设、`custom`、编辑、保存、刷新和取消符合关键状态合同。
- [x] 隐藏字段仍使用现有校验并进入 `currentConfig.连接设置` 四字段。
- [x] 无新增依赖、配置字段、Worker 运行改动或无关格式化。
- [x] 当前页面的其他模态框和代理设置不回退。

**验证**

从 `CGAX-Pages` 运行：

```powershell
node --test work-products/tests/connection-settings.test.mjs work-products/tests/frontend-performance.test.mjs
git -c safe.directory='C:/Users/brand/Code/CGAX-Pages' diff --check
```

**依赖**：Task 1 RED 证据。

**回滚**：把测试和 `admin/index.html` 作为同一前端修订补丁回退；不触碰已发布的预设映射或 Worker。

## Checkpoint A：前端功能、可访问性与视觉

排除说明：2026-08-01 用户明确表示“不用浏览器预览，逻辑无误即可”。以下运行时验收保持未执行、未勾选，不以源码测试冒充视觉或真实浏览器证据；该排除仅解除本轮 Task 3 的依赖，不扩大部署或生产验证范围。

- [ ] 四个预设只显示选择器和 `!`，不为隐藏容器保留高度。
- [ ] `custom` 显示四项控件且不改值；编辑到任一预设精确值时仍保持 `custom`。
- [ ] 保存当前会话、刷新和取消修改分别符合状态合同。
- [ ] `!` 每次显示当前场景说明及四条限制。
- [ ] Tab/Enter/Space/Escape、关闭按钮、遮罩和焦点返回可用。
- [ ] 320、768、1024、1440 px 无横向溢出或 checkbox 拉伸。
- [ ] `/login/`、`/admin/`、`/noADMIN/`、`/noKV/` 无新增控制台错误。
- [ ] 对比截图存放在 `../../CGAX-Pages/work-products/debug/`；若浏览器环境仍拦截本地地址，明确标记视觉门未完成，不以源码测试代替。

本轮经用户明确排除浏览器预览后，以自动化逻辑合同继续交付；未执行项不得表述为视觉或真实浏览器验证。

## Task 3：同步三语文档与补丁发布合同

**范围**

在 Checkpoint A 通过或用户明确排除浏览器预览后修改 CfGfwAX：

- `README.md`：简体中文、繁体中文、英文同步说明 `!` 入口、预设时隐藏底层控件、`custom` 保值，以及原有环境变量/协议边界；
- `CHANGELOG`：按实际交付在顶部新增补丁版本节，使用已定义的 `### Change`（如实际交付语义变化则在允许标题中选择），不得改写历史节；
- `_worker.js`：只同步 `const Version`，不改变连接运行逻辑；
- `work-products/tests/chain_proxy.test.mjs`：同步版本断言。

版本执行前重新读取当前顶部版本。若仍为 v2.4.9，则发布 v2.4.10；否则取当时版本的下一补丁号。

**验收标准**

- [x] 三种语言语义一致，没有把预设描述为吞吐或视频加速。
- [x] 新顶部 CHANGELOG、Worker Version 和测试断言完全一致。
- [x] CHANGELOG 只使用 `ADD/Change/Debug/Delete/New` 中语义正确的三级标题。
- [x] `_worker.js` 除版本常量外无运行逻辑变化。

**验证**

从 `CfGfwAX` 运行：

```powershell
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git -c safe.directory='C:/Users/brand/Code/CfGfwAX' diff --check
```

从 `CGAX-Pages` 重跑：

```powershell
node --test work-products/tests/connection-settings.test.mjs work-products/tests/frontend-performance.test.mjs
git -c safe.directory='C:/Users/brand/Code/CGAX-Pages' diff --check
```

**依赖**：Task 2，以及 Checkpoint A 通过或用户明确排除浏览器预览。

**回滚**：前端补丁与发布元数据分别保持可逆；回退发布元数据时一起撤销新增顶部节、Version 和版本断言，不改写更早版本。

## Checkpoint B：最终验收与发布边界

- [x] 修订规格的 13 项验收标准逐项有逻辑、文档或明确排除证据。
- [x] 两仓库目标测试、CfGfwAX 全量 Node 回归、语法和差异检查通过。
- [x] 变更范围只含本次 UI、对应测试、三语文档、发布元数据和任务状态。
- [x] `CGAX-Pages` 静态页面应先于 CfGfwAX 版本/文档发布；本计划不执行发布。
- [x] Cloudflare、真实 Codex、视频和网页体验未验证时明确标记为生产未验证。

## 风险与控制

| 风险 | 级别 | 控制 |
| --- | --- | --- |
| 隐藏字段未保存或被清空 | 高 | 只切换容器 `hidden`，不 `disabled`；测试保存对象仍读取四项控件 |
| 显式 `custom` 被自动收起 | 高 | 编辑和保存不反推；只在加载、刷新、取消时推断 |
| 选择 `custom` 覆盖现值 | 高 | `custom` 分支零写值，并用执行型测试固定 |
| 模态框监听器累积、焦点逃逸或焦点丢失 | 中 | 独立开关函数、成对注册/移除键盘监听、Tab/Shift+Tab 焦点约束、关闭后返回触发按钮 |
| 复用 UUID 模态框造成状态耦合 | 中 | 只复用样式和交互模式，DOM 与函数保持独立 |
| 小屏出现空白或溢出 | 中 | 原生 `hidden` + 四断点手工检查 |
| 文档暗示生产性能保证 | 中 | 保留环境变量、新连接、协议和吞吐边界；本地证据单独陈述 |
| 实施期间版本基线前移 | 低 | Task 3 开始时重新读取语义版本，不硬编码复用 v2.4.10 |

## 上下文加载约定

- Task 1 只加载修订规格的交互/测试段和现有连接设置测试。
- Task 2 只加载 Task 1 RED、连接设置 markup/CSS、场景函数、`applyProxyConfigToForm()`、`saveProxy()`、取消路径及 UUID 提示入口/通用模态框样式。
- Task 3 只加载已验证 UI 行为、README 三语连接场景段、CHANGELOG 顶部及版本合同。
- 发现需要修改预设名称/数值、接口、Worker 逻辑、依赖或发布流程时停止并询问，不自行扩展。

## 开放问题

无。实施与审查修复已由用户后续调用公开工作流授权并完成。
