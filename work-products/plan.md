# Implementation Plan: SOCKS5/HTTP XHTTP 子 KiB CPU 优化

## 目标与边界

依据 `work-products/SPEC.md`，仅优化 XHTTP TCP 经显式 SOCKS5/HTTP 代理的流转发，并修复 Trojan 分片首包的重复 SHA-224。保持协议字节、公开接口、代理选择、非目标传输和默认设置不变；Cloudflare 部署及生产验证由用户执行。

## 依赖顺序

```text
子 KiB 与分片 RED
  → Trojan SHA 惰性单次计算
    → SOCKS5/HTTP 原生 pipeTo 双向转发
      → 稳定 A/B、全量回归与 CHANGELOG
```

## Task 1：建立失败证据与子 KiB 测量面（完成）

**依赖**：无。

**范围**

- 修改 `work-products/benchmarks/xhttp_stream_benchmark.mjs`，加入 `64b/128b/256b/512b` 的上传、下载和双向 profile，并保留既有 profile 与 schema。
- 新增 `work-products/tests/xhttp_stream_tiny_chunks.test.mjs`，证明 profile、字节摘要、兼容泵和原生管道对照均可执行。
- 新增 `work-products/tests/xhttp_first_packet_fragmentation.test.mjs`，通过受控 SHA 观察器证明当前分片解析重复计算，并证明不足 58 字节时不应计算。

**验收**

- RED 明确失败于目标行为缺失，而非夹具、路径或语法错误。
- 新 profile 沿用固定种子、CPU 原始轮次、代码指纹和 `CV ≤ 10%` 稳定门。
- 测试引用仓库文件时只使用相对路径。

**验证**

- `node --test work-products/tests/xhttp_stream_tiny_chunks.test.mjs work-products/tests/xhttp_first_packet_fragmentation.test.mjs`
- `node --check work-products/benchmarks/xhttp_stream_benchmark.mjs`

**回滚**

- 只回退基准 profile 和两个新测试；不触碰 Worker。

## Task 2：Trojan 首包 SHA-224 惰性单次计算（完成）

**依赖**：Task 1 的分片 RED。

**范围**

- 在 `_worker.js` 的单次 `读取XHTTP首包()` 闭包内缓存编码后的密码哈希。
- 累积数据不足 58 字节时先返回 `need_more`，不得执行 SHA-224。
- 保持认证、地址解析、`rawData`、错误文本和 VLESS 判定顺序不变。

**验收**

- Trojan 首包任意分片数量下每请求最多计算一次 SHA-224。
- 完整首包与未授权首包行为保持不变。

**验证**

- `node --test work-products/tests/xhttp_first_packet_fragmentation.test.mjs`
- 运行既有 XHTTP/Trojan 首包相关回归。
- `node --check _worker.js`

**回滚**

- 仅恢复 `读取XHTTP首包()` 的当前哈希计算位置；测试保留用于记录成本差异。

## Task 3：显式 SOCKS5/HTTP TCP 原生双向管道（NO-GO，已回滚）

**依赖**：Task 2。

**范围**

- 在 `_worker.js` 为目标条件增加内部原生流能力：首包仍由代理握手函数写一次，剩余 request body 与远端 writable 直接 `pipeTo()`。
- 远端 readable 直接 `pipeTo()` XHTTP 响应 writable；VLESS 两字节响应头在移交管道前写一次，Trojan 不写。
- 统一 EOF、取消和任一方向错误的 socket 收敛；重复关闭保持无害。
- 非目标路径继续使用 `connectXHTTPStreams()`/`connectStreams()` 兼容泵。
- 扩充 `work-products/tests/xhttp_stream_tiny_chunks.test.mjs`，覆盖 SOCKS5/HTTP、VLESS/Trojan、字节顺序、header-once、EOF、取消、双向错误和非目标回退。

**验收**

- 目标条件严格命中原生 `pipeTo()`；其他出站或入站不命中。
- 首包、剩余上传、下载均无丢失、重复或乱序。
- 资源生命周期测试在有限超时内完成，无未处理拒绝或 stream lock 泄漏。

**验证**

- `node --test work-products/tests/xhttp_stream_tiny_chunks.test.mjs`
- 运行既有 `xhttp_stream*`、`chain_proxy`、transport diagnostics 回归。
- `node --check _worker.js`

**回滚**

- 删除严格条件保护的原生管道分支，恢复既有兼容泵；Task 2 可独立保留。

**实际结果**

- 功能候选与 SOCKS5/HTTP 集成测试曾通过。
- 初版双向 native 夹具误加两条空管道，审查后已修正为一次 helper 承载两条真实 `pipeTo`，并增加调用计数回归。
- 修正后的 `bidirectional-64b` 基准中，手动 Web Streams 泵为 `44.234043 ms`，原生 `pipeTo` 为 `42.255319 ms`；两组 CPU CV 均小于 `10%`。
- 原生方案中位数点估计低约 `4.5%`，但处于本地观测波动尺度内，未证明可重复收益且远低于 `50%` 门槛，因此仍按本任务回滚条款不进入 `_worker.js`。

## Task 4：性能门、全量回归与交付记录（完成）

**依赖**：Task 3。

**范围**

- 使用相同 fixture、Node、代码指纹分别测量兼容泵与原生管道，保存原始证据到 `work-products/debug/`。
- 运行完整 Node、Worker 语法和 Git 差异检查。
- 在 `CHANGELOG` 顶部追加本任务条目，保留用户已有未提交删除，不改写历史版本标题。
- 更新 `work-products/todo.md` 的实际状态与门禁结论。

**验收**

- 可用于结论的子 KiB profile 均 `CPU CV ≤ 10%`。
- 子 KiB 双向原生管道 CPU 中位数相对兼容泵下降至少 50%。
- 既有 1/16/64 KiB profile 无超过 5% 回退。
- `node --test`、`node --check _worker.js`、`git diff --check` 全部通过。
- 本地通过只标记“等待用户生产验证”。

**验证**

- `node --expose-gc work-products/benchmarks/xhttp_stream_benchmark.mjs ...`
- `node --test`
- `node --check _worker.js`
- `git diff --check`
- `git status --short`

**回滚**

- 性能门未通过则回退 Task 3，保留测试、基准与 NO-GO 证据；功能门未通过则停止，不更新完成状态。

**实际结果**

- Task 3 性能门未通过并已回滚。
- 保留子 KiB/fair A/B 基准与 `work-products/debug/xhttp-native-pipe-no-go.md`。
- NO-GO 报告与两份公平原始 JSON 已通过精确 `.gitignore` 例外纳入交付范围。
- `node --test --test-reporter=dot`、`node --check _worker.js`、`git diff --check` 均通过，CHANGELOG 已更新。

## 计划自审

- [x] 每项任务均有依赖、范围、验收、验证和回滚。
- [x] 先 RED 后实现；SHA 与原生流可独立回滚。
- [x] 每个实现任务涉及不超过 5 个文件。
- [x] 未改变外部协议、默认设置、非目标传输或部署权限边界。
- [x] 性能改善必须同时满足正确性、稳定性和无回退门。
- [x] 无材料问题或未决设计选择阻止实施。

## 决策

计划无误，可按用户授权直接进入 `@uxu-code:build`。
