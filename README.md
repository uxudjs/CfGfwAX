# CfGfwAX

### 🌐 选择语言 | 選擇語言 | Choose Language

- [🇨🇳 简体中文](#-简体中文)
- [🇹🇼 繁體中文](#-繁體中文)
- [🇺🇸 English](#-english)

---

## 🇨🇳 简体中文

基于 edgetunnel 2.1 二次开发的 Cloudflare Workers/Pages 边缘隧道方案，提供管理后台、订阅生成与链式代理能力。

### 主要功能

- 🛡️ **多协议支持** - 支持 VLESS 与 Shadowsocks
- 📊 **管理后台** - 在线修改配置、查看日志与流量统计
- 🛠️ **灵活部署** - 支持 Cloudflare Workers 与 Pages 上传
- 🔄 **订阅生成** - 适配 Clash、Sing-box、Loon、Quantumult X 等主流客户端
- ⚡ **链式代理** - 支持 ProxyIP、SOCKS5、HTTP、HTTPS、TURN 与 SSTP
- 🌐 **跨平台使用** - 支持 Windows、Android、iOS、macOS 与鸿蒙客户端

### 协议维护说明

- Trojan 已从 Worker 入站、订阅生成和管理页面中移除，后续不再维护。
- Trojan 流量存在较明确的代理协议特征，本项目不建议继续使用或部署同类节点。
- Surge 不原生支持本项目保留的 VLESS 节点格式，因此本项目不再提供 Surge 订阅兼容；`?surge`、`target=surge` 或 Surge User-Agent 请求会返回 HTTP 410。

### 部署使用

#### 1. 准备配置

- 设置环境变量 `ADMIN` 作为后台登录密码
- 创建 KV 命名空间，并以变量名 `KV` 绑定到项目

#### 2. 选择部署方式

- **Pages 上传（推荐）**：下载 [main.zip](https://github.com/uxudjs/CfGfwAX/archive/refs/heads/main.zip)，在 Cloudflare Pages 选择“上传资产”，配置 `ADMIN` 与 `KV` 后重新部署
- **Workers**：新建 Worker，粘贴 [_worker.js](https://github.com/uxudjs/CfGfwAX/blob/main/_worker.js)，配置 `ADMIN`、`KV` 与自定义域
- **禁止 Cloudflare 直接拉取 GitHub 仓库部署**：请勿在 Cloudflare Pages 或 Workers 中连接、导入或拉取本仓库；仅使用上述 Pages 上传或手动创建 Worker 的方式部署

#### 3. 打开管理后台

访问 `https://你的域名/admin`，输入 `ADMIN` 密码登录。也可使用[自托管前端](https://uxudjs.github.io/CGAX-Pages/admin)。

### 环境变量

| 变量名 | 必填 | 默认值/示例 | 说明 |
| :--- | :---: | :--- | :--- |
| `ADMIN` | ✅ | `123456` | 后台管理密码 |
| `KEY` | ❌ | `CMLiussss` | 快速订阅路径密钥，如 `/CMLiussss` |
| `UUID` | ❌ | UUIDv4 | 固定订阅令牌与节点 UUID |
| `PROXYIP` | ❌ | `proxyip.cmliussss.net:443` | 全局反代地址 |
| `URL` | ❌ | 网页 URL 或 `1101` | 默认主页伪装地址 |
| `GO2SOCKS5` | ❌ | `*.example.com` | 强制走 SOCKS5 的域名列表，逗号分隔，`*` 表示全局 |
| `DEBUG` | ❌ | `1` / `true` | 开启调试日志 |
| `OFF_LOG` | ❌ | `1` / `true` | 关闭日志记录 |
| `BEST_SUB` | ❌ | `1` / `true` | 开启优选订阅生成器 |
| `PRELOAD_RACE_DIAL` | ❌ | `1` / `true` | 开启预加载竞速拨号 |
| `TCP_CONCURRENT_DIAL` | ❌ | `2` | TCP 并发拨号数 |
| `PROXY_CONCURRENT_DIAL` | ❌ | `1` | 反代并发拨号数 |
| `KEEPALIVE_INTERVAL` | ❌ | `30000` | 连接保活间隔（毫秒，最小 `1000`） |

> 管理页“Cloudflare CDN 访问设置”中的连接竞速与保活项会保存到 KV `config.json`，用作这些变量未设置时的回退值；环境变量存在时仍优先。

#### 连接场景预设

| 场景 | 预加载竞速 | TCP 并发 | ProxyIP 并发 | 保活间隔 |
| :--- | :---: | ---: | ---: | ---: |
| 网页/视频（均衡） | 关 | 2 | 1 | 30000 ms |
| WS/gRPC 长连接 | 关 | 2 | 1 | 15000 ms |
| 弱网快速建连 | 开 | 3 | 2 | 30000 ms |
| 节省连接资源 | 关 | 1 | 1 | 60000 ms |
| 自定义 | 保留当前值 | 自定义 | 自定义 | 自定义 |

预设模式只显示“使用场景”和旁边的 `!` 说明入口，四项底层控件仅在“自定义”时显示；`!` 会展示当前场景说明和共同限制。选择“自定义”会保留当前值，手动编辑及保存后的当前会话继续保持“自定义”；加载、刷新或取消修改时再按四项保存值精确匹配预设。预设只填充现有四项设置，不保存额外的场景 ID。设置只影响新建连接，现有长连接需重连；保活间隔用于 WebSocket/gRPC 而不作用于 XHTTP，竞速主要改善建连与失败切换，不直接提高视频吞吐。

### 动态代理路径

```text
/proxyip=proxyip.cmliussss.net
/socks5=user:password@127.0.0.1:1080
/http=user:password@127.0.0.1:8080
```

### 免责声明

- 本项目仅供教育、科学研究及个人安全测试，请遵守所在地法律法规
- 作者不对滥用项目或由此造成的直接、间接损失承担责任
- 建议测试完成后 24 小时内删除相关部署

---

## 🇹🇼 繁體中文

基於 edgetunnel 2.1 二次開發的 Cloudflare Workers/Pages 邊緣隧道方案，提供管理後台、訂閱產生與鏈式代理能力。

### 主要功能

- 🛡️ **多協議支援** - 支援 VLESS 與 Shadowsocks
- 📊 **管理後台** - 線上修改設定、查看日誌與流量統計
- 🛠️ **彈性部署** - 支援 Cloudflare Workers 與 Pages 上傳
- 🔄 **訂閱產生** - 適配 Clash、Sing-box、Loon、Quantumult X 等主流用戶端
- ⚡ **鏈式代理** - 支援 ProxyIP、SOCKS5、HTTP、HTTPS、TURN 與 SSTP
- 🌐 **跨平台使用** - 支援 Windows、Android、iOS、macOS 與鴻蒙用戶端

### 協議維護說明

- Trojan 已從 Worker 入站、訂閱產生和管理頁面中移除，後續不再維護。
- Trojan 流量存在較明確的代理協議特徵，本專案不建議繼續使用或部署同類節點。
- Surge 不原生支援本專案保留的 VLESS 節點格式，因此本專案不再提供 Surge 訂閱相容；`?surge`、`target=surge` 或 Surge User-Agent 請求會傳回 HTTP 410。

### 部署使用

#### 1. 準備設定

- 設定環境變數 `ADMIN` 作為後台登入密碼
- 建立 KV 命名空間，並以變數名稱 `KV` 綁定至專案

#### 2. 選擇部署方式

- **Pages 上傳（推薦）**：下載 [main.zip](https://github.com/uxudjs/CfGfwAX/archive/refs/heads/main.zip)，在 Cloudflare Pages 選擇「上傳資產」，設定 `ADMIN` 與 `KV` 後重新部署
- **Workers**：建立 Worker，貼上 [_worker.js](https://github.com/uxudjs/CfGfwAX/blob/main/_worker.js)，設定 `ADMIN`、`KV` 與自訂網域
- **禁止 Cloudflare 直接拉取 GitHub 儲存庫部署**：請勿在 Cloudflare Pages 或 Workers 中連接、匯入或拉取本儲存庫；僅使用上述 Pages 上傳或手動建立 Worker 的方式部署

#### 3. 開啟管理後台

前往 `https://你的網域/admin`，輸入 `ADMIN` 密碼登入。也可使用[自託管前端](https://uxudjs.github.io/CGAX-Pages/admin)。

### 環境變數

| 變數名稱 | 必填 | 預設值/範例 | 說明 |
| :--- | :---: | :--- | :--- |
| `ADMIN` | ✅ | `123456` | 後台管理密碼 |
| `KEY` | ❌ | `CMLiussss` | 快速訂閱路徑金鑰，例如 `/CMLiussss` |
| `UUID` | ❌ | UUIDv4 | 固定訂閱權杖與節點 UUID |
| `PROXYIP` | ❌ | `proxyip.cmliussss.net:443` | 全域反向代理位址 |
| `URL` | ❌ | 網頁 URL 或 `1101` | 預設首頁偽裝位址 |
| `GO2SOCKS5` | ❌ | `*.example.com` | 強制使用 SOCKS5 的網域清單，以逗號分隔，`*` 表示全域 |
| `DEBUG` | ❌ | `1` / `true` | 開啟偵錯日誌 |
| `OFF_LOG` | ❌ | `1` / `true` | 關閉日誌記錄 |
| `BEST_SUB` | ❌ | `1` / `true` | 開啟優選訂閱產生器 |
| `PRELOAD_RACE_DIAL` | ❌ | `1` / `true` | 開啟預載競速撥號 |
| `TCP_CONCURRENT_DIAL` | ❌ | `2` | TCP 並行撥號數 |
| `PROXY_CONCURRENT_DIAL` | ❌ | `1` | 反向代理並行撥號數 |
| `KEEPALIVE_INTERVAL` | ❌ | `30000` | 連線保活間隔（毫秒，最小 `1000`） |

> 管理頁「Cloudflare CDN 存取設定」中的連線競速與保活項會儲存到 KV `config.json`，作為這些變數未設定時的回退值；環境變數存在時仍優先。

#### 連線場景預設

| 場景 | 預載競速 | TCP 並行 | ProxyIP 並行 | 保活間隔 |
| :--- | :---: | ---: | ---: | ---: |
| 網頁/影片（均衡） | 關 | 2 | 1 | 30000 ms |
| WS/gRPC 長連線 | 關 | 2 | 1 | 15000 ms |
| 弱網快速連線 | 開 | 3 | 2 | 30000 ms |
| 節省連線資源 | 關 | 1 | 1 | 60000 ms |
| 自訂 | 保留目前值 | 自訂 | 自訂 | 自訂 |

預設模式只顯示「使用場景」和旁邊的 `!` 說明入口，四項底層控制項僅在「自訂」時顯示；`!` 會顯示目前場景說明和共同限制。選擇「自訂」會保留目前值，手動編輯及儲存後的目前工作階段繼續保持「自訂」；載入、重新整理或取消修改時才會依四項儲存值精確比對預設。預設只會填入既有四項設定，不會儲存額外的場景 ID。設定只影響新建連線，現有長連線需重新連線；保活間隔用於 WebSocket/gRPC 而不作用於 XHTTP，競速主要改善連線建立與失敗切換，不會直接提高影片吞吐量。

### 動態代理路徑

```text
/proxyip=proxyip.cmliussss.net
/socks5=user:password@127.0.0.1:1080
/http=user:password@127.0.0.1:8080
```

### 免責聲明

- 本專案僅供教育、科學研究及個人安全測試，請遵守所在地法律法規
- 作者不對濫用專案或由此造成的直接、間接損失承擔責任
- 建議測試完成後 24 小時內刪除相關部署

---

## 🇺🇸 English

A Cloudflare Workers/Pages edge tunnel solution further developed from edgetunnel 2.1, with an admin panel, subscription generation, and chained proxy support.

### Features

- 🛡️ **Multiple protocols** - Supports VLESS and Shadowsocks
- 📊 **Admin panel** - Update settings and inspect logs and traffic statistics online
- 🛠️ **Flexible deployment** - Supports Cloudflare Workers and Pages upload
- 🔄 **Subscription generation** - Works with Clash, Sing-box, Loon, Quantumult X, and other popular clients
- ⚡ **Chained proxies** - Supports ProxyIP, SOCKS5, HTTP, HTTPS, TURN, and SSTP
- 🌐 **Cross-platform** - Works with Windows, Android, iOS, macOS, and HarmonyOS clients

### Protocol maintenance notice

- Trojan has been removed from Worker ingress, subscription generation, and the admin panel, and is no longer maintained.
- Trojan traffic has comparatively recognizable proxy-protocol characteristics; this project does not recommend continuing to use or deploy similar nodes.
- Surge does not natively support the retained VLESS node format, so this project no longer provides Surge subscription compatibility; requests using `?surge`, `target=surge`, or a Surge User-Agent return HTTP 410.

### Installation

#### 1. Prepare the configuration

- Set the `ADMIN` environment variable as the admin panel password
- Create a KV namespace and bind it to the project with the variable name `KV`

#### 2. Choose a deployment method

- **Pages upload (recommended)**: Download [main.zip](https://github.com/uxudjs/CfGfwAX/archive/refs/heads/main.zip), choose “Upload assets” in Cloudflare Pages, configure `ADMIN` and `KV`, then redeploy
- **Workers**: Create a Worker, paste in [_worker.js](https://github.com/uxudjs/CfGfwAX/blob/main/_worker.js), then configure `ADMIN`, `KV`, and a custom domain
- **Cloudflare must not pull this GitHub repository directly**: Do not connect, import, or pull this repository through Cloudflare Pages or Workers; use only the Pages upload or manual Worker methods above

#### 3. Open the admin panel

Visit `https://your-domain/admin` and sign in with the `ADMIN` password. You can also use the [self-hosted frontend](https://uxudjs.github.io/CGAX-Pages/admin).

### Environment variables

| Variable | Required | Default/example | Description |
| :--- | :---: | :--- | :--- |
| `ADMIN` | ✅ | `123456` | Admin panel password |
| `KEY` | ❌ | `CMLiussss` | Quick subscription path key, such as `/CMLiussss` |
| `UUID` | ❌ | UUIDv4 | Fixed subscription token and node UUID |
| `PROXYIP` | ❌ | `proxyip.cmliussss.net:443` | Global reverse proxy address |
| `URL` | ❌ | Web URL or `1101` | Default camouflage homepage |
| `GO2SOCKS5` | ❌ | `*.example.com` | Comma-separated domains forced through SOCKS5; `*` means global |
| `DEBUG` | ❌ | `1` / `true` | Enable debug logs |
| `OFF_LOG` | ❌ | `1` / `true` | Disable log storage |
| `BEST_SUB` | ❌ | `1` / `true` | Enable the preferred-subscription generator |
| `PRELOAD_RACE_DIAL` | ❌ | `1` / `true` | Enable preloaded racing dials |
| `TCP_CONCURRENT_DIAL` | ❌ | `2` | Number of concurrent TCP dials |
| `PROXY_CONCURRENT_DIAL` | ❌ | `1` | Number of concurrent reverse proxy dials |
| `KEEPALIVE_INTERVAL` | ❌ | `30000` | Connection keepalive interval in milliseconds (minimum `1000`) |

> The connection-racing and keepalive settings in the **Cloudflare CDN Access Settings** admin section are saved in KV `config.json` as fallbacks when these variables are unset. Environment variables continue to take precedence.

#### Connection profiles

| Profile | Preloaded racing | TCP concurrency | ProxyIP concurrency | Keepalive interval |
| :--- | :---: | ---: | ---: | ---: |
| Web/video (balanced) | Off | 2 | 1 | 30000 ms |
| WS/gRPC long-lived | Off | 2 | 1 | 15000 ms |
| Faster weak-network setup | On | 3 | 2 | 30000 ms |
| Connection resource saver | Off | 1 | 1 | 60000 ms |
| Custom | Keep current value | Custom | Custom | Custom |

Preset modes show only **Profile** and the adjacent `!` help entry; the four underlying controls appear only for **Custom**, while `!` shows the current profile description and shared limits. Selecting **Custom** preserves the current values, and manual edits plus a successful save keep the current session in **Custom**. Loading, refreshing, or cancelling changes infers the profile again from the four saved values. Profiles only fill the existing four settings and do not persist a separate profile ID. Changes affect new connections only, so existing long-lived connections must reconnect. Keepalive applies to WebSocket/gRPC, not XHTTP, while racing targets connection setup and failover rather than sustained video throughput.

### Dynamic proxy paths

```text
/proxyip=proxyip.cmliussss.net
/socks5=user:password@127.0.0.1:1080
/http=user:password@127.0.0.1:8080
```

### Disclaimer

- This project is intended only for education, scientific research, and personal security testing; comply with local laws and regulations
- The authors are not responsible for misuse or any resulting direct or indirect loss
- Delete related deployments within 24 hours after testing

---

## 🙏 Acknowledgements / 特别鸣谢

### Upstream projects and contributors / 上游项目与贡献者

- [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel)
- [zizifn/edgetunnel](https://github.com/zizifn/edgetunnel)
- [6Kmfi6HP/EDtunnel](https://github.com/6Kmfi6HP/EDtunnel)
- [SHIJS1999/cloudflare-worker-vless-ip](https://github.com/SHIJS1999/cloudflare-worker-vless-ip)
- [Stanley-baby](https://github.com/Stanley-baby)
- [ACL4SSR](https://github.com/ACL4SSR/ACL4SSR/tree/master/Clash/config)
- [股神](https://t.me/CF_NAT/38889)
- [Workers/Pages Metrics](https://t.me/zhetengsha/3382)
- [白嫖哥](https://t.me/bestcfipas)
- [Mingyu](https://github.com/ymyuuu/workers-vless)
- [ToiCF/CF-Workers-HTTPS](https://github.com/ToiCF/CF-Workers-HTTPS)
- [ToiCF/CF-Workers-TURN](https://github.com/ToiCF/CF-Workers-TURN)
- [ToiCF/CF-Workers-SoftEther](https://github.com/ToiCF/CF-Workers-SoftEther)
- [ToiCF/GrainTCP](https://github.com/ToiCF/GrainTCP)
- [eooce](https://github.com/eooce/Cloudflare-proxy)
- [Sukka](https://ip.skk.moe/)
- [zhangtaile](https://github.com/cmliu/edgetunnel/pull/999)
- [1345695](https://github.com/1345695/edcloudwasm)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=uxudjs/CfGfwAX&type=Date)](https://star-history.com/#uxudjs/CfGfwAX&Date)
