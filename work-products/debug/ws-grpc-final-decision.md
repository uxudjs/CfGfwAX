# WS/gRPC CPU 本地最终判定

日期：2026-08-02
版本：v2.4.22

## 结论

`INCONCLUSIVE`。两次完整 32-profile baseline 均已完成并原子写入，但稳定性门未通过，因此未冻结 baseline，Checkpoint A 关闭。按批准计划，T4–T7 的 gRPC/WS 运行时候选全部跳过；本轮没有把任何本地 Node CPU 结果表述为 Cloudflare 生产证明。

## 正式证据

- 证据：`work-products/debug/ws-grpc-baseline.json`
- 证据 SHA-256：`3321f9c2e38ebbdbcee7a46ef6af86e65894106cf24bc52800a20c059f27afb9`
- run 1：`8ce1890c-7abf-41ac-9535-7a1d63559158`，32 profiles，`limited`
- run 2：`403cbc0b-33a3-4b84-b32c-d8b5051f1f8d`，32 profiles，`limited`
- Worker SHA-256：`4f59aeb78db64db6fae355120aa006a78e692329ca173b5319a9ebd3d9b2188a`（两次 run 与最终 `_worker.js` 一致）
- benchmark SHA-256：`03e2585b51c9038a8ae243c253fe6a457f621cba20aa45c4d9cb79f9a33c44fa`（证据与最终 benchmark 一致）
- fixture SHA-256：`b13261ceffb27a120f88c3466a3917bfb2875493d5f802422b433a3599407be6`
- profile matrix SHA-256：`ab4194122f2c81a9493d4f091df77e0a67d27b974698e17376396bd71b2fcb46`

## 失败门

- 最大 CPU CV 为 35.8509%；run 1 有 9 个 limited profile，run 2 有 5 个 limited profile。
- 4 个 profile 的跨 run CPU 中位数相对差超过 10%：`ws-upload-64kib` 15.5938%、`grpc-download-256b` 13.6482%、`grpc-download-64b` 11.4746%、`ws-download-256b` 10.2758%。
- 环境、Worker/benchmark/fixture/profile matrix 哈希均未漂移；run ID 唯一，两个 run 均为完整 32-profile 矩阵。
- schema 从原始轮次重算得到 `INCONCLUSIVE` 和 6 项 failure；真实计量、有限数值与敏感字段检查通过。

## 协议与范围

- XHTTP：本轮保持现有运行逻辑，仅执行回归；既有本地小块优化不能替代 Cloudflare `exceededCpu` 日志和真实客户端验证。
- WS/gRPC：测量合同已强化，但本机 baseline 不稳定，不能据此声称仍有哪一项候选可安全降低 Cloudflare CPU，也不能进入候选 A/B。
- v2.4.22 只交付测量、判定、证据与发布元数据；没有新增 WS/gRPC/XHTTP 性能业务逻辑。

## 未执行的用户控制验证

- Cloudflare 部署与 Workers CPU / `exceededCpu` 日志。
- 真实 XHTTP、WebSocket、gRPC 客户端的长连接、弱网和持续流验证。
- 生产环境前后对照；本地 Node 证据只证明本次 baseline 门没有通过。

