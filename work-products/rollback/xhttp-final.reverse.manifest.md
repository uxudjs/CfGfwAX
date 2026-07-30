# XHTTP 最终反向补丁清单

- 基线捕获：2026-07-29，HEAD `21edfd47a3bfa03c0d5ce85ef028a682e962e850`。
- 基线说明：`work-products/debug/xhttp-cpu-worktree-baseline.md`；优化开始前已有的 `CHANGELOG`、`_worker.js`、`chain_proxy.test.mjs` 修改已保留。
- 反向补丁：`work-products/rollback/xhttp-final.reverse.patch`。
- SHA-256：`17ba170faa7fc43d66b839996053694a20acff68c111710383328c1a506f5d2e`。
- 大小：93,235 bytes。

## 撤销范围

- `.gitignore`
- `CHANGELOG`
- `_worker.js`
- `chain_proxy.test.mjs`
- `xhttp_stream.test.mjs`
- `xhttp_stream_benchmark.mjs`
- `xhttp_stream_benchmark.test.mjs`
- `xhttp_stream_downlink.test.mjs`
- `xhttp_stream_lifecycle.test.mjs`
- `xhttp_stream_uplink.test.mjs`

`chain_proxy.test.mjs` 仅回退发布版本断言，其余冻结基线内容保留。`work-products/` 中的计划、证据、内部测试和本清单不会被删除。

## 验证

- 当前工作树：`git apply --check --ignore-whitespace work-products/rollback/xhttp-final.reverse.patch` 通过。
- 隔离 Git 仓库已验证代码级反向补丁可恢复冻结基线；本次新增的版本、CHANGELOG 与版本断言回退片段另由当前工作树 `git apply --check` 验证。
- 补丁生成与验证都在 `C:/tmp` 的独立临时仓库完成，没有在当前工作树应用回滚。

## 使用边界

仅在需要撤销本轮全部 XHTTP 优化时，由用户在部署前确认工作树状态后应用。生产回滚仍由用户在 Cloudflare 控制台恢复上一版本；本补丁不执行部署。
