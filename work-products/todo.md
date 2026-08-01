# Tasks: 连接场景预设与自定义

## Phase 1：RED 合同

- [x] T1.1 扩展 `../../CGAX-Pages/work-products/tests/connection-settings.test.mjs`，断言五项选择与四组精确映射。
- [x] T1.2 断言选择、读取、精确推断和手动同步入口。
- [x] T1.3 断言 `custom` 不写值及四类限制说明。
- [x] T1.4 确认新断言 RED、既有连接设置断言仍通过，并保留失败证据。

## Phase 2：管理页实现

- [x] T2.1 在四项设置前加入可访问的场景 `<select>`、说明区和五个选项。
- [x] T2.2 加入不可变预设映射及读取、填充、精确推断小函数。
- [x] T2.3 打通选择预设、手动修改、加载、取消修改和保存后刷新。
- [x] T2.4 保持 `currentConfig.连接设置` 四字段、现有校验和 checkbox 布局不变。
- [x] T2.5 连接设置与前端性能回归 GREEN，CGAX-Pages `git diff --check` 通过。

## Checkpoint A：前端功能与视觉

- [ ] A1 四个预设值、动态说明、修改状态和 `custom` 保值行为正确。
- [ ] A2 保存、刷新和取消修改后推断正确。
- [ ] A3 键盘交互与控制台检查通过。
- [ ] A4 320、768、1024、1440 px 无横向溢出或控件拉伸。
- [x] A5 `/login/`、`/admin/`、`/noADMIN/`、`/noKV/` 烟测通过。
- [ ] A6 桌面与移动端前后对比截图保存在 `../../CGAX-Pages/work-products/debug/`。

## Phase 3：文档与发布

- [x] T3.1 同步 README 简体中文、繁体中文和英文说明。
- [x] T3.2 在 CHANGELOG 顶部新增独立补丁版本节，不复用历史标题。
- [x] T3.3 同步 `_worker.js` Version 与 `work-products/tests/chain_proxy.test.mjs` 版本断言。
- [x] T3.4 全量 `node --test`、语法、CHANGELOG 标题和两仓库差异检查通过。

## Checkpoint B：交付

- [ ] B1 SPEC 10 项验收标准逐项通过。
- [x] B2 变更范围不含自适应、域名识别、KV 自动改写或 Worker 连接逻辑。
- [x] B3 CGAX-Pages 静态页发布顺序早于 CfGfwAX；实际发布仍由用户控制。
- [x] B4 未执行的 Cloudflare、Codex、视频和网页真实体验验证明确标记为生产未验证。

## 当前状态

管理页、文档与 v2.4.8 发布合同及本地全量门禁已完成；浏览器客户端拦截本机地址，A1-A4、A6 与 B1 仍待可访问的浏览器环境验证。
