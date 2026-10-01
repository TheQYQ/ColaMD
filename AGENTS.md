# AGENTS.md

面向 AI 编码代理与新贡献者的**动手须知**。本文件取代已删除的 `CLAUDE.md`（它当时的错误清单在 `docs/PROJECT_GUIDE.md` §11.2，仍然保留作证据）。
这里只放"不知道就会做错"的事实与规矩，展开内容一律给指针。

## 这个项目是什么

Electron 桌面端所见即所得 Markdown 编辑器（Typora 式界面），monorepo 里自带编辑引擎。

- `packages/desktop`（包名 `colamd`）— 主进程 / preload / 渲染端（Vue 3 + Pinia + CodeMirror 5）。根 `package.json` 的桌面脚本全部通过 `pnpm --filter colamd` 代理。
- `packages/muya`（`@muyajs/core`）— 编辑引擎，**自成一包**：根 ESLint 把它的整目录列进了 ignores（`eslint.config.js:23`），它用自己的 antfu 配置与另一套阈值，差异见 `docs/PROJECT_GUIDE.md` §10.4 与 `packages/muya/ENGINE_GUIDE.md`。

## 环境

- Node `>=20.19.0`、pnpm `>=10`（`packageManager: pnpm@10.33.4`）。没有全局 pnpm 时用 `corepack enable`。
- `pnpm install` 会跑 `scripts/postinstall.ts`：还原 `native-keymap` 源 → 下载 Electron → `patch-package` → `electron-rebuild -f` → 压缩 locale。Windows 需要 VS Build Tools（或手工放预编译 `.node`）。
- 开发：`pnpm dev`。**改 `main` / `preload` 要重启进程**，只有渲染端接了 Vite HMR。本机（Windows）`pnpm` 不在 Git Bash 的 PATH 上：`corepack prepare pnpm@10.33.4 --activate` 后需在 PATH 前放两个垫片——`pnpm`（`exec corepack pnpm "$@"`）与 `pnpm.cmd`（后者必需，`pnpm --filter` 会派生 cmd.exe）。**不用 `--no-verify` 绕门禁。**
- 换 Electron 版本后：`pnpm rebuild-native`。

## 门禁（仓库根，附实测基线）

| 命令                                   | 退出码 | 现在的基线                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`（= `lint` + `typecheck`） | 0      | **94 warnings / 0 errors**，全部是 `no-non-null-assertion`                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm test:unit`                       | 0      | 114 文件 / **1222 通过 + 1 跳过**（2026-10-01 在 `develop eaf6cdd` 之上、含第六轮续批改动实测；比上一格记的 112 / 1214 多 2 个文件、多 8 例，是 `keybinding-save-dirty.spec.ts` 与 `titlebar-window-state-identity.spec.ts`。此前那格记的 112 / 1214 是 PR #50 的 `history-clear-identity.spec.ts` 之后重测的，`develop 6bf54f6`；更早的 111 / 1211 是 2026-09-30 的数，漏了 PR #45。上一行 94/0 是 2026-09-29，未变） |

| `pnpm build` | 0 | — |
| `pnpm knip` | 0 | 只查依赖，**这条才是门禁** |
| `pnpm knip:full` | **1** | 已知 4 项（1 unused export + 3 unused exported type），**故意不接进 CI**，别把它当回归 |
| `pnpm test:e2e` | 视机器而定 | Playwright 真窗口、`workers: 1`。红先用**不含改动的对照跑**定性再分类，别直接写"抖动"（已知的间歇形状记录在 `PROJECT_GUIDE` §14 下方的抖动日志） |
| `pnpm -C packages/muya lint` | 0 | 9 warnings / 0 errors |
| `pnpm -C packages/muya test:spec` | 0 | CommonMark **88.0%** / GFM **86.6%**，逐条状态在 `packages/muya/test/spec/conformance.md` |

两条形状阈值绑在具体函数上（`eslint.config.js:334-338`）：`complexity ['warn', 37]`、`max-lines-per-function { max: 173 }`。**只有把绑住它的那个函数改小才算进步**，改大要在 PR 里说明。

## 动手前必读的四条

1. **权威文档只有一份**：`docs/PROJECT_GUIDE.md`（结构、模块地图、功能→代码定位表、实测基线面板 §14）。`README.md` 有已记录的漂移（`PROJECT_GUIDE` §11.2），别当现状引用。`ColaMD_WORKPLAN.md`、`CODE_REVIEW_AND_ROADMAP.md`（2026-09-27）与 `docs/OPTIMIZATION_ROADMAP.md`（2026-09-29，全部条目闭环或关闭后退役）均已删除，历史在 git（v0.1.4 之前可考）。
2. **`docs/*.md` 里的 `路径:行号` 没有任何工具在守**——`scripts/check-md-links.py` 解析的是根 README 变体 + `docs/i18n/*.md` + `docs/*.md`（15 个文件，它自己那句 "in 15 README files" 是误称），只管相对链接/图片/锚点，**不校验** `路径:行号` 引用。它用两条正则扫全文（`check-md-links.py:46-47`：`[...](...)` 与 `href="…"`/`src="…"`），**不认识代码跨度**——在反引号里写图片语法或 `src="…"` 照样会被判成一条缺失的相对链接，举例子时要避开这两种形状。改过某个文件的结构之后，必须自己 grep 出引用它的文档行逐条复核，链接门绿了不算。
3. **删"零引用"代码前先查动态引用**。`0646ad1` 删掉一层转发垫片后 `Ctrl+P` 就坏了，而**没有任何测试变红**；补回来的用例是 `8765cee`。
4. **报门禁要给退出码，也要给没跑的那一门**。宁可先把钉死的工具链版本装齐，也不要用 `--no-verify` 绕过。

## 代码约定

- 渲染端是 Pinia **options** store。把 action 簇外提成 `store/<cluster>.ts` 里的模块函数 `(store, ...)` 时，**store 内部的调用必须仍然走 `store.X()`**——绕过动作分派会被现有测试抓到。
- 注释只在"为什么"不明显处写（隐藏的约束、微妙的不变量、针对某个 bug 的绕法）。规范见 `.github/COMMENTING-GUIDELINES.md`。
- `test/unit/specs/search-prefill.spec.ts` 和 `source-code-image-action.spec.ts` 会剥掉 SFC 的 `import` 行、用 `new Function` 注入一份手写依赖清单来跑真实 setup。**给这两个 SFC 加 import 必须同步补那份清单**——漏掉的符号不报编译错，只在真被求值时抛 `ReferenceError`，走不到的路径会一直绿着掩盖它（2026-09-29 实测：PR #17 的 `probeSearchRegex` 就这样躺了一路）。**第二个坑同形状**：剥 import 早年按行做，prettier 把一行 `import { a, b, c } from 'x'` 折成四行后，剩下三行变成"求值即抛"的表达式语句，整个 spec 文件在装载阶段就红（2026-09-29 实测：一次只改了 `sourceCode.vue` 里一个表达式，提交钩子重排了整份文件，11 条用例全挂）。现在按**语句**剥（`test/unit/sfcScriptHarness.ts`，用例 `sfc-import-strip.spec.ts`），别再改回按行剥。
- `prettier` 与根 ESLint 在 `async (` 的空格上直接对立，**它当不了门禁**；提交时 lint-staged 会跑它，后跑的赢。

## 流程

- 一批一分支一 PR，目标 `develop`；promote 到 `main` 也走 PR，并按 `main` 惯例用 **merge commit**（不是 squash）。
- **合进 `main` 不产生 CI run**（`build.yml` 在 2026-09-11 曾对 `main` 的 push 跑过一次并失败，此后触发条件收窄，`main` 上再无 run）。12 个工作流按触发组合实测分四类：**5 条只认 `pull_request`**（`muya-build`/`muya-circular`/`muya-lint`/`muya-test`/`muya-e2e`）、**3 条 `pull_request` + `workflow_dispatch`**（`build`/`e2e`/`muya-spec`）、**3 条 `pull_request` + push 到 `develop`**（`validate-licenses`——只在 `package.json` / `pnpm-lock.yaml` 变化时起、**`lint` 与 `test`（2026-09-29 加，见下）**）、**1 条只认 `v*` 标签**（`release`）。全仓 `grep schedule:|cron:` 仍零命中（没有 nightly）。
  **所以从今天起**：一次合进 `develop` 的改动会拿到 lint + 桌面单测（ubuntu/windows）+ 非阻断 coverage 这道远端验证，**代价按批次形状分两档**：**纯文档/纯桌面合并实测 8.38 作业分钟**（`5222c9e`，2026-10-01 实测：lint 78s + test ubuntu 85s + test windows 117s + coverage 223s，零重试），**触及 `packages/muya/**`的合并约 18 分钟**（旧推算基线 PR #19 的 18.05 / PR #22 的 18.73——那两批 muya 腿真的起了，所以比纯文档形状多约 9.7 分钟；**这个差值是减出来的，没有独立测过**）。**但 E2E、打包仍然只在 PR 上跑**，promote 到`main` 之后依旧零 run，`main` 的门禁只能靠 promote PR 那一次加本机门禁。历史证据留档：`f77d0cc`与`52227b8`两个 develop merge commit 当时`check-suites`与`actions/runs?head_sha`都是`total_count: 0`（`5222c9e`起不再是 0，#20 已按此关闭）。
**另一条更强的**：五条 muya 工作流的`on:`块里**没有`push`**（只有 `pull_request`），所以合进 `develop` 之后**引擎侧在任何批次形状下都拿不到远端验证**——不是被过滤器挡掉，是没有这条通路。develop 的集成态最多就是上面那 8.38 分钟。
- **"PR 门禁是一批改动的唯一完整远端验证"这句话是有条件的**（2026-10-01 实测更正，上面那句原文把它写成无条件成立）：**桌面四条与 muya 六条的路径过滤器互斥**。`build`/`lint`/`test`/`e2e` 对 `packages/muya/**` 是 `paths-ignore`，muya 六条对引擎路径是 `paths` 包含过滤。**只碰桌面（或只改文档）的批次，muya 六条一条都不起**——实测 PR #43/#44/#45/#48 每个都只有 4 条 workflow，PR #48 的 run 是 `36814902924`/`36814902940`/`36814902970`/`36814902983`。所以纯桌面批次**没有**任何引擎验证（`muya test`/`test:spec`/`madge`/引擎 lint 全没跑），只能靠本机那几门；反之纯引擎批次没有桌面单测/E2E/打包。**只有同时碰了 `packages/muya/**`的批次才拿到全套 10 条。** 逐条过滤器与更窄的形状见`PROJECT_GUIDE`§10.4。
这条不是"CI 坏了"：12 个 workflow 全是`active`，muya 六条自 2026-09-29 起无 run 只是因为那之后没有批次碰过引擎（`git log --since=2026-09-29 -- packages/muya/`只有`18514fb`）。
- 性能类改动必须先更新 `packages/muya/docs/perf-baseline.md`——它是性能数字的唯一来源。
- 安全边界（哪些偏好键渲染端可写、选择器结果即授权、域收敛）见 `docs/PROJECT_GUIDE.md` §6；**不要为了让测试通过而放宽校验**。
