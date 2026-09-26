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
- 开发：`pnpm dev`。**改 `main` / `preload` 要重启进程**，只有渲染端接了 Vite HMR。
- 换 Electron 版本后：`pnpm rebuild-native`。

## 门禁（仓库根，附实测基线）

| 命令                                   | 退出码     | 现在的基线                                                                                                                                               |
| -------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`（= `lint` + `typecheck`） | 0          | **94 warnings / 0 errors**，全部是 `no-non-null-assertion`                                                                                               |
| `pnpm test:unit`                       | 0          | 95 文件 / **1115 通过 + 1 跳过**                                                                                                                         |
| `pnpm build`                           | 0          | —                                                                                                                                                        |
| `pnpm knip`                            | 0          | 只查依赖，**这条才是门禁**                                                                                                                               |
| `pnpm knip:full`                       | **1**      | 已知 4 项（1 unused export + 3 unused exported type），**故意不接进 CI**，别把它当回归                                                                   |
| `pnpm test:e2e`                        | 视机器而定 | Playwright 真窗口、`workers: 1`。红要先按 `docs/OPTIMIZATION_ROADMAP.md` §3 里 2026-09-23 那条"重尾"判定分类，用**不含改动的对照跑**定性，别直接写"抖动" |
| `pnpm -C packages/muya lint`           | 0          | 9 warnings / 0 errors                                                                                                                                    |
| `pnpm -C packages/muya test:spec`      | 0          | CommonMark **88.0%** / GFM **86.6%**，逐条状态在 `packages/muya/test/spec/conformance.md`                                                                |

两条形状阈值绑在具体函数上（`eslint.config.js:334-338`）：`complexity ['warn', 37]`、`max-lines-per-function { max: 173 }`。**只有把绑住它的那个函数改小才算进步**，改大要在 PR 里说明。

## 动手前必读的四条

1. **权威文档只有两份**：`docs/PROJECT_GUIDE.md`（结构、模块地图、功能→代码定位表）与 `docs/OPTIMIZATION_ROADMAP.md`（优化项、实测基线面板、完成状态）。`README.md`、`ColaMD_WORKPLAN.md`、`CODE_REVIEW_AND_ROADMAP.md` 都有已记录的漂移，别当现状引用。
2. **`docs/*.md` 里的 `路径:行号` 没有任何工具在守**——`scripts/check-md-links.py` 只解析 15 份 README 的相对链接/锚点。改过某个文件的结构之后，必须自己 grep 出引用它的文档行逐条复核，链接门绿了不算。
3. **删"零引用"代码前先查动态引用**。`0646ad1` 删掉一层转发垫片后 `Ctrl+P` 就坏了，而**没有任何测试变红**；补回来的用例是 `8765cee`。
4. **报门禁要给退出码，也要给没跑的那一门**。宁可先把钉死的工具链版本装齐，也不要用 `--no-verify` 绕过。

## 代码约定

- 渲染端是 Pinia **options** store。把 action 簇外提成 `store/<cluster>.ts` 里的模块函数 `(store, ...)` 时，**store 内部的调用必须仍然走 `store.X()`**——绕过动作分派会被现有测试抓到。
- 注释只在"为什么"不明显处写（隐藏的约束、微妙的不变量、针对某个 bug 的绕法）。规范见 `.github/COMMENTING-GUIDELINES.md`。
- `prettier` 与根 ESLint 在 `async (` 的空格上直接对立，**它当不了门禁**；提交时 lint-staged 会跑它，后跑的赢。

## 流程

- 一批一分支一 PR，目标 `develop`；promote 到 `main` 也走 PR，并按 `main` 惯例用 **merge commit**（不是 squash）。
- **合进 `main` 不产生任何 CI run**：12 个工作流只认 `pull_request`、`workflow_dispatch` 或 `v*` 标签。所以 PR 门禁就是这批改动的完整远端验证，promote 之后没有第二道门。
- 性能类改动必须先更新 `packages/muya/docs/perf-baseline.md`——它是性能数字的唯一来源。
- 安全边界（哪些偏好键渲染端可写、选择器结果即授权、域收敛）见 `docs/PROJECT_GUIDE.md` §6 与 `OPTIMIZATION_ROADMAP` 的 O7/O8 条目；**不要为了让测试通过而放宽校验**。
