# CI run ledger

本文件是 `docs/OPTIMIZATION_ROADMAP.md` 与 `docs/PROJECT_GUIDE.md` 里引用的 **GitHub Actions run 记录**的仓库内副本。
run 页面属于仓库本身：仓库若被删除或重建，这些号就 404，而文档里"某次门禁跑在哪个 sha 上"的结论必须有出处。
所以凡新增被文档引用的 run，都要在这里补一行。生成方式：`python scripts/exportCiRuns.py`（脚本按文档里的 11 位号自动抓取）。

- 抓取时间：2026-09-27；仓库 `TheQYQ/ColaMD` 的 run 总数：**525**
- `head_sha` 是 GitHub 记录的原始值，**不随分支历史重写而变**（见 `OPTIMIZATION_ROADMAP` §3 的重映射规则 ④）。

| run           | workflow                     | head_sha  | 结论    | 日期       | 触发              | 各 job                                                                         |
| ------------- | ---------------------------- | --------- | ------- | ---------- | ----------------- | ------------------------------------------------------------------------------ |
| `35729699390` | E2E Test                     | `36e15ff` | success | 2026-09-22 | workflow_dispatch | e2e (linux, ubuntu-24.04, linux)=success; e2e (macos, macos-15, macos)=success |
| `35746222480` | E2E Test                     | `61c99c2` | failure | 2026-09-22 | pull_request      | e2e (linux, ubuntu-24.04, linux)=success; e2e (macos, macos-15, macos)=failure |
| `35752534189` | E2E Test                     | `5d4d064` | failure | 2026-09-22 | workflow_dispatch | e2e (linux, ubuntu-24.04, linux)=success; e2e (macos, macos-15, macos)=failure |
| `35753839166` | E2E Test                     | `a0348b1` | failure | 2026-09-22 | workflow_dispatch | e2e (linux, ubuntu-24.04, linux)=success; e2e (macos, macos-15, macos)=failure |
| `35757512852` | E2E Test                     | `58ff17a` | failure | 2026-09-22 | workflow_dispatch | e2e (linux, ubuntu-24.04, linux)=success; e2e (macos, macos-15, macos)=failure |
| `35759387561` | E2E Test                     | `0661ced` | failure | 2026-09-22 | workflow_dispatch | e2e (linux, ubuntu-24.04, linux)=failure; e2e (macos, macos-15, macos)=failure |
| `35763304319` | E2E Test                     | `95099e6` | success | 2026-09-22 | workflow_dispatch | e2e (linux, ubuntu-24.04, linux)=success; e2e (macos, macos-15, macos)=success |
| `35766221736` | Test                         | `fe202fd` | success | 2026-09-22 | pull_request      | coverage=success; test (ubuntu-latest)=success; test (windows-latest)=success  |
| `35956060123` | Muya Spec (CommonMark + GFM) | `76ae14b` | success | 2026-09-24 | workflow_dispatch | spec=success                                                                   |
| `36240056224` | E2E Test                     | `5b15507` | success | 2026-09-26 | workflow_dispatch | e2e (linux, ubuntu-24.04, linux)=success; e2e (macos, macos-15, macos)=success |
| `36244202347` | E2E Test                     | `0309e4d` | success | 2026-09-26 | workflow_dispatch | e2e (linux, ubuntu-24.04, linux)=success; e2e (macos, macos-15, macos)=success |
| `36244205143` | Muya Spec (CommonMark + GFM) | `0309e4d` | success | 2026-09-26 | workflow_dispatch | spec=success                                                                   |

## 未收录但出现在文档里的 11 位数字

（这些不是 run 号，列出来是为了别再把它们当提交号或 run 号统计。）
