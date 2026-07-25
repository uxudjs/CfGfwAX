# CfGfwAX

### 🌐 选择语言 | 選擇語言 | Choose Language

- [🇨🇳 简体中文](#-简体中文)
- [🇹🇼 繁體中文](#-繁體中文)
- [🇺🇸 English](#-english)

---

## 🇨🇳 简体中文

基于 edgetunnel 二次开发的 Cloudflare Workers/Pages 边缘隧道方案，提供管理后台、订阅生成与链式代理能力。

### 主要功能

- 🛡️ **多协议支持** - 支持 VLESS、Trojan 与 Shadowsocks
- 📊 **管理后台** - 在线修改配置、查看日志与流量统计
- 🛠️ **灵活部署** - 支持 Cloudflare Workers、Pages 上传及 Pages + GitHub
- 🔄 **订阅生成** - 适配 Clash、Sing-box、Surge 等主流客户端
- ⚡ **链式代理** - 支持 ProxyIP、SOCKS5、HTTP 与 Trojan fallback
- 🌐 **跨平台使用** - 支持 Windows、Android、iOS、macOS 与鸿蒙客户端

### 部署使用

#### 1. 准备配置

- 设置环境变量 `ADMIN` 作为后台登录密码
- 创建 KV 命名空间，并以变量名 `KV` 绑定到项目

#### 2. 选择部署方式

- **Pages 上传（推荐）**：下载 [main.zip](https://github.com/uxudjs/CfGfwAX/archive/refs/heads/main.zip)，在 Cloudflare Pages 选择“上传资产”，配置 `ADMIN` 与 `KV` 后重新部署
- **Workers**：新建 Worker，粘贴 [_worker.js](https://github.com/uxudjs/CfGfwAX/blob/main/_worker.js)，配置 `ADMIN`、`KV` 与自定义域
- **Pages + GitHub**：Fork 本仓库，在 Cloudflare Pages 连接 Git 仓库，配置 `ADMIN` 与 `KV` 后部署

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

### 动态代理路径

```text
/proxyip=proxyip.cmliussss.net
/socks5=user:password@127.0.0.1:1080
/http=user:password@127.0.0.1:8080
/trojan=1.1.1.1:1234
```

### 相关资源

- [图文部署教程](https://cmliussss.com/p/edt2/)
- [Error 1101 视频解析](https://www.youtube.com/watch?v=r4uVTEJptdE)
- [Pages 自定义域视频教程](https://www.youtube.com/watch?v=LeT4jQUh8ok&t=851s)

### 免责声明

- 本项目仅供教育、科学研究及个人安全测试，请遵守所在地法律法规
- 作者不对滥用项目或由此造成的直接、间接损失承担责任
- 建议测试完成后 24 小时内删除相关部署

---

## 🇹🇼 繁體中文

基於 edgetunnel 二次開發的 Cloudflare Workers/Pages 邊緣隧道方案，提供管理後台、訂閱生成與鏈式代理能力。

### 主要功能

- 🛡️ **多協議支援** - 支援 VLESS、Trojan 與 Shadowsocks
- 📊 **管理後台** - 線上修改設定、查看日誌與流量統計
- 🛠️ **彈性部署** - 支援 Cloudflare Workers、Pages 上傳及 Pages + GitHub
- 🔄 **訂閱產生** - 適配 Clash、Sing-box、Surge 等主流用戶端
- ⚡ **鏈式代理** - 支援 ProxyIP、SOCKS5、HTTP 與 Trojan fallback
- 🌐 **跨平台使用** - 支援 Windows、Android、iOS、macOS 與鴻蒙用戶端

### 部署使用

#### 1. 準備設定

- 設定環境變數 `ADMIN` 作為後台登入密碼
- 建立 KV 命名空間，並以變數名稱 `KV` 綁定至專案

#### 2. 選擇部署方式

- **Pages 上傳（推薦）**：下載 [main.zip](https://github.com/uxudjs/CfGfwAX/archive/refs/heads/main.zip)，在 Cloudflare Pages 選擇「上傳資產」，設定 `ADMIN` 與 `KV` 後重新部署
- **Workers**：建立 Worker，貼上 [_worker.js](https://github.com/uxudjs/CfGfwAX/blob/main/_worker.js)，設定 `ADMIN`、`KV` 與自訂網域
- **Pages + GitHub**：Fork 本儲存庫，在 Cloudflare Pages 連接 Git 儲存庫，設定 `ADMIN` 與 `KV` 後部署

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

### 動態代理路徑

```text
/proxyip=proxyip.cmliussss.net
/socks5=user:password@127.0.0.1:1080
/http=user:password@127.0.0.1:8080
/trojan=1.1.1.1:1234
```

### 免責聲明

- 本專案僅供教育、科學研究及個人安全測試，請遵守所在地法律法規
- 作者不對濫用專案或由此造成的直接、間接損失承擔責任
- 建議測試完成後 24 小時內刪除相關部署

---

## 🇺🇸 English

An edge tunneling solution built on Cloudflare Workers/Pages, developed as a secondary fork of edgetunnel, featuring an admin panel, subscription generation, and chain proxy capabilities.

### Features

- 🛡️ **Multiple protocols** - Supports VLESS, Trojan, and Shadowsocks
- 📊 **Admin panel** - Update settings and inspect logs and traffic statistics online
- 🛠️ **Flexible deployment** - Supports Cloudflare Workers, Pages upload, and Pages + GitHub
- 🔄 **Subscription generation** - Works with Clash, Sing-box, Surge, and other popular clients
- ⚡ **Chained proxies** - Supports ProxyIP, SOCKS5, HTTP, and Trojan fallback
- 🌐 **Cross-platform** - Works with Windows, Android, iOS, macOS, and HarmonyOS clients

### Installation

#### 1. Prepare the configuration

- Set the `ADMIN` environment variable as the admin panel password
- Create a KV namespace and bind it to the project with the variable name `KV`

#### 2. Choose a deployment method

- **Pages upload (recommended)**: Download [main.zip](https://github.com/uxudjs/CfGfwAX/archive/refs/heads/main.zip), choose “Upload assets” in Cloudflare Pages, configure `ADMIN` and `KV`, then redeploy
- **Workers**: Create a Worker, paste in [_worker.js](https://github.com/uxudjs/CfGfwAX/blob/main/_worker.js), then configure `ADMIN`, `KV`, and a custom domain
- **Pages + GitHub**: Fork this repository, connect it to Cloudflare Pages, configure `ADMIN` and `KV`, then deploy

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

### Dynamic proxy paths

```text
/proxyip=proxyip.cmliussss.net
/socks5=user:password@127.0.0.1:1080
/http=user:password@127.0.0.1:8080
/trojan=1.1.1.1:1234
```

### Disclaimer

- This project is intended only for education, scientific research, and personal security testing; comply with local laws and regulations
- The authors are not responsible for misuse or any resulting direct or indirect loss
- Delete related deployments within 24 hours after testing

---

## 🙏 Acknowledgements / 特别鸣谢

### Sponsors / 赞助支持

- [Alice](https://url.cmliussss.com/alice)
- [EasyLinks](https://www.vmrack.net?ref_code=5Zk7eNhbgL7)
- [ZMTO (VTEXS)](https://zmto.com/?affid=1532)

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
