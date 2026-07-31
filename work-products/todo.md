# Tasks: SOCKS5/HTTP XHTTP 子 KiB CPU 优化

## Phase 1：规格与计划

- [x] 规格限定为 XHTTP TCP + 显式 SOCKS5/HTTP。
- [x] 明确非目标、兼容契约、性能门和生产边界。
- [x] 计划完成依赖、验收、验证和回滚自审。

## Phase 2：RED 与测量

- [x] 加入 64/128/256/512 B 三方向基准 profile。
- [x] 添加 Trojan 分片首包 SHA 次数 RED。
- [x] 添加显式 SOCKS5/HTTP 原生 pipeTo RED。
- [x] 记录修改前兼容泵证据。

## Phase 3：实现

- [x] Trojan SHA-224 不足 58 字节不计算、每请求最多一次。
- [x] 原生 pipeTo 候选完成并通过功能测试。
- [x] VLESS 响应头一次、Trojan 无响应头的候选行为通过。
- [x] EOF、错误与非目标回退的候选行为通过。
- [x] 原生候选未达性能门，已从 Worker 回滚并保留 NO-GO 证据。

## Phase 4：验收

- [x] 决定性 64 B 双向公平对照两组 CV ≤ 10%。
- [x] 修正双向夹具的两条空管道偏差，并以两条真实 `pipeTo` 重跑公平门。
- [x] 原生候选未达到下降 ≥50%：中位数点估计低约 4.5%，但处于本地观测波动尺度内，未证明可重复收益，仍判定 NO-GO。
- [x] 原生候选已回滚，因此无需继续执行其 1/16/64 KiB 回退门。
- [x] 完整 `node --test --test-reporter=dot` 通过。
- [x] `_worker.js` 语法检查通过。
- [x] Git 差异检查通过。
- [x] CHANGELOG 仅追加本任务说明并保留用户已有改动。
- [x] NO-GO 报告与两份公平原始 JSON 可由 Git 跟踪。

## Phase 5：生产边界

- [ ] 用户手动部署。
- [ ] 收集 Cloudflare CPU/exceededCpu 与真实客户端证据。
- [ ] 生产证据通过后再标记完整 GO。
