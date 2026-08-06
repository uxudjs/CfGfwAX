# Implementation Plan: 剔除 Shadowsocks，收敛为 VLESS-only

## 规划状态

- 规划日期：2026-08-06
- 规划依据：已批准的 `work-products/SPEC.md`
- 当前状态：已按 `@uxu-code:build auto` 实施，并在 `@uxu-code:debug` 中修复审查发现的 KV 同键双写；提交、推送、部署与真实客户端验证仍未执行
- 当前实施版本：`3.0.1`
- 旧活动计划已保留为：
  - `work-products/specs/ws-grpc-schema-v2-optimization.paused.plan.md`
  - `work-products/specs/ws-grpc-schema-v2-optimization.paused.todo.md`

## 规划依据为何充分

批准规格已经固定目标、范围、兼容性边界、版本、验收与回滚原则：

- 删除 Shadowsocks 入站、AEAD、配置、管理 UI 与 `ss://` 订阅输出，不保留兼容 shim。
- 仅保留 VLESS 节点协议，同时保留 WebSocket、gRPC、XHTTP、TCP、UDP/DNS、Early Data、ECH、TLS 分片与指纹等 VLESS 能力。
- ProxyIP、SOCKS5、HTTP、HTTPS、TURN、SSTP 继续作为 VLESS 的上游出口能力，不属于要删除的节点协议。
- 所有外部订阅/API 合并进最终订阅前，只允许 `vless://` URI；不得把其他协议静默转换成 VLESS。
- CfGfwAX 是 Worker 与订阅生产者，CGAX-Pages 是管理 UI，BestCfCdn 仅作为下游兼容性验证者。
- 破坏性协议删除使用 `3.0.0`，并同步 Worker、CHANGELOG 与版本断言。

CodeGraph 与当前源码核对确认了主要边界：`_worker.js` 中仍存在 SS AEAD/WS 分支、`读取config_JSON()` 的 `SS` 字段与 `ss://` LINK 分支，以及 `获取优选订阅生成器数据()` / `请求优选API()` 的外部 URI 合并；`../CGAX-Pages/admin/index.html` 仍存在 SS 控件、动态选项、TLS 弹窗和保存逻辑；`../BestCfCdn/core/chain_proxy.py` 已按 VLESS+TLS 与 `/video/` SOCKS5 合同解析，无需预设代码改动。没有未决产品决策。

## 实施边界

### 范围内

- `CfGfwAX/_worker.js`：VLESS-only 入站、配置归一化、订阅输出过滤。
- `CfGfwAX/work-products/tests/`：扩展现有 VLESS-only 与版本回归。
- `CGAX-Pages/admin/index.html`：移除全部 Shadowsocks 管理能力。
- `CGAX-Pages/work-products/tests/`：扩展现有 VLESS-only UI 回归。
- `CfGfwAX/README.md`、`CHANGELOG`：简中、繁中、英文说明与 `3.0.0` 发布记录。
- 三仓本地自动化与静态验收。

### 范围外

- 不修改 BestCfCdn 业务代码；若其聚焦回归暴露真实合同缺陷，停止并单独重新规划。
- 不修改 ProxyIP、SOCKS5、HTTP、HTTPS、TURN、SSTP 出口实现。
- 不新增依赖、构建系统、Wrangler 或部署流程。
- 不提交、不推送、不创建 PR、不部署 Cloudflare/Pages，不声称真实客户端或生产环境通过。
- 不触碰当前无关的 connection-scenario 规格改动或 BestCfCdn 既有未提交改动。

## 依赖顺序

```text
批准规格
  -> T1 基线与工作树保护
  -> T2 Worker 入站 VLESS-only
  -> T3 配置/API VLESS-only
  -> T4 外部订阅出口 VLESS-only
  -> Checkpoint A：Worker 合同稳定
  -> T5 管理 UI VLESS-only
  -> T6 三语文档与 3.0.0 发布同步
  -> Checkpoint B：跨仓合同稳定
  -> T7 三仓本地最终门禁
```

Worker 先固定生产者合同，UI 再移除已失效的输入能力；BestCfCdn 最后只验证消费合同。若未来部署，先发布 VLESS-only 管理 UI，再发布 Worker `3.0.1`，但部署仍由用户另行授权和执行。

## 测试策略

- 每个行为任务内部先增加能证明缺口的最小 RED，再只修改对应实现直至 GREEN；不提前堆积其他任务的失败断言。
- 继续扩展现有 `work-products/tests/vless_only_protocol.test.mjs`，不另建重复测试文件。
- CfGfwAX 测试从最终位置使用 `../../_worker.js`、`../../README.md`；CGAX-Pages 测试使用 `../../admin/index.html`。禁止在测试中写入 `C:\Code\...` 等机器绝对路径。
- 不使用宽泛的 `/ss/i` 禁止断言，因为 `SOCKS5`、`SSTP`、`ACL4SSR` 与 DNS 代码均是保留功能；断言必须针对 Shadowsocks 标识、`ss://`、`协议类型 === 'ss'`、`SSAEAD*`、`currentConfig.SS` 等明确边界。
- 任何测试输出和截图不得包含完整节点 URI、UUID、订阅 token、代理凭据或 Cookie。

## Task 1：建立基线并保护现有工作树

**范围：** 在任何实现前重新记录三个仓库的 `git status --short`、当前版本三点合同和基线测试结果。CfGfwAX 中无关的 connection-scenario 文件保持原样；BestCfCdn 当前是脏工作树，只读运行测试，不整理或覆盖其改动。

**验收标准：**

- [x] 明确记录 CfGfwAX、CGAX-Pages、BestCfCdn 的起始脏文件集合。
- [x] `_worker.js`、CHANGELOG 顶部版本和 `chain_proxy.test.mjs` 当前断言一致为实施前版本。
- [x] 基线失败若存在，能区分为既有失败、环境失败或本次改动导致；不带着未归因失败进入 T2。

**验证：**

```powershell
Set-Location C:\Code\CfGfwAX
git status --short
node --test work-products/tests/vless_only_protocol.test.mjs work-products/tests/chain_proxy.test.mjs
node --check _worker.js

Set-Location C:\Code\CGAX-Pages
git status --short
node --test

Set-Location C:\Code\BestCfCdn
git status --short
$env:PYTHONUTF8='1'
.\.venv\Scripts\python.exe -m unittest discover -s work-products/tests -p test_chain_proxy.py -v
```

**依赖：** 无。

**可能改动文件：** 无。

**规模：** XS，只读。

**回滚：** 不适用；不得使用 `reset`、`checkout` 或清理命令处理既有改动。

## Task 2：删除 Worker Shadowsocks 入站运行时

**范围：** 在现有 CfGfwAX VLESS-only 回归中加入针对 SS 入站缺口的 RED，然后从 `_worker.js` 删除 SS 协议探测、`enc` 选路、握手/地址解析、AEAD 加解密、密钥派生、nonce、SS 发送队列与 SS 专用 Early Data 分支。保留共用且仍被 VLESS 或出口协议使用的字节、TCP、DNS、TLS helper。

**验收标准：**

- [x] WebSocket 入站无论是否携带 `enc`，都只按 VLESS 首包认证；无 SS fallback 或隐藏兼容路径。
- [x] `_worker.js` 不再包含 Shadowsocks 运行时标识与 SS AEAD 实现。
- [x] VLESS WebSocket Early Data、TCP、UDP/DNS、gRPC、XHTTP 及出口协议相关回归保持通过。

**验证：**

```powershell
Set-Location C:\Code\CfGfwAX
node --test work-products/tests/vless_only_protocol.test.mjs work-products/tests/ws_transport.test.mjs work-products/tests/xhttp_stream_lifecycle.test.mjs
node --check _worker.js
git diff --check
```

**依赖：** T1。

**可能改动文件：**

- `_worker.js`
- `work-products/tests/vless_only_protocol.test.mjs`

**规模：** S，2 个文件。

**回滚：** 仅反向应用本任务对上述两个文件的差异；不得回退或覆盖用户其他改动。

## Task 3：收敛 Worker 配置与管理 API 为 VLESS-only

**范围：** 为默认配置、旧 KV 配置、`POST /admin/config.json` 与 `POST /admin/init` 增加 RED/GREEN 证明。`读取config_JSON()` 必须固定 `协议类型: "vless"`、删除 `SS`、始终生成 `vless://` LINK；保存入口必须忽略/删除传入的 SS 字段，且不把它重新写入 KV。

**验收标准：**

- [x] 默认、旧 `协议类型: "ss"`、未知协议与含 `SS` 对象的配置均归一化为 VLESS-only。
- [x] 管理 API 成功保存后，持久化 JSON 不含 `SS`，`协议类型` 为 `vless`，`LINK` 以 `vless://` 开头。
- [x] UUID/HOST 校验、其他配置字段及连接设置优先级保持原行为。

**验证：**

```powershell
Set-Location C:\Code\CfGfwAX
node --test work-products/tests/vless_only_protocol.test.mjs work-products/tests/chain_proxy.test.mjs work-products/tests/connection_settings.test.mjs
node --check _worker.js
git diff --check
```

**依赖：** T2。

**可能改动文件：**

- `_worker.js`
- `work-products/tests/vless_only_protocol.test.mjs`

**规模：** S，2 个文件。

**回滚：** 反向应用本任务差异。注意：未来部署后若用户通过新 UI 保存配置，旧 `SS` 字段不可由代码回滚自动恢复；部署前应由用户备份 KV `config.json`。

## Task 4：在订阅出口边界过滤所有非 VLESS URI

**范围：** 在 `获取优选订阅生成器数据()`、`请求优选API()` 及最终混合/base64 输出的共同边界加入最小过滤。仅接纳 scheme 为 `vless://` 的完整节点 URI；保留供本地生成 VLESS 节点使用的 `IP:PORT#备注` 候选行；丢弃 `ss://`、`trojan://` 及其他协议 URI，不做协议转换。

**验收标准：**

- [x] 明文、base64、优选订阅生成器和普通订阅/API 四类输入均不能把非 VLESS URI 带入最终订阅。
- [x] 合法 VLESS URI 的查询字段与备注保持不变；重复项仍按现有规则去重。
- [x] 普通优选 IP 行、空响应与错误响应的既有处理不被 URI 过滤误伤；自有 VLESS 节点仍能生成。

**验证：**

```powershell
Set-Location C:\Code\CfGfwAX
node --test work-products/tests/vless_only_protocol.test.mjs work-products/tests/chain_proxy.test.mjs
node --test
node --check _worker.js
git diff --check
```

**依赖：** T3。

**可能改动文件：**

- `_worker.js`
- `work-products/tests/vless_only_protocol.test.mjs`

**规模：** S，2 个文件。

**回滚：** 反向应用本任务差异；若过滤导致预期外的空订阅，停止后续任务并保留失败 fixture，不能临时放宽到其他协议。

## Checkpoint A：Worker VLESS-only 合同稳定

- [x] T2-T4 的每个 RED 都曾针对预期缺口失败，并在对应任务内转为 GREEN。
- [x] `node --test`、`node --check _worker.js` 与 `git diff --check` 通过。
- [x] Worker 仍保留 VLESS 的 WS/gRPC/XHTTP、TCP、UDP/DNS 与全部批准的上游出口能力。
- [x] 最终订阅中的完整节点 URI 只有 `vless://`。
- [x] 未修改 README、CHANGELOG、版本或 CGAX-Pages；版本发布留到 T6 一次完成。

## Task 5：移除 CGAX-Pages 的 Shadowsocks 管理能力

**范围：** 扩展现有 UI VLESS-only 回归，然后从 `admin/index.html` 删除 SS 协议选项、加密方式/TLS 控件、noTLS 警告弹窗、动态注入、`currentConfig.SS` 加载、SS 标签/禁用条件与保存逻辑。协议选择只保留 VLESS，保存时显式写入 `协议类型: "vless"` 且不发送 `SS`。

**验收标准：**

- [x] 管理页仅显示 VLESS 节点协议，不含 Shadowsocks 文案、`value="ss"`、SS 字段或 SS TLS 弹窗。
- [x] WebSocket/gRPC/XHTTP、0-RTT、ECH、TLS 分片、指纹和上游出口控件保持可用且显示逻辑正确。
- [ ] `/admin/` 与 `/login/` 本地浏览器 smoke 未完成：浏览器客户端拦截 `127.0.0.1`；保存 payload 的静态与自动化合同已通过。

**验证：**

```powershell
Set-Location C:\Code\CGAX-Pages
node --test work-products/tests/vless_only_protocol.test.mjs work-products/tests/connection-settings.test.mjs
node --test
node --test ..\CfGfwAX\work-products\tests\chain_proxy.test.mjs
git diff --check
```

另用本地静态服务检查 `/admin/` 与 `/login/`；若进入 PR 阶段，再将无敏感信息的前后截图保存在该仓库 `work-products/debug/` 下。

**依赖：** Checkpoint A。

**可能改动文件：**

- `../CGAX-Pages/admin/index.html`
- `../CGAX-Pages/work-products/tests/vless_only_protocol.test.mjs`

**规模：** S，2 个文件。

**回滚：** UI 与 Worker 必须协调回滚；只回滚 UI 会重新暴露 Worker 已不支持的 SS 选项。

## Task 6：同步三语文档与 `3.0.0` 发布合同

**范围：** 在行为稳定后统一更新 README 简中、繁中、英文段落；prepend 新的 `## [v3.0.0]` CHANGELOG 节并使用 `### Delete` 描述破坏性删除；同步 `_worker.js` Version 与 `chain_proxy.test.mjs` 版本断言。保留所有历史 CHANGELOG 标题和内容不变。

**验收标准：**

- [x] 三个 README 语言段都只宣称 VLESS 节点协议，并明确旧 SS 节点失效、无兼容转换、保留的上游出口不是节点协议。
- [x] `_worker.js`、CHANGELOG 顶部与版本断言三点一致为 `3.0.0`。
- [x] CHANGELOG 仅使用允许的三级标题，历史发布节未改名、覆盖或复用。

**验证：**

```powershell
Set-Location C:\Code\CfGfwAX
node --test work-products/tests/vless_only_protocol.test.mjs work-products/tests/chain_proxy.test.mjs work-products/tests/changelog_headings.test.mjs
node --check _worker.js
git diff --check
```

**依赖：** T5。

**可能改动文件：**

- `README.md`
- `CHANGELOG`
- `_worker.js`
- `work-products/tests/vless_only_protocol.test.mjs`
- `work-products/tests/chain_proxy.test.mjs`

**规模：** M，5 个文件。

**回滚：** 版本、CHANGELOG、README、Worker 与断言必须作为一个协调单元反向应用；不得留下版本漂移或把 `v3.0.0` 历史标题改回其他版本。

## Checkpoint B：管理与发布合同稳定

- [x] CGAX-Pages 自动化通过，且管理页不再产生 SS 配置。
- [x] CfGfwAX 版本三点合同为 `3.0.1`，三语 README 与实现一致。
- [x] Worker/UI 的 rollout 与 rollback 顺序已记录，未执行部署。
- [x] BestCfCdn 尚未被修改。

## Task 7：执行三仓本地最终门禁

**范围：** 运行 CfGfwAX、CGAX-Pages 与 BestCfCdn 的完整/聚焦回归，核对差异范围和工作树归属。BestCfCdn 只验证现有 VLESS+WS/gRPC/XHTTP+TLS 与 `/video/` SOCKS5 合同；失败时不得越权修复其当前脏工作树。

**验收标准：**

- [x] CfGfwAX 全部 Node 测试、Worker 语法、CHANGELOG 标题和 diff 检查通过。
- [x] CGAX-Pages 全部 Node 测试、跨仓 Worker 回归、静态页面 smoke 和 diff 检查通过。
- [x] BestCfCdn 聚焦 `test_chain_proxy.py` 通过，且本次工作没有新增该仓库差异。
- [x] 本次新增差异只包含规格/计划产物及批准实施文件；无 secret、完整订阅 URI、真实 UUID、token 或代理凭据。既有连接场景工作区改动原样保留。

**验证：**

```powershell
Set-Location C:\Code\CfGfwAX
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check
git status --short

Set-Location C:\Code\CGAX-Pages
node --test
node --test ..\CfGfwAX\work-products\tests\chain_proxy.test.mjs
git diff --check
git status --short

Set-Location C:\Code\BestCfCdn
$env:PYTHONUTF8='1'
.\.venv\Scripts\python.exe -m unittest discover -s work-products/tests -p test_chain_proxy.py -v
git diff --check
git status --short
```

**依赖：** Checkpoint B。

**可能改动文件：** 无；验证发现缺陷时停止并回到对应任务，不在门禁阶段顺手改代码。

**规模：** S，验证。

**回滚：** 本任务不写业务文件。若门禁失败，结论为 NO-GO；不得提交、推送或部署。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 用宽泛 `SS` 搜索误删 SOCKS5、SSTP、ACL4SSR 或 DNS 标识 | 高 | 使用 CodeGraph 调用路径和精确 Shadowsocks 标识；每个切片运行保留功能回归 |
| Worker、UI 只完成一侧导致配置漂移 | 高 | Worker 合同先稳定，UI 后跟进；最终跨仓门禁；未来部署 UI 先、Worker 后 |
| 外部订阅过滤误伤 `IP:PORT#备注` 候选 | 高 | URI 与地址候选分开测试；仅过滤带 scheme 的节点 URI |
| 保存新配置后旧 SS 参数不可自动恢复 | 中 | 明确无兼容承诺；部署前用户备份 KV，代码回滚与 KV 恢复分开执行 |
| BestCfCdn 既有脏改动导致测试归因混乱 | 中 | T1 记录基线，T7 只读验证并比较新增差异；不越权修复 |
| 静态测试通过但真实 Cloudflare/客户端失败 | 中 | 最终结论仅限本地；部署和真实客户端验收保持未执行、用户控制 |

## 完成定义

- 所有授权实施任务与本地自动门禁均完成，且每个行为变更都有对应 RED/GREEN 证据。
- Worker、配置、管理 UI、最终订阅和三语文档均为 VLESS-only。
- VLESS 传输能力与批准的上游出口能力保持通过。
- `3.0.1` 版本三点合同同步，`v3.0.0` 与更早 CHANGELOG 历史未被改写。
- 三仓本地门禁通过，BestCfCdn 无本次代码改动。
- 最终报告明确区分本地证据与未执行的提交、推送、部署及真实客户端验证。

## 开放问题

无材料性实现问题。浏览器对 `127.0.0.1` 的客户端拦截使真实渲染 smoke 仍未形成证据；提交、推送、部署与真实客户端验证仍需用户另行授权。
