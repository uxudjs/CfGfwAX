# Spec: 剔除 Shadowsocks，收敛为 VLESS-only

## 状态

已批准，日期：2026-08-06。用户已同意保留 VLESS 上游出口能力，并将破坏性协议删除实施版本定为 `3.0.0`。

本规格由 `@uxu-code:spec` 产出，只定义目标、兼容边界、风险和可验证验收合同；规格批准不授权修改 Worker、管理页、版本、发布或部署。下一阶段仍需显式调用 `@uxu-code:plan` 生成实施计划。

## 已批准决策与假设

- 用户所称“SS”指客户端节点协议 **Shadowsocks**，不是国家/地区代码 `SS`，也不是作为 VLESS 上游出口使用的 SOCKS5。
- “仅保留 VLESS”指 CfGfwAX 对客户端暴露和生成的唯一节点协议为 VLESS。VLESS 的 WebSocket、gRPC、XHTTP、TLS、ECH、TLS 分片、DNS/UDP、0-RTT 和链式代理能力继续保留。
- ProxyIP、SOCKS5、HTTP、HTTPS、TURN、SSTP 是 VLESS 建连后的上游出口能力，不是第二种客户端节点协议；本次不删除。
- 现有 `ss://` 节点立即失效，不增加 Shadowsocks 兼容期、自动转换器或双栈开关。Shadowsocks 与 VLESS 的认证和帧格式不同，不能安全地自动转换现有客户端节点。
- 配置合同继续保留 `协议类型: "vless"` 这个显式字段，以降低管理 API 形状变化；删除 `SS` 配置对象和全部 SS 专属字段。
- 旧 KV 配置在读取和保存边界被规范化为 VLESS，并从返回/保存对象中移除 `SS`；仅仅读取配置不触发隐藏 KV 写入，下一次管理页保存或重置时才持久清理旧字段。
- 这是移除既有公开协议的破坏性兼容变更。当前版本是 `2.4.32`，实施版本确定为 `3.0.0`。
- 历史 `CHANGELOG`、已完成规格和 Git 历史中的 Shadowsocks 记录是审计事实，不做全文抹除。

## 目标

让管理员和订阅用户只看到、配置、生成和使用 VLESS 节点，并删除不再可达的 Shadowsocks 密码学、分流、配置、管理 UI 和文档能力。

成功意味着：

1. Worker 的 WS、gRPC 和 XHTTP 客户端入站均只有 VLESS 语义；SS AEAD 运行时不再存在。
2. 默认配置、旧配置迁移、管理 API 保存结果和 `LINK` 都是 VLESS-only，不再暴露或持久化 `SS` 对象。
3. 本地生成、优选 API、优选订阅生成器、mixed/base64 和送往订阅转换器的源内容都不会混入 `ss://` 或其他非 VLESS 节点 URI。
4. CGAX-Pages 管理页不再提供 Shadowsocks 协议选项、加密方式、TLS 开关、确认弹窗或相关联动代码。
5. VLESS 的既有传输、订阅字段、链式代理和 BestCfCdn 下游合同保持不变。

目标用户是现有 CfGfwAX 管理员和 VLESS 客户端用户。现有 Shadowsocks 用户属于明确受影响用户，必须在三语 README 和新版本 `CHANGELOG` 中收到迁移说明。

## 当前事实

### CfGfwAX Worker

- `_worker.js` 的 WS 路径以 `enc` 查询参数选择 Shadowsocks，并包含入站 AEAD 解密、出站 AEAD 加密、地址解析和 SS 专属发送队列。
- `SS支持加密配置` 当前支持 `aes-128-gcm` 与 `aes-256-gcm`，并有 SS 专属密钥派生、Nonce 和 AEAD helper。
- 默认 `config.json` 含 `SS` 对象；读取逻辑允许 `协议类型 === "ss"`；`LINK` 与 mixed 订阅生成都有 `ss://` 分支。
- 优选订阅生成器和优选 API 会把不属于占位优选地址的外部节点原样拼入 `其他节点LINK`，因此只删除本地 SS 生成分支仍不足以保证 VLESS-only。
- XHTTP 与 gRPC 当前已按 VLESS 首包处理，不需要协议删除重构。

### CGAX-Pages

- `admin/index.html` 当前动态加入 Shadowsocks 选项，并包含 SS 加密方式、SS TLS、noTLS 端口标签、0-RTT/ECH/传输锁定和关闭 TLS 确认弹窗。
- 管理页保存时会把 `currentConfig.SS` 写回 Worker 管理 API。
- `admin` 是唯一检出 Shadowsocks 管理能力的静态页面；`login`、`noADMIN`、`noKV` 不包含该协议表单。

### BestCfCdn

- `core/chain_proxy.py` 已只接受包含 `/video/` 的 VLESS+TLS 节点，并分别解析 WS、gRPC 和 XHTTP。
- `/video/` 内的 `type: "socks5"` 是 VLESS 节点携带的上游链式代理模板，不是 Shadowsocks，必须保留。
- 本次预期不修改 BestCfCdn，只运行其聚焦兼容回归。

## 技术栈与项目结构

- `C:\Code\CfGfwAX\_worker.js`：Cloudflare Worker、VLESS 入站、订阅与配置规范化。
- `C:\Code\CfGfwAX\README.md`：简体中文、繁体中文、英文能力与迁移说明。
- `C:\Code\CfGfwAX\work-products\tests\`：Node `node:test` 回归；测试从最终位置以相对路径引用产品文件。
- `C:\Code\CGAX-Pages\admin\index.html`：静态管理 UI。
- `C:\Code\CGAX-Pages\work-products\tests\`：管理页静态合同回归。
- `C:\Code\BestCfCdn\work-products\tests\test_chain_proxy.py`：VLESS 链式代理下游兼容回归。

不新增 npm、Python 或 Worker 运行时依赖。

## 接口与行为合同

### 1. Worker 入站

- WebSocket 不再读取 `enc` 作为协议选择信号，不再创建 SS 上下文，也不再执行 SS 解密、加密或地址解析。
- WS 第一批字节始终进入现有 VLESS 首包解析；合法 VLESS 的 UUID、命令、地址、响应头、UDP/DNS 和 Early Data 语义不变。
- 旧 Shadowsocks 加密帧无法通过 VLESS 首包验证，连接按既有 WS 错误收敛路径关闭；不保留 SS 专属 HTTP 状态、错误分支或兼容 shim。
- gRPC 与 XHTTP 继续只接受 VLESS；不得因删除共用 helper 而改变其字节、顺序、关闭和重试行为。

### 2. 配置与管理 API

- 新默认配置固定为 `协议类型: "vless"`，不含 `SS`。
- `读取config_JSON()` 对任意旧值都返回 `协议类型: "vless"`，并在计算 `LINK` 前移除 `SS`；`LINK` 必须以 `vless://` 开头。
- `POST /admin/config.json` 在验证 UUID/HOST 后规范化输入：强制 `协议类型: "vless"`、移除 `SS`，再写入 KV。接口继续返回现有成功响应，不把旧 UI 的冗余字段重新持久化。
- `POST /admin/init` 写入的新默认配置不含 SS 字段。
- 不删除通用 `协议类型` 字段，不新增配置版本、迁移开关或后台写回任务。

示意合同：

```javascript
config_JSON.协议类型 = 'vless';
delete config_JSON.SS;
config_JSON.LINK = `vless://${userID}@${host}:443?...`;
```

### 3. 订阅输出

- 本地优选地址生成的节点 URI 固定为 `vless://`，删除协议条件分支、SS noTLS 端口映射、`enc` 插入和 v2ray-plugin SS 链接构造。
- 对 ADD/API/优选订阅生成器得到的预构建节点逐行过滤：仅保留 scheme 为 `vless://` 的节点 URI；IP、域名和 `IP:PORT#备注` 候选仍进入正常 VLESS 生成流程。
- `ss://`、`trojan://` 及其他非 VLESS 节点 URI 不进入 `其他节点LINK`，也不送往订阅转换后端。
- mixed/base64 输出中的节点只允许 VLESS；Clash、sing-box、QuanX、Loon 等是 VLESS 的消费格式，不因本次协议收敛而删除。
- 保持 `type`、`host`/`authority`、`path`/`serviceName`、`security`、`ech`、`fragment`、`fp` 与 `/video/` 链式代理字段不变。
- 既有 Surge HTTP 410 行为保持不变。

### 4. 管理 UI

- `protocol` 控件仅保留一个 VLESS 选项；为控制变更范围，不把整块表单改造为新的静态组件。
- 删除 SS 加密方式与 TLS 字段、SS TLS 弹窗及其 CSS、事件处理器、同步/保存逻辑。
- 删除 SS noTLS 端口标签和协议专属的 0-RTT、ECH、TLS 分片、传输锁定分支；VLESS 与 gRPC 本身已有的约束保持。
- 读取旧配置时不动态创建 `value="ss"` 选项；保存时显式写入 `协议类型: "vless"`，不发送 `SS`。
- `/login`、`/admin` 及缺少配置页面的鉴权、加载和导航行为不变。

### 5. 文档与发布

- README 的简体中文、繁体中文和英文能力列表统一改为 VLESS-only。
- 三种语言均增加简短破坏性迁移说明：旧 `ss://` 节点不可继续使用，需要重新获取 VLESS 订阅；不宣称自动转换。
- 新 `CHANGELOG` 发布段使用允许的 `### Delete` 标题，准确说明 Worker、订阅、配置和管理页删除范围。
- 历史版本段保持逐字不变。
- CfGfwAX `_worker.js` 版本、顶部 `CHANGELOG` 版本和 `work-products/tests/chain_proxy.test.mjs` 断言必须一致。
- CfGfwAX 与 CGAX-Pages 使用相互链接的变更说明；发布顺序为先更新管理 UI 停止创建 SS 配置，再由用户部署 VLESS-only Worker。部署不在自动实施授权内。

## 范围

### CfGfwAX

- 修改 `_worker.js`：移除 SS 入站/密码学/订阅分支，规范化配置，过滤外部订阅 URI。
- 修改 `README.md`：同步三语能力和迁移说明。
- 扩展 `work-products/tests/vless_only_protocol.test.mjs`，必要时扩展现有 WS/订阅测试，不在仓库根目录新建测试。
- 更新 `CHANGELOG` 和版本断言；版本号依批准决策同步。

### CGAX-Pages

- 修改 `admin/index.html`：删除 SS 控件、弹窗、CSS、联动和保存逻辑。
- 扩展 `work-products/tests/vless_only_protocol.test.mjs`，证明管理页只提供 VLESS 节点协议。

### BestCfCdn

- 不计划修改代码。
- 运行 `test_chain_proxy.py`，证明 VLESS+WS/gRPC/XHTTP+TLS 与 `/video/` SOCKS5 链式模板仍可消费。

## 非目标

- 不删除 ProxyIP、SOCKS5、HTTP、HTTPS、TURN、SSTP 或其管理 UI。
- 不删除 VLESS 的 WS、gRPC、XHTTP、UDP/DNS、ECH、TLS 分片、指纹、0-RTT 或随机路径能力。
- 不删除 Clash、sing-box、QuanX、Loon 等订阅输出格式；它们必须只承载 VLESS 节点。
- 不因名称含 `SS` 而删除国家代码、SSTP、`ACL4SSR`、CSS、TLS 或其他无关标识。
- 不清洗历史 `CHANGELOG`、已完成 work-products 或 Git 历史。
- 不重构通用流队列、链式代理、订阅转换器或管理页架构。
- 不运行 Wrangler，不部署 Cloudflare，不自动操作真实客户端。

## 代码风格

- `_worker.js` 保持 tab 缩进、分号、中文标识符和小范围修改，不格式化整文件。
- 删除 SS 后只移除因此变成孤儿的变量、函数、CSS 和事件处理器；不清理邻近预存代码。
- 共用的字节、流、MD5、链式代理 helper 只有在 CodeGraph 与测试证明不再被 VLESS/鉴权使用时才可删除。
- 管理页保持单文件 HTML/CSS/JavaScript 结构和现有视觉样式。

## 测试策略

先增加会在当前实现失败的回归，再做最小实现使其通过。

### CfGfwAX RED/GREEN 合同

- 源码合同：不存在 SS AEAD 配置、派生、加解密、`获取SS上下文`、`处理SS数据`、`ss://` 构造或 `enc` 协议分流；不得用会误匹配 `vless`、`SSTP`、CSS 的宽泛 `/ss/i` 断言。
- 配置合同：新配置和带 `协议类型: "ss"`、`SS` 对象的旧配置都返回 VLESS-only；保存后的 KV 不含 `SS`；`LINK` 为 `vless://`。
- 订阅合同：本地生成仅输出 VLESS；外部混合明文和 base64 内容中的 VLESS 被保留，`ss://` 与其他协议被丢弃；转换后端接收的源订阅也满足该条件。
- WS 合同：合法 VLESS 首包、Early Data、TCP、UDP/DNS、关闭和重试继续通过；旧 SS 加密帧不会建立目标连接。
- 回归合同：Surge 410、XHTTP、gRPC、链式代理与版本接口保持。

### CGAX-Pages 合同

- 管理页存在唯一 `<option value="vless">VLESS</option>`。
- 不存在 `value="ss"`、Shadowsocks 配置字段、`currentConfig.SS`、SS TLS 弹窗或 SS 专属函数。
- VLESS 的 transport、0-RTT、ECH、TLS 分片和链式代理控件仍存在。
- 对 `/login`、`/admin` 和相关缺少配置页做本地页面验证；可见变更保留截图证据。

### 测试文件路径合同

- 新增或修改的测试只能位于各仓库 `work-products/tests/`。
- CfGfwAX 测试从最终位置以 `../../_worker.js`、`../../README.md` 引用产品文件。
- CGAX-Pages 测试从最终位置以 `../../admin/index.html` 引用产品文件。
- 禁止在测试中写入 `C:\Code\...` 等机器专属绝对路径。

## 验证命令

```powershell
Set-Location C:\Code\CfGfwAX
node --test work-products/tests/vless_only_protocol.test.mjs
node --test
node --check _worker.js
node --test work-products/tests/changelog_headings.test.mjs
git diff --check

Set-Location C:\Code\CGAX-Pages
node --test
node --test ..\CfGfwAX\work-products\tests\chain_proxy.test.mjs
git diff --check

Set-Location C:\Code\BestCfCdn
$env:PYTHONUTF8='1'
.\.venv\Scripts\python.exe -m unittest discover -s work-products/tests -p test_chain_proxy.py -v
git diff --check
```

BestCfCdn 当前已有与本任务无关的未提交改动；验证只能读取和运行现有代码，不得覆盖、重置或顺带整理这些变更。

## 可量化验收标准

1. `_worker.js` 不再包含可执行 Shadowsocks 入站、AEAD 密码学、SS 地址解析、SS 发送队列或 `ss://` 生成路径。
2. WS、gRPC、XHTTP 的客户端节点协议均为 VLESS；合法 VLESS 回归保持通过，旧 SS 帧无法建立远端连接。
3. 默认、读取、保存、重置后的配置均为 `协议类型: "vless"` 且不含 `SS`，所有 `LINK` 均以 `vless://` 开头。
4. mixed/base64 订阅及送往格式转换器的源节点列表中，节点 URI 的 scheme 只有 `vless://`；外部 `ss://`、Trojan 和其他协议节点被过滤。
5. CGAX-Pages 管理页只显示 VLESS 节点协议，不含 SS 字段、弹窗、CSS、事件或保存逻辑。
6. VLESS 的 `type`、`host`/`authority`、`path`/`serviceName`、`security`、`ech`、`fragment`、`fp` 和 `/video/` 链式代理合同逐字节/逐字段保持。
7. README 简体中文、繁体中文、英文同步说明 VLESS-only 和旧 SS 节点失效；历史 changelog 不改写。
8. CfGfwAX 全量 Node、语法、标题和差异检查通过；CGAX-Pages 全量与跨仓回归通过；BestCfCdn 聚焦回归通过。
9. 新版本的 `_worker.js`、顶部 `CHANGELOG` 和版本断言一致；破坏性版本号按批准决策执行。
10. 本地结果只证明仓库与下游静态/执行回归，不宣称 Cloudflare 部署或真实客户端已验证。

## 风险与控制

- **旧 SS 用户断连**：采用破坏性版本、三语迁移说明和 UI 先行发布；不伪造自动转换能力。
- **仅删本地分支但外部订阅仍混入 SS**：在预构建节点进入 `其他节点LINK` 的共同边界按 URI scheme 过滤，并用明文/base64 混合输入回归覆盖。
- **误删 SOCKS5/SSTP 或含 `SS` 的无关代码**：按语义和 CodeGraph 调用路径删除，测试断言使用精确标识，不做大小写宽泛全文删除。
- **旧 KV 字段复活**：读取返回和 POST 保存双边界规范化；保存/重置测试检查实际 KV 字节不含 `SS`。
- **共用 helper 误删导致 VLESS 回归**：只删除 SS 专属调用闭包；全量 WS/gRPC/XHTTP、链式代理和版本测试作为门禁。
- **管理页与 Worker 发布错序**：UI 先停止创建 SS，Worker 后移除运行时；两仓 PR 相互链接。回滚时先恢复上一个 Worker，再恢复上一个 UI。
- **第三方转换器差异**：以送入转换器的 mixed 源只含 VLESS 为本地合同；真实第三方服务和客户端结果不作本地保证。
- **未提交工作受损**：保留 CfGfwAX 三个现有未提交规格文件和 BestCfCdn 全部现有改动，不执行 reset、checkout 或清理。

## 边界

### 始终执行

- 先用 RED 测试固定 VLESS-only 配置、运行时、订阅和 UI 合同。
- 保留 VLESS 传输与链式代理字段，按两仓边界协调 Worker 与管理页。
- 同步三语 README、发布版本、顶部 CHANGELOG 和版本断言。
- 对外部订阅响应按不可信输入处理，只允许 VLESS 节点 URI 进入输出。

### 先询问

- 将 SOCKS5/HTTP/HTTPS/TURN/SSTP 也视为待删除协议。
- 改变 VLESS URL 字段、WS/gRPC/XHTTP 字节合同或 `/video/` 链式代理编码。
- 选择非推荐的 patch 版本发布本次破坏性变更。
- 执行 commit、push、PR、Cloudflare 部署或真实客户端操作。

### 永不执行

- 自动把 SS 凭据或帧转换为 VLESS。
- 为兼容旧节点保留不可见 SS 双栈、环境变量或隐藏开关。
- 删除历史发布记录或因字符串包含 `SS` 而删除无关内容。
- 覆盖用户未提交改动，或把本地测试描述为生产证明。
- 在测试或证据中记录完整订阅 URI、UUID、代理凭据或真实流量。

## 开放问题

无阻塞开放问题。用户已批准：

1. 保留 ProxyIP、SOCKS5、HTTP、HTTPS、TURN、SSTP，作为 VLESS 的上游出口能力。
2. 将当前 `2.4.32` 的破坏性协议删除实施版本定为 `3.0.0`。

下一步等待显式 `@uxu-code:plan`；本次批准不授权实现或发布。
