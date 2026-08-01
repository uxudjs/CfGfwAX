# Spec: 连接场景预设与自定义

## 状态

已批准，日期：2026-07-31。

用户决策：

- 批准四个预设的名称、数值和“不单列视频加速”的产品判断；
- 只制作预设与自定义；
- 不制作自适应策略，不按应用或域名识别用途；
- 已完成的 XHTTP 规格归档到 `specs/xhttp-sub-kib-cpu-optimization.completed.md`。

本规格只定义行为与验收标准，不授权在 `@uxu-code:spec` 阶段实现业务代码。

## 目标

让 CfGfwAX 管理员无需理解四项底层连接参数，也能根据主要诉求选择保守、可解释的预设，同时继续支持逐项自定义。

目标用户是使用管理页配置代理、但不希望自行试错拨号并发与保活间隔的管理员。

成功意味着：

- 用户能选择场景预设并看到四项明确数值；
- 用户仍能逐项修改，修改后不会被预设静默覆盖；
- UI 不把建连优化误称为视频吞吐或整体网速优化；
- 环境变量覆盖、传输协议适用范围和新连接生效边界均有清晰提示；
- 不改变 Worker 配置接口、现有默认值或运行逻辑。

## 已确认行为

| 设置 | 默认值 | 实际作用 | 不作用于 |
| --- | ---: | --- | --- |
| `PRELOAD_RACE_DIAL` | `false` | 首次直连 TCP 域名时并行 DoH 查询 A/AAAA，再按 TCP 并发上限竞速候选 IP | ProxyIP、显式上游代理、IP 目标、UDP |
| `TCP_CONCURRENT_DIAL` | `2` | 决定直连 TCP 同时尝试的连接数 | 已建立连接的吞吐、缓冲、分片和保活 |
| `PROXY_CONCURRENT_DIAL` | `1` | 决定 ProxyIP 地址池每批同时尝试的候选数 | 直连、显式上游代理、已建立连接吞吐 |
| `KEEPALIVE_INTERVAL` | `30000` | WebSocket 发送空文本帧、gRPC 发送空 protobuf 消息的周期 | XHTTP 定时保活、TCP 拨号、视频吞吐、UDP 目标 |

补充约束：

- 环境变量存在时优先于 KV `config.json`，所以管理页保存值可能被覆盖。
- 修改只影响新建连接；已建立的 WebSocket/gRPC 定时器必须重连后才使用新值。
- 视频若走 QUIC/UDP，前三项 TCP 设置不会参与目标连接。
- 竞速只可能改善首连、重连和失败切换，不直接提高持续吞吐。
- Cloudflare 当前限制每次调用最多六个仍在等待建立或响应头的出站连接；预设并发必须保守低于该上限。平台依据：[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)。

## 预设合同

| 稳定 ID | UI 名称 | 预加载竞速 | TCP 并发 | ProxyIP 并发 | 保活间隔 | 适用说明 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `balanced` | 网页/视频（均衡） | 关 | 2 | 1 | `30000` ms | 与当前默认完全一致；常规浏览和视频使用 |
| `long_lived` | WS/gRPC 长连接 | 关 | 2 | 1 | `15000` ms | Codex 等存在较长空闲阶段的 WS/gRPC；XHTTP 不受保活值影响 |
| `weak_network` | 弱网快速建连 | 开 | 3 | 2 | `30000` ms | 域名直连或不稳定 ProxyIP 池；以额外 DoH/socket 换取首连或失败切换机会 |
| `resource_saver` | 节省连接资源 | 关 | 1 | 1 | `60000` ms | 连接资源优先；容忍更慢的失败切换与更稀疏的 WS/gRPC 活动 |
| `custom` | 自定义 | 保留 | 保留 | 保留 | 保留 | 高级用户逐项配置 |

不提供单独的“视频加速”预设。网页和视频归入均衡场景，并明确四项参数主要影响建连与 WS/gRPC 空闲活动，不控制媒体吞吐。

## 管理页交互

- 在“连接竞速与保活”四项设置之前增加带可见 `<label>` 的原生 `<select>`。
- 选择非 `custom` 项时，一次性把对应四个值写入现有控件，并将 `proxy` 模块标记为已修改。
- 选择 `custom` 时不得清空、重置或改写任何现有数值。
- 用户手动修改任一控件后：
  - 四项值精确匹配某个预设时显示该预设；
  - 否则显示“自定义”。
- 加载配置、取消修改和保存后刷新时，均根据四项值重新推断预设。
- 预设说明紧邻下拉框显示并随选择更新，不得只依赖 `title`。
- 固定显示以下限制：
  - 环境变量存在时优先，可能覆盖此处保存值；
  - 设置只影响新建连接，现有长连接需重连；
  - 竞速主要影响建连与失败切换，不直接提高视频吞吐；
  - WS/gRPC 长连接预设的保活值不作用于 XHTTP。
- 复用现有布局、颜色、间距和表单风格，不新增卡片、弹窗、依赖或视觉主题。
- 320、768、1024、1440 px 宽度下无横向溢出；下拉框和数字输入可用键盘操作且有可读标签。

## 配置与接口合同

继续通过既有 `POST /admin/config.json` 保存：

```json
{
  "连接设置": {
    "预加载竞速拨号": false,
    "TCP并发拨号数": 2,
    "反代并发拨号数": 1,
    "连接保活间隔毫秒": 30000
  }
}
```

- 不保存预设 ID；预设只是现有四项数值的可逆 UI 映射。
- 不改变 `GET /admin/config.json`、`POST /admin/config.json` 的形状、状态码和鉴权。
- 不改变环境变量优先级、Worker 默认值或中国移动在未显式配置时降为单路的现有行为。
- 不修改 `../_worker.js` 的连接运行逻辑。

## 范围与项目结构

实施阶段允许修改：

- `../../CGAX-Pages/admin/index.html`
  - 下拉框、说明、预设常量、填充/匹配逻辑及现有保存联动。
- `../../CGAX-Pages/work-products/tests/connection-settings.test.mjs`
  - 从测试最终位置以 `../../admin/index.html` 引用产品文件；
  - 增加映射、加载匹配、手动转自定义、选择自定义不改值及说明文字回归。
- `../README.md`
  - 简体中文、繁体中文、英文同步说明预设、环境变量优先和适用边界。
- `../CHANGELOG`
  - 按仓库发布规则记录实际交付，不提前声称功能已实施。

实施阶段不得修改：

- `../_worker.js` 的拨号、回退、保活、流式转发或协议实现；
- `/admin/config.json` 配置形状；
- `login/`、`noADMIN/`、`noKV/` 静态路径；
- vendor/data 固定资源；
- 与本功能无关的代码或格式。

## 代码风格

- `CGAX-Pages` 继续使用单文件 HTML/CSS/JavaScript，不为单次映射增加抽象层或依赖。
- 预设使用一个不可变普通对象；填充、读取和匹配逻辑保持小函数化。
- 沿用页面现有缩进、分号、命名和事件处理方式。

示意合同：

```javascript
const connectionProfiles = Object.freeze({
	balanced: { preloadRaceDial: false, tcpConcurrentDial: 2, proxyConcurrentDial: 1, keepaliveInterval: 30000 },
	long_lived: { preloadRaceDial: false, tcpConcurrentDial: 2, proxyConcurrentDial: 1, keepaliveInterval: 15000 },
	weak_network: { preloadRaceDial: true, tcpConcurrentDial: 3, proxyConcurrentDial: 2, keepaliveInterval: 30000 },
	resource_saver: { preloadRaceDial: false, tcpConcurrentDial: 1, proxyConcurrentDial: 1, keepaliveInterval: 60000 },
});
```

## 非目标

- 不制作自适应策略或“自动模式”。
- 不按 Codex、YouTube、Instagram 等应用名称或域名识别用途。
- 不解析、记录或分类应用层敏感载荷。
- 不自动改写 KV。
- 不增加 Worker 配置字段、后端接口或业务逻辑。
- 不限制或重新定义用户现有自定义最小值。
- 不承诺消除所有断流、提高视频码率或提升所有网络的页面加载速度。
- 不运行 Wrangler 或执行 Cloudflare 部署。

## 风险与控制

- **误导性性能承诺**：说明文字区分建连、保活和吞吐，不使用“视频加速”。
- **自定义值丢失**：选择 `custom` 不写值；任何未知组合稳定显示 `custom`。
- **保存兼容性**：不持久化预设 ID，只保存现有四项字段。
- **环境变量覆盖**：管理页明确提示，不伪装为当前运行有效值。
- **布局回归**：复用 `.connection-settings` 范围样式并保留 checkbox 固定宽度回归。
- **预设数值未经普适生产证明**：把它们定义为保守起点，不表述为全局最优。

## 测试策略

扩展既有 `../../CGAX-Pages/work-products/tests/connection-settings.test.mjs`，覆盖：

- 五个下拉选项和四个精确映射；
- 默认配置推断 `balanced`；
- 每个非默认预设填充正确值；
- 任一非预设组合显示 `custom`；
- 选择 `custom` 不改变当前值；
- 加载、取消修改和保存后刷新重新推断；
- 环境变量、仅新连接生效、吞吐边界和 XHTTP 限制文字存在；
- checkbox 固定宽度回归继续保留。

仓库验证命令：

```powershell
# CGAX-Pages
node --test work-products/tests/connection-settings.test.mjs work-products/tests/frontend-performance.test.mjs
git -c safe.directory='C:/Users/brand/SynologyDrive/Code/CGAX-Pages' diff --check

# CfGfwAX
node --test
node --check _worker.js
git -c safe.directory='C:/Users/brand/SynologyDrive/Code/CfGfwAX' diff --check
```

手工 UI 验证：

- 依次选择四个预设，值与说明同步变化；
- 修改任一值后显示“自定义”，改回精确组合后恢复预设名称；
- 选择“自定义”不改变值；
- 保存、刷新和取消修改后推断正确；
- 键盘可聚焦、展开、选择和保存；
- 320、768、1024、1440 px 下检查换行、控件尺寸和横向溢出。

## 验收标准

1. 第一阶段只改现有配置的表示层，四项保存值与接口完全兼容。
2. 下拉框包含已批准的五项及精确数值映射。
3. 默认、保存后刷新和取消修改均稳定推断 `balanced`。
4. 任一非预设组合显示 `custom`，用户数值不丢失。
5. UI 明确环境变量优先、仅新连接生效、XHTTP 不使用保活定时器、竞速不等于吞吐提升。
6. 测试位于 `CGAX-Pages/work-products/tests/`，并从最终位置以相对路径引用产品文件。
7. 两仓库回归、语法检查和 `git diff --check` 通过。
8. 简体中文、繁体中文、英文说明语义同步。
9. 不实现自适应、自动应用识别、KV 自动改写或 Worker 运行逻辑变更。
10. 本地证据不表述为 Cloudflare、Codex 或视频播放的生产证明。

## 边界

### 始终执行

- 保留自定义值；
- 复用现有接口和 UI 风格；
- 在表单边界验证整数和最小值；
- 区分仓库验证与生产效果；
- 保持三语文档同步；
- 按仓库规则更新版本、版本断言和 `CHANGELOG`。

### 先询问

- 调整任何已批准的预设名称或数值；
- 给自定义并发增加最大值或改变现有最小值；
- 修改 Worker 运行逻辑或配置 API；
- 增加依赖或改变发布流程。

### 永不执行

- 制作自适应策略或应用域名识别；
- 把预设宣传为视频吞吐加速；
- 自动改写 KV；
- 记录目标域名、路径、凭据或原始数据；
- 将本地测试冒充生产验证；
- 执行 Wrangler 直接部署。

## 开放问题

无。预设名称、数值、交互范围、接口兼容性、非目标和验证边界均已批准。
