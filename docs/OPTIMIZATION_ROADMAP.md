# ColaMD 优化路线图

> 本文以当前工作区代码为唯一基准（分支 `develop`，`9449f8f`，2026-09-19），**取代** `CODE_REVIEW_AND_ROADMAP.md` 的优化职能。
> 只谈技术优化（正确性、安全、性能、结构、工程），不裁定 `CODE_REVIEW_AND_ROADMAP.md` §8 的新增功能项（插件系统 / 协同编辑 / AI 辅助 / 引擎发布 / 主题市场）。
> 文中每条结论都给 `路径:行号`；每条测量都标了测量方法，可按 §1 末尾的命令复现。

## 1. 实测基线面板

| 维度         | 实测值                                                                                                                                    | 测量方法                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面端规模   | 236 个 ts/vue 文件、40,346 行                                                                                                             | `find packages/desktop/src … \→ wc -l`                                                                                                |
| 引擎规模     | 220 个 ts 文件（不含 `__tests__`）、48,485 行                                                                                             | 同上，`packages/muya/src`                                                                                                             |
| 最大文件     | `store/editor.ts` 2347、`editor.vue` 2321、`prefComponents/image/…/uploader/index.vue` 1193、`commands/index.ts` 766、`menu/menus.ts` 724 | `wc -l`                                                                                                                               |
| runtime 依赖 | 桌面 35 个，**零引用 0 个**                                                                                                               | 纯 Node 扫描 477 个源/配置/测试文件；`node node_modules/knip/bin/knip.js --workspace packages/desktop --dependencies` 退出 0 且无输出 |
| IPC 面       | 主进程 41 `ipcMain.handle` + 64 `ipcMain.on`、约 94 `webContents.send`；契约 41 invoke + 82 send + 2 sync + 69 内部                       | `grep -c` 于 `src/main`，契约计数于 `src/shared/types/ipc.ts`                                                                         |
| 测试面       | 5 套共 422 个 spec 文件：desktop 单测 61、desktop E2E 63、muya 单测 223、muya 一致性 4、muya E2E 71                                       | `find … -name '*.spec.ts' \→ wc -l`                                                                                                   |
| 一致性       | CommonMark 87.7% / GFM 86.3%，钉死在 `test/spec/expected-failures.json`（78 + 90 条）                                                     | `packages/muya/CLAUDE.md`、`test/spec/conformance.md`                                                                                 |
| CI           | 13 个工作流；仅 `test.yml` 有双平台腿（ubuntu + windows）                                                                                 | `ls .github/workflows \→ wc -l` + 逐文件读                                                                                            |
| 击键热路径   | 1MB `edit+flush` p50 2.9 / p95 4.0 ms（验收线 P95 < 16 ms，余量 4×）                                                                      | `packages/muya/docs/perf-baseline.md`（M1.2b 轮，2026-09-12）                                                                         |
| 入口路径     | 1MB `setContent` p50 28.2 ms（基线 8,489.9 ms，−99.7%），增长已线性                                                                       | 同上（M1.3 轮，PR #27）                                                                                                               |
| 注释密度     | `TODO`/`FIXME` 52 处                                                                                                                      | `grep -rn` 于两包 `src`                                                                                                               |

复现基线：

```bash
node node_modules/knip/bin/knip.js --workspace packages/desktop --dependencies   # 依赖体检
pnpm -C packages/muya exec vitest run src/state/__tests__/keystrokePipeline.bench.spec.ts --testTimeout 420000   # 性能（2-10 分钟）
```

> 本机 `pnpm` 不在 Git Bash 的 PATH 上（`/c/Users/lyg/AppData/Local/pnpm` 里没有可执行文件）。本轮做法：`corepack prepare pnpm@10.33.4 --activate` 装钉定版本，再放两个垫片到 PATH 前面——`pnpm`（`exec corepack pnpm "$@"`）与 `pnpm.cmd`（后者必需，因为 `pnpm --filter` 会派生 cmd.exe，而 cmd 认不了无后缀脚本）。**不用 `--no-verify` 绕门禁。**

## 2. 旧 Top-10 复核：7 已修、3 部分、0 遗留

判定基于代码，不基于 `ColaMD_WORKPLAN.md` 的自述。

| 旧 # | 问题（`CODE_REVIEW_AND_ROADMAP.md:42-58`）         | 判定    | 证据                                                                                                                                                                                                                                                                                                                                         |
| ---- | -------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `webSecurity: false` 可读任意本地文件              | ✅ 已修 | `main/config.ts:24` `webSecurity: process.env.NODE_ENV !== 'development'`，dev 例外有明确注释理由；`:12,13,18` isolation+sandbox+无 nodeIntegration                                                                                                                                                                                          |
| 2    | `mt::fs::*` 接受任意未校验路径                     | ⚠️ 部分 | `main/security/pathScope.ts` 已建立写/删/移的根白名单并 realpath 解析；但 `:28-31` 声明**读通道刻意不设限**，`:36-42` 记录 `imageFolderPath` 可由渲染端 `mt::set-user-preference` 自行扩大可写域 → O7                                                                                                                                        |
| 3    | `shell.openExternal` 无协议白名单                  | ✅ 已修 | `main/ipc/shell.ts:9` `OPEN_EXTERNAL_RE = /^https?:\/\//i`，拒绝 `file://`/`smb://`/自定义 scheme 并记日志                                                                                                                                                                                                                                   |
| 4    | 每击键 5 遍全文扫描                                | ✅ 已修 | M1.2/M1.2b：脏标记 + 120ms 停顿层 + flush-on-read，`test/unit/specs/lazy-markdown-pipeline.spec.ts`（desktop 侧，实现在 `renderer/src/components/editorWithTabs/lazyMarkdownPipeline.ts`；WORKPLAN 把实现名误写成 spec 名）锁"击键连发 0 次全文序列化"                                                                                       |
| 5    | ~19 个零引用依赖                                   | ✅ 已修 | 现 35 个依赖，实测零引用 0；`409188a`/`57e0e65` 两轮清理                                                                                                                                                                                                                                                                                     |
| 6    | `validate-licenses` 引用已删除的 `packages/muyajs` | ✅ 已修 | `scripts/thirdPartyChecker.ts:15` `workspaceExclusions = ['packages/desktop', 'packages/muya']`                                                                                                                                                                                                                                              |
| 7    | 测试/lint 仅 Linux                                 | ⚠️ 部分 | `test.yml` 已含 windows；但 `lint.yml`、`e2e.yml`、全部 `muya-*.yml` 仍只有 ubuntu，`build.yml`/`release.yml` 的 5 腿矩阵**不跑任何测试** → O14                                                                                                                                                                                              |
| 8    | BigInt FNV-1a 全文哈希                             | ✅ 已修 | `components/editorWithTabs/syntheticHistory.ts:50` 改用双 32 位 Number 通道（并注释了为何仍保 64 位强度）；M1.2b 又把它移出击键路径                                                                                                                                                                                                          |
| 9    | 会话持久化每秒全标签快照 + 主线程同步写盘          | ✅ 已修 | M1.4（PR #32）：5s debounce / 30s maxWait、O(tabs) 签名门控跳过无变化写盘、fsync 改异步链式；实测见 `store/bufferedState.ts`                                                                                                                                                                                                                 |
| 10   | 图片路径自动补全模块级无界缓存                     | ⚠️ 部分 | **原判定"缓存不重建"实测为假**：`main/utils/imagePathAutoComplement.ts:67-91` 的 `watchDirectory` 已在 `'rename'` 事件上调 `rebuild()`（`:57-65`），当初挂在 :16 的 `// TODO: rebuild cache @jocs` 是过期注释（本轮已换成说明性注释）；剩下的只是 `IMAGE_PATH`/`watchers` 按目录只增不减（`:19-20`，仅 watcher 出错时才 `delete`） → O6 降级 |

**结论**：旧报告的"高危三件套"与"性能四件套"已经关闭。当前真正欠着的不是同一批问题——下面 27 项是这一轮实测出的（O1–O26 于 2026-09-19，O27 于次日实施 O18 时补）。`ColaMD_WORKPLAN.md` 七个梯队的"已完成"自述同样逐条核对过，见 §7。

## 3. 优化清单

成本档：XS < 0.5 天，S < 2 天，M < 1 周，L > 1 周。

**完成状态只在本段记一次**（下列提交都在各自的本地分支上，**`develop` 尚未合并任何一个**，验收后按分支逐个合）：

| 分支                                   | 提交                                       | 覆盖项                   |
| -------------------------------------- | ------------------------------------------ | ------------------------ |
| `fix/quick-open-file-name-search`      | `1ef4822`                                  | O1                       |
| `fix/batch1-small-correctness`         | `b0174f6`、`83e69a0`、`a8ad0b0`、`50bc907` | O2、O5、O11、O17         |
| `fix/startup-action-enum`              | `6b771d5`                                  | O3                       |
| `chore/tooling-gates`                  | `9f47e41`、`5b338e2`                       | O16                      |
| `cleanup/redundant-exports`            | `cab7cb8`、`48e4b1d`                       | O20（49 处 export）、O23 |
| `perf/preference-broadcast`            | `2d56e65`、`300d03c`                       | O9                       |
| `fix/markdown-extension-single-source` | `76e5a92`                                  | O22                      |
| `fix/open-failure-visible`             | `7bbedb5`、`f3e13be`                       | O18、O4                  |
| `refactor/typed-ipc-handle`            | `cba0836`                                  | O8①                      |

遗留事项：O17 的像素效果待实机确认；O20 余下 29 项真死代码移交 O13；O6 与 O10 经复核分别降级与撤下，理由见各自条目。

**合并顺序（用 `git merge-tree` 对 9 个分支两两预演，非破坏性）**：只有 3 对会冲突，其余两两可自动合。

| 冲突对                                                                      | 冲突文件                                           | 处置                                                                                                |
| --------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `fix/startup-action-enum`（O3）×`cleanup/redundant-exports`（O20）          | `renderer/src/store/preferences.ts`                | 已知项：O3 先合，O20 再跑一次 export 清扫（预演结论 typecheck 0 错、868+1 通过）                    |
| `fix/batch1-small-correctness`（O2/O5/O11/O17）×`cleanup/redundant-exports` | `main/menu/index.ts`、`main/spellchecker/index.ts` | batch1 先合：O5 换了 reader、O2 补了 `()`，O20 只删 `export` 关键字，保留前者内容再套后者意图       |
| `fix/batch1-small-correctness`×`refactor/typed-ipc-handle`（O8）            | `main/ipc/menu.ts`                                 | batch1 先合：O5 把 reader 抽进 `utils/recentDocuments`，O8 只是把该文件的 handle 换成 `typedHandle` |

`fix/open-failure-visible`（O4/O18）与 `perf/preference-broadcast`（O9）同改 `main/preferences/index.ts` 与 `main/dataCenter/index.ts` 但**区块不相干，可自动合**；九分支一次性合入 `develop` 后的完整门禁预演留到第二批收尾再做，届时把结果并回本段。

### A 组·正确性回归（有实锤 bug，优先）

**O1 · 快速打开退化为全文搜索** — 成本 XS，影响 高
`commands/quickOpen.ts:3` 用的是**默认导入** `import FileSearcher from '@/node/ripgrepSearcher'`，而该文件默认导出是 `RipgrepDirectorySearcher`（`node/ripgrepSearcher.ts:129-142`，`mode: 'text'`）；做文件名检索的具名 `export class FileSearcher`（`:144-152`，`mode: 'files'`）当前无人引用。根因：`409188a` 删了 `node/fileSearcher.ts`——那 4 行是 `export { FileSearcher as default } from './ripgrepSearcher'` 的转发垫片，被误判为死代码。

- 改法：`import { FileSearcher } from '@/node/ripgrepSearcher'`。
- 验收：新增/复用一个 E2E——打开含 `alpha.md`/`beta.md` 的目录，`Ctrl+P` 输入 `alph` 应命中文件名；当前实现会去搜正文里的 `alph`，空正文时结果为 0。
- 回滚点：单文件单行。

**O2 · 拼写检查可用性判断恒真** — 成本 XS，影响 低（只影响告警可见性）
`main/spellchecker/index.ts:46` 写成 `if (!win.webContents.session.isSpellCheckerEnabled)`，缺 `()`，属性对象恒真 → "拼写检查不可用"的降级提示永不触发。

- 验收：临时关掉 spellcheck，确认日志出现；补一条断言该分支的单测。

**O3 · `startUpAction` 跨进程枚举不重合** — 成本 S，影响 中（启动恢复行为）
渲染端类型 `'restoreAll' | 'lastSession' | 'blank'`（`store/preferences.ts:10`），主进程实际比较 `'restoreAll' | 'folder' | 'openLastFolder'`（`main/app/index.ts:288-299`），`'lastState'` 靠迁移改写（`main/preferences/index.ts:49-50`）。因为字段声明成 `StartUpAction | string`，编译器不会拦。`'lastSession'` 是死值，`'folder'`/`'openLastFolder'` 未被类型覆盖。

- 改法：值域移到 `src/shared/types/preferences.ts` 单一声明，两进程共读；去掉 `| string`；迁移表也引用同一常量。
- 验收：`pnpm typecheck` 通过即为门；再加一个纯函数测试覆盖"每个合法枚举值在主进程分支上都有归属"。

**O4 · 两处空实现与一个名不副实的开关** — 成本 S，影响 低（原为"中"）— **已完成 `f3e13be`（分支 `fix/open-failure-visible`）**

> **前提更正（两处）**：① `exportJSON`/`importJSON` 不是"菜单里的入口"——全仓零调用方（无菜单项、无 IPC、无命令、无测试），所以它们是"看起来迟早会补实现"的空方法，而不是"点了没反应"的入口；② `--safe` 也**有**消费者：`main/keyboard/shortcutHandler.ts:176-178` 在 safe mode 下跳过用户键位文件，原判"设了但无人消费"不实。不实的是帮助文本 `Disable plugins and other user configuration`（本仓没有插件系统，`grep -i plugin src/main` 只有这一行）与构造函数上那句"safe mode 不该加载偏好"的 TODO。

- 改法（已实施，走"摘掉入口"这一支）：删除两个空方法；`--safe` 的帮助文本改成它实际做的事（忽略用户键位覆盖）；构造函数 TODO 换成"为什么不能照 TODO 直接做"——`init()` 会写盘（首启 `store.set(defaultSettings)`、过期键 `store.delete`），没有只读 store 之前"不加载"等于把用户设置覆盖一遍。
- 验收：`pnpm typecheck` 通过 + 单测全绿；knip 未用导出基数 −2。
- 遗留：`--safe` 若要真覆盖"other user configuration"，前置条件是给 `electron-store` 加只读模式（原 `TODO(fxha)` 注释也指向同一处），本轮不做。

**O5 · 最近文档逻辑两份实现** — 成本 XS
`main/menu/index.ts:18-19` 与 `main/ipc/menu.ts:14-15` 各有一份读取逻辑与一份 `MAX_RECENTLY_USED_DOCUMENTS`，改一处会漏另一处（原生菜单 vs 自绘菜单）。

- 改法：抽 `main/utils/recentDocuments.ts`，常量唯一。

### B 组·安全与契约强度

**O6 · 图片补全的缓存与 watcher 按目录只增不减** — 成本 S，影响 **低**（原判定已降级）

> **前提更正**：本项最初写作"补缓存不失效、目录变更后结果陈旧"，实测**不成立**——`imagePathAutoComplement.ts:67-91` 的 `watchDirectory` 在 `'rename'` 上就调 `rebuild()`（`:57-65`），当时挂在 :16 的 `// TODO: rebuild cache @jocs` 是过期注释。所以"新增图片后 3s 内补全可见"这条验收测的是已经存在的行为。

剩下的只有一件事：`IMAGE_PATH`（`:19`）与 `watchers`（`:20`）按目录累积，只有 watcher 出错时才 `watchers.delete`（`:81`），进程内不主动释放。量级是"本次会话里补全过多少个不同目录"，每目录一个小数组 + 一个 OS 句柄。

- 改法：不做。若将来出现"一次会话切几十个工作区"的真实反馈，再按窗口/项目关闭清理；单加 LRU 是给一个还没有度量的高估问题加机制。
- 附带的真修（已做）：`IMAGE_PATH` 上方那句过期 `// TODO: rebuild cache` 换成了说明"为什么不淘汰"的注释，避免下一轮审计再把它读成缺陷。
- 完成状态：**降级后不排 PR**（原 PR-10 从第二批移除）。

**O7 · 路径域只护写不护读，且渲染端可自扩** — 成本 M，影响 高（信任边界）
`security/pathScope.ts:28-31` 明示读通道不设限；`:36-42` 记录 `imageFolderPath` 由渲染端经 `mt::set-user-preference` 设置，等于被攻破的渲染进程能自己扩大可写范围。

- 改法（两步，按序）：① `imageFolderPath` 改为**只能经原生目录选择对话框**赋值（选完即入域），拒收自由字符串；② 读通道按"当前文档所在目录 + 已打开项目根 + 工作区目录"三源收敛，超域读走原生授权对话框。**②的范围自 O8 并入一项**：先定 `mt::rg::start`/`mt::uploader::upload` 的载荷归属（渲染端发的是自家选项的 JSON 克隆、主进程按命名字段读，形状无人认领），归属定了才能谈校验，也才能把那两处 `ipcMain.handle` 豁免收进 `typedHandle`。
- 验收：新增契约测试枚举所有 `mt::fs::*`，断言每条都有域归属；E2E 断言给 `imageFolderPath` 塞 `/etc` 被拒。
- 回滚点：偏好迁移需保留旧值读取一次以兼容，标 `deprecated` 后分版删除。

**O8 · IPC 契约是单向的** — 成本 M，影响 中 — **① handle 半边已完成 `cba0836`（分支 `refactor/typed-ipc-handle`）**
`shared/types/ipc.ts` 约束了 preload 侧（泛型 `keyof`），但主进程 `ipcMain.handle('mt::fs::write-file', …)` 与契约**无类型关联**（Electron 给 listener 的是 `any[]`）。改载荷结构编译期发现不了——这正是 `docs/PROJECT_GUIDE.md` §11.1-1 那类回归能活下来的土壤。

- 改法（①已实施）：新增 `src/main/ipc/typedHandle.ts`，把 41 个 handle 通道的注册绑到契约上；配平 lint 门：根 `eslint.config.js` 第 11 节在 `src/main/**` 禁 `ipcMain.handle`，只剩两处带理由的豁免（见下）。
- **实测产出（这才是本项的价值证明）**：接上 41 个通道立刻出 10 个不匹配，其中 1 条是 `mt::spellchecker-switch-language` 多余的 `return null`（三个调用方都 await 后丢弃），其余 8 条是**契约自己本来就写错了**（下表），另 1 条是 `mt::rg::start` 的载荷归属问题（见"剩余"）。
- 连带收益：`KeybindingConfigurator.ts:93-99` 那段 `as unknown as boolean` 连同它"契约写的是 void"的过期注释一起删掉——§13 的 `as unknown as` 基数 64 → 63（该分支未合入前 develop 仍是 64）。
- 剩余（②未完成）：`mt::rg::start` 与 `mt::uploader::upload` 的载荷仍是 `unknown`，两处各自留着 `ipcMain.handle` + 行内理由。不是类型问题：渲染端发的是自家选项的 JSON 克隆，主进程按命名字段读，**载荷形状无人认领**，收窄要先决定归属，已并入 O7② 的校验活。`on`/`send` 通道（82 条）同理尚未绑契约，本项未做。
- 验收（已达成）：负例探针——把 `mt::cmd::exists` 的参数标注改成 `number`，`pnpm typecheck` 立刻 TS2345 失败（改前不会）；改回后 typecheck 0 错、`pnpm lint` 回到 149 warnings/0 errors 基线（转换过程中我自己造出 8 条 unused-import 告警，已清）、单测 61 文件 863 通过 + 1 跳过、`launch`+`context-isolation`+`ripgrep-search` E2E 4 例真窗口通过。**未采纳**原写的"CI 跑 tsc 负例夹具"，因为 lint 禁令已在 `pnpm lint` 门内阻断绕行，夹具只会多养一套测试基建。

契约写错的 8 条（全部为编译期发现，运行时此前看不出差别）：

| 通道                                   | 契约原写                       | 实际                                                                                                             |
| -------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `mt::ask-for-image-path`               | `ret: string[]`                | 处理函数答**单个路径字符串**；`store/editor.ts` 的 `ASK_FOR_IMAGE_PATH` 同样写错，而引擎选项要 `Promise<string>` |
| `mt::rg::start`                        | `ret: { searchId: string }`    | 返回 `true` 且调用方丢弃 → 改 `ret: void`，多余的 `return true` 删除                                             |
| `mt::shell::open-external`             | `ret: void`                    | 返回"是否打开"的布尔                                                                                             |
| `mt::spellchecker-set-enabled`         | `ret: void`                    | 三条路径全返回布尔                                                                                               |
| `update-buffer-state`                  | `ret: void`                    | 返回布尔，`sendBufferedState` 一路带给调用方                                                                     |
| `mt::i18n::load`                       | `ret: Record<string, unknown>` | 语言缺失时答 `null`                                                                                              |
| `mt::fs::read-file`                    | `encoding?: string`            | 处理函数要 `BufferEncoding`（preload 与 `global.d.ts` 同步收窄）                                                 |
| `mt::keybinding-save-user-keybindings` | `args: [bindings: unknown]`    | 渲染端发 `Map<string, string>`                                                                                   |

### C 组·性能与响应残余

**O9 · 偏好/用户数据批量写入的广播条数** — 成本 M，影响 低—中（原判定已更正）

> **前提更正**：原标题写的是"触发 N×M 次原生菜单重建"，实测**高估**：唯一会重建菜单的订阅方 AppMenu 早已按 key 判定（`main/menu/index.ts:527-537`，只有 `theme`/`followSystemTheme`/`language`/`autoSave` 才重建），另外两个订阅方（`main/app/index.ts:320` 设 `nativeTheme` 与图片目录域、`main/windowManager.ts:463` 转发给各窗口）不重建菜单；而 `setItems` 的三处调用方（`main/app/index.ts:521,842`、`main/windows/editor.ts:425`）每次只传一键，DataCenter 唯一渲染端发送方也只发 `{ [type]: value }`（`store/preferences.ts:311`）。所以"每次改开关吃一次全菜单重建"不成立。

真实剩下的两点：批量写入时广播条数随键数增长（订阅方每条都要重排一次载荷），以及 `DataCenter.setItem` **先发广播再写盘**（`main/dataCenter/index.ts:105-106`），订阅方回头读值会读到旧值。

- 改法：批量写完后一次合并广播（带变更键集合），并把广播移到写入之后。
- 验收：`setItems(5 keys)` 后广播 1 次而非 5 次；`setItems(null/空对象)` 不广播。
- 完成状态：**PR-9 已实现**，分支 `perf/preference-broadcast`（`2d56e65` 偏好侧、`300d03c` DataCenter 侧），新增 `test/unit/specs/preference-broadcast.spec.ts` 4 例。**收益按上面的更正重估为低—中**，不是原来说的菜单重建收敛。

**O10 · `isSamePathSync` 的阻塞回落** — **已撤下（判定高估）**
原判："每次比较都阻塞渲染主线程"。实测两条都不成立：① `preload/index.ts:141-157` 只在 `a.length === b.length` 且 `a !== b` 而小写相同（同一文件的大小写异体写法）时才走 `sendSync`，常规不等的路径长度先就被排掉了；② 六个调用方（`sideBar/treeFile.vue:57`、`store/editor.ts:276,389,690,1425,1848`）全是点文件、保存、关标签这类离散动作，不在击键路径上。

- 撤下理由：原改法（把规范化结果缓存进 `window.colamd.paths`）要给一个非热点加一层路径缓存与其失效逻辑，属于用复杂度换一个测不到的收益；`docs/PROJECT_GUIDE.md` §11.1-8 已同步改写为"离散动作的同步回落"。
- 若将来真有证据（PERF_TESTING 采样里出现阻塞计数）再重开，判据是"同一秒内 `mt::paths::is-same-sync` 调用次数"，不是读代码猜。

**O11 · 设置页语言轮询** — 成本 XS
`prefComponents/sideBar/config.ts:269` 每秒轮询 `window.__VUE_I18N__` 取 locale，只在下次 setup 时清（`:267`），组件卸载后仍常驻。已有事件通道 `language-changed`（`src/main/i18n.ts:23`，且已在契约 `shared/types/ipc.ts:252`）可替掉它。

- 验收：删掉定时器，切语言仍能刷新文案；`onBeforeUnmount` 断言无遗留 timer。

### D 组·结构与工程卫生

**O12 · 拆两个上帝文件** — 成本 L，影响 高（可维护性与合并冲突）
`store/editor.ts` 2347 行 / 约 85 个 action 同时管标签、当前文件、TOC、保存、导出、关闭、切换、自动存、版本快照、搜索、图片；`editor.vue` 2321 行同时管 Muya 生命周期、快捷键、拖拽、格式状态、导出 HTML、粘贴、专注/打字机。改动集中于此，回归半径大。

- 改法（保持行为不变的三步）：① 先把纯逻辑（保存/导出/标签生命周期/图片）从 store 里提为 `src/renderer/src/services/*` 的无状态函数，store 只留状态与编排；② `editor.vue` 按关注点抽 composable（`useEditorLifecycle`、`useEditorPaste`、`useEditorModes`）；③ 每步都要求 E2E 全绿后再进下一步。
- 验收：拆完目标单文件 < 800 行；**不加新功能**；`git log` 上每步一个可独立 revert 的提交。

**O13 · 死代码与孤儿导出清理** — 成本 S
本会话实测到的：具名 `FileSearcher` 在 O1 修完前无人用；`main/dataCenter/index.ts:83,93` 广播 `broadcast-web-image-added/-removed` 全仓零监听且不在契约；`main/app/index.ts:465-485` 整段注释掉的截图/快捷键捕获；`renderer/src/assets/symbolIcon/index.js`（`main.ts:5` 引入、无模板引用）；`commands/descriptions.ts:169-175` 三个无对应命令的 id；`components/titleBar/index.vue:99` 按 `.js` 引入实为 `.ts`。

- 注意：`409188a` 已经证明"审计扫出来的死代码可能是承重垫片"。本组每条**必须先确认它是被引用还是被契约/动态字符串引用**（`listenBoth()` 的 bus 名、菜单 id、`getMenuItemById` 都可能跨文件引用），再删。
- **O20 移交的 29 个精确清单**（判据：无任何 import ＋去掉 `export` 后 eslint 立刻报 unused-vars，即连本文件都不引用）：
  - `common/i18n.ts` — 类型 `SupportedLanguage`、函数 `getSupportedLanguages`、`isLanguageSupported`（后两者只在文件末尾的 `export {}` 列表里出现，全仓无人 import）
  - `main/contextMenu/editor/menuItems.ts` — `CUT`、`COPY`、`PASTE`、`COPY_AS_RICH`、`COPY_AS_HTML`、`PASTE_AS_PLAIN_TEXT`、`INSERT_BEFORE`、`INSERT_AFTER`
  - `renderer/src/contextMenu/tabs/menuItems.ts` — `CLOSE_THIS`、`CLOSE_OTHERS`、`CLOSE_SAVED`、`CLOSE_ALL`、`RENAME`、`COPY_PATH`、`SHOW_IN_FOLDER`
  - `shared/types/ipc.ts` — `InvokeArgs`、`InvokeRet`、`SyncArgs`、`SyncRet`、`SendArgs`、`EventArgs`
  - `shared/types/files.ts` — `ITab`；`shared/types/preferences.ts` — `LayoutState`；`renderer/src/components/sideBar/types.ts` — `TabDescriptor`；`main/menu/index.ts` — `getMenuItemById`；`renderer/src/util/themeMarket.ts` — `sanitizeThemeText`
  - develop 就已报 unused-vars 的两个（**基线存量，不是 O20 造成**）：`main/versionHistory/index.ts` 的 `SnapshotLabel`、`renderer/src/codeMirror/index.ts` 的 `getModeFromName`
- 这 29 项删除后，`pnpm lint` 的 `no-unused-vars` 应从 5 降到 3、knip 的两段计数同步下降——**这是删除动作的验收线**，不能靠重新加 `export` 让告警闭嘴。

**O14 · CI 矩阵与交付平台不匹配** — 成本 M
`build.yml`/`release.yml` 跑 5 平台腿但**不跑任何测试**；`e2e.yml`/`lint.yml`/`muya-*.yml` 只 ubuntu；`test.yml` 双平台。产品交付三平台，Windows/macOS 专属缺陷（路径分隔符、原生模块、`screencapture` 之类）在 CI 里不可见。

- 改法：① `build.yml` 每条腿在打包前跑该平台的 desktop 单测（已有 `--ignore-scripts`，需先补 postinstall 显式调用，见 O15）；② 给 `e2e.yml` 加 macos 腿（E2E 依赖 xvfb，mac/win 需分别处理无头策略，先只做 mac）；③ 加覆盖率报告（两包都装了 `@vitest/coverage-*`、引擎有 `coverage` 脚本，但**没有任何阈值与 CI 门槛**），先只报不卡；④ 补第五/六梯队新能力的 E2E 锚点（见下）。
- E2E 覆盖实况（本轮 `grep` 全部 63 个 desktop spec 得出）：菜单条/布局开关/侧栏/TOC **有**覆盖——`menu-sanity.spec.ts`、`layout-toggles.spec.ts`、`issue-2421-sidebar-state.spec.ts`（最近一条 `69bffe1` 刚把它重锚到 V1 树 DOM）、`toc-*.spec.ts` ×4、`editor-input.spec.ts`。但 Phase 1/2 的新能力**零** E2E：阅读时长、大纲跟随高亮、模式切换保滚动、GitHub Alerts、定义列表、行内注释、`[toc]` 块，在 `test/e2e` 下均无匹配选择器或文案——WORKPLAN 自己在三处"验证"段落里写的就是"e2e（Playwright）未跑"。
- 验收：故意引入一条仅 Windows 失败的路径断言，PR CI 应红；④ 的部分要求上述 7 项各有至少一条结构断言。

**O15 · 补丁链有个静默缝隙** — 成本 S
两个 `.patch` 靠 `scripts/postinstall.ts:152` 手工 `patch-package`（cwd=`packages/desktop`），而 `.github/actions/setup/action.yml` 统一 `--ignore-scripts` → 只有 `build.yml`/`e2e.yml`/`release.yml` 显式重跑 postinstall 才打过补丁，`lint.yml`/`test.yml`/`validate-licenses.yml` 没有。`knip.json:5` 的 `ignoreDependencies: ["patch-package"]` 恰好把这条缝隙从死代码检测里遮掉了。

- 改法：迁到 pnpm 原生 `patchedDependencies`（当前 `pnpm-workspace.yaml` **没有这个键**），删掉 `knip.json` 里那条 ignore，让工具重新看得见。

**O16 · 工具脚本自身的小坏点** — 成本 S
`scripts/check-md-links.py:10` 的 `ROOT = dirname(abspath(__file__))` 指向 `scripts/` 而非仓库根，一跑即 `FileNotFoundError`（且只覆盖 README 与 `docs/i18n`，这解释了为何无工作流引用它）；`scripts/generateThirdPartyLicense.ts:7` 与 `validateLicenses.ts:6` `require('./thirdPartyChecker.js')` 而实文件是 `.ts`，全靠 tsx 后缀改写才没炸；`eslint.config.js:1-8` 直接 import 未声明在 `devDependencies` 的 `@eslint/js` 与 `globals`，靠 `shamefully-hoist` 兜住；`electron-builder.yml:11` 排除了两个不存在的文件（`eslint.config.mjs`、`dev-app-update.yml`）；根 ESLint ^9.39.4 与引擎 ^10.5.0、desktop Vite ^7.3.5 与引擎 ^8.0.16 大版本分裂。

- 改法：`check-md-links.py` 的 ROOT 改仓库根并接进 `lint.yml`；显式声明 eslint 插件依赖；补 `dev-app-update.yml`（`electron-updater` 已接在 `main/menu/actions/colamd.ts`，缺它无法本地验证更新流）；版本分裂先只做"记录 + 对齐计划"，不强行升。

### E 组·梯队复核新增（来自 §7）

**O17 · 新建文件行的缩进与兄弟行不一致** — 成本 XS，影响 低（视觉）
原判"45px 是已删除的侧栏图标条残留"——**误判**。真实成因：`.folder-name`（`treeFolder.vue:6`）与 `.side-bar-file`（`treeFile.vue:6`）都用 `padding-left: depth * 6 + 10` 缩进，唯独新建输入框自己用 `margin-left: depth * 5 + 15`——**属性和公式都不同**，于是必须再配一个魔数宽度去吸收 margin：`tree.vue` 用 `calc(100% - 45px)`（该处 `const depth = 0`，实际只吃 15px），`treeFolder.vue` 用 `70%`。

- 已排除的假阳性：`services/notification/index.css:152` 的 `calc(100% - 45px)` 与侧栏无关，属于 `.mt-confirm` 对话框，45px 是紧邻 `.confirm` 按钮区的预留。
- 修法拉齐到行约定：缩进走 `padding-left: depth * 6 + 10`，宽度 `100%` + `box-sizing: border-box`。`.rename` 输入框本就在带 padding 的行内，未动。
- 验收：`grep -rn "45px" src/renderer` 只剩 notification 与 `layout.ts:57` 注释；`depth * 5 + 15` 全仓归零。**像素效果仍需实机看**（多层 + 折叠文件夹里触发"新建文件"，左边缘与同层文件行对齐、右侧不溢出）——lint/typecheck/单测只能证明没改坏，测不了几何。

**O18 · 最近文档打不开时静默失败** — 成本 S，影响 中 — **已完成 `7bbedb5`（分支 `fix/open-failure-visible`）**

> **前提更正（两处）**：① 两条 open-path 通道**不是语义重叠**：`mt::menu::open-path`（send，`main/ipc/menu.ts:35`）经 `openFileOrFolder` 在 **ColaMD 内**打开（原生菜单、自绘菜单 `menu/menus.ts:249`、打开对话框共用同一函数），`mt::shell::open-path`（invoke，`main/ipc/shell.ts:37`）交**系统默认程序**，唯一调用方是图片目录设置里的"打开"按钮（`prefComponents/image/components/folderSetting/index.vue:100`）。按原改法"合并成一条"会把最近文档改成用外部程序打开。② "菜单里留着一条已失效的最近路径"不成立：两份 reader（`main/menu/index.ts:121-123`、`main/ipc/menu.ts:19-27`）读取时就过滤不存在的路径。真实剩下的只有"菜单构建之后、点击之前被删除"这一窗口的静默失败。

- 改法（已实施）：`openFileOrFolder` 的兜底分支由 `console.error` 改为经 `mt::show-notification` 报给该窗口（与 rename/move 失败同模式）；契约里给两条通道各补一行语义注释，免得下一轮又被判成重复。文案只新增标题 `dialog.openFailure`（11 份语言，值已各自翻译），消息复用既有的 `store.editor.fileRemovedOnDisk`，不新增长句翻译。
- 验收（更正后）：原写的"E2E 点一条指向已删除文件的最近文档"**做不到**——reader 会把它过滤掉，构造不出该菜单项。改为单测 `open-path-failure-notification.spec.ts` 锁通知载荷，并用既有 `rename-failure-notification.spec.ts`（E2E，本地真窗口通过）证明这条通道真能渲染出通知条。

**O19 · 11 个偏好键只活在渲染端** — 成本 S，影响 中
实测：渲染端 store 默认态有 87 个键，其中 **10 个既不在主进程 `main/preferences/schema.json`、也不在 `static/preference.json`**——`installedThemes`、`typewriter`、`focus`、`sourceCode`、`imageFolderPath`、`deleteUnreferencedImages`、`webImages`、`cloudImages`、`currentUploader`、`cliScript`；另有 `treePathExcludePatterns` 只在 static 有、schema 没有。其中 `webImages`/`cloudImages` 由 dataCenter 单独存，属设计如此；但 **`imageFolderPath` 连 schema 声明都没有，正是 O7 那个扩权漏洞的根因**——`mt::set-user-preference` 对它没有任何类型或路径校验。

- 改法：把确实需要主进程可见的键（`imageFolderPath`、`deleteUnreferencedImages`、`treePathExcludePatterns`）补进 schema 并加约束；纯渲染端瞬态键（`typewriter`/`focus`/`sourceCode`/`installedThemes`）单列一处声明，写明刻意不进 schema，别让下一轮审计再猜一遍。
- 验收：一个小脚本比对三处键集，差集必须落在显式白名单内；`imageFolderPath` 有 schema 约束后，O7① 的对话框收敛才算拿到类型层背书。

### F 组·全仓体检新增（2026-09-19，测量方法见 `docs/PROJECT_GUIDE.md` §13）

**O20 · 收敛多余的 export 关键字** — 成本 S，影响 低（可维护性），**部分完成 `cab7cb8`（分支 `cleanup/redundant-exports`）**
`knip --workspace packages/desktop` 全量报未使用导出与未引用类型（在 `develop` 上重跑为 48 + 46；早前一次快照记作 47 + 48，差一个 `FileSearcher` 的归属）。实测必须分成三类，处置完全不同：

- **49 处确属"export 多余"**——去掉关键字后符号仍被本文件使用（如 `main/contextMenu/editor/menuItems.ts:76-83` 的 `CUT`…`INSERT_AFTER` 在本文件构建菜单、`shared/types/preferences.ts` 的 13 个字面量类型）。**已全部处理**：21 文件、49 行成对增删。
- **29 处是"去掉 export 后连本文件都不引用"的真死代码**——原样保留并移交 O13（清单见该条）。它们不是多余关键字，是实现本身没人用。
- **1 处跨分支冲突**：`node/ripgrepSearcher.ts:144` 的 `FileSearcher`，quick-open 分支要 `import { FileSearcher }`，在此去掉 `export` 会在合并时编译失败，已显式排除。
- 验收与证据：`pnpm typecheck` 0 错、`pnpm test` 61 文件 / 863 通过 + 1 跳过（与 develop 基线逐项相同）、`pnpm lint` **149 warnings / 0 errors 不变**。等价性用"develop 版与提交版各剥 `export`、抹平空白后逐字符比对"证明；2 个文件（`common/filesystem/paths.ts`、`common/i18n.ts`）另带钩子 prettier 对 develop 既有超长行的重排，token 内容一致。
- **教训**：warning 数"变好"和"变差"一样要解释。本轮曾因还原脚本给 2 个 develop 里本就无 `export` 的符号（`versionHistory` 的 `SnapshotLabel`、`codeMirror/index.ts` 的 `getModeFromName`）加上 `export` 而短暂得到 147，等于悄悄扩大模块 API 并掩盖 2 条既有告警，已在提交前撤回。

**O21 · 桌面包补长度与复杂度门** — 成本 S，影响 中（防止再长回上帝文件）
实测 >100 行的函数：`store/project.ts:82`（setup，313）、`editor.vue:1864`（onMounted，279）、`main/app/index.ts:247`（ready，240）、`editor.vue:1358`（handleExport，158）、`main/ipc/ripgrep.ts:181`（158）、`util/theme.ts:61`（addThemeStyle，153）、`lazyMarkdownPipeline.ts:66`（144）、引擎 `blockTransforms.ts:20`（297）。引擎侧有 `max-lines-per-function ≤ 200` 与 `complexity ≤ 20` 警告，**桌面包一条都没有**，所以这些永不报修。

- 改法：在根 `eslint.config.js` 的桌面包块加 `complexity` 与 `max-lines-per-function`，阈值按现存最大值定、先只 warn；O12 每分解一步就下调一档。
- 验收：新阈值下 warning 数量可解释；后续 PR 不得新增超线函数。

**O22 · Markdown 扩展名清单两处会漂移** — 成本 S，影响 中 — **已完成 `76e5a92`（分支 `fix/markdown-extension-single-source`）**
`common/filesystem/paths.ts` 的权威清单与 `preload/index.ts` 内联的十一项副本各一份：两份只要有一处改动，某个扩展名就会在渲染端静默失效，而当时没有任何测试比较过它们。

> **前提更正**：本项原写"不能简单合并，preload 刻意只依赖 `electron`+`pathe`，import `common/` 会破坏该约束"。实测该约束针对的是 **Node 内置模块**（`paths.ts:1` 确实 `import fs`），而 `electron.vite.config.ts` 的 preload 段本来就配了 `common` 别名。因此不必按原计划"经 `mt::boot-info` 下发"（那会让一个编译期常量依赖同步握手：握手为空时 `hasMarkdownExtension` 会全部返回 false），改成把清单挪进零 import 的叶子模块。

- 改法（已实施）：新增 `common/filesystem/markdownExtensions.ts`（无任何 import，含 `MARKDOWN_EXTENSIONS`/`MARKDOWN_INCLUSIONS`/`hasMarkdownExtension`），`paths.ts` 原样再导出以免改动调用方，preload 直接 import 该叶子模块并删掉内联副本；清单不再走 IPC，`BootInfo.MARKDOWN_INCLUSIONS` 字段与主进程侧的填充一并删除。
- 验收（已达成）：`test/unit/specs/markdown-extension-single-source.spec.ts` 用空 boot 握手加载真实 preload，断言暴露的 `MARKDOWN_INCLUSIONS` 与权威清单逐项相等、且 `hasMarkdownExtension` **就是**权威那个函数；全仓 `mdown` 字面量生产代码只剩一处（另一处在该 spec 的夹具里）。构建产物核对：`out/preload/index.js` 内联该数组、`out/main/index.js` 已无此常量；`launch`+`context-isolation`+`security-path-scope` E2E 8 例在真窗口下通过。

**O23 · 文件名拼写错误** — 成本 XS，**已完成 `48e4b1d`**
`renderer/src/codeMirror/mltiplexMode.ts`（`mltiplex` 应为 `multipl`）。导入方 `codeMirror/index.ts:11` 沿用同一个错名，符号本身 `multiplexMode` 是对的。改法：`git mv` + 改一处 import，与 O20 同批。

**O24 · knip 只看依赖，其余全在盲区** — 成本 S，影响 中（工程门禁）

`pnpm knip` = `knip --workspace packages/desktop --dependencies`，只报未使用依赖；文件级、导出级、类型级都不看——O20 那 95 项是本轮手工跑全量才浮出的。

- 改法：去掉 `--dependencies` 限制，全量结果先进 `lint.yml` 以报告形式产出（不卡），稳定后再改为阻断。
- 验收：CI 日志里能看到未用文件/导出/类型三段；`knip.json` 的忽略项逐条有理由注释。

**O25 · `main/windows/editor.ts` 独占 31% 的非空断言** — 成本 M，影响 中
144 处 `no-non-null-assertion` 里该文件占 44 处，且模式高度单一：`win!`、`this.id!`、`this.bufferStoreInfo!`、`this._markdownToOpen!`——都是"构造后必定非空"的字段。

- 改法（两步，各自可 revert）：① 能构造期填写的字段改成必填，让类型系统承担；② 真可能为空的路径在函数开头一次性窄化（`if (!win) return`），后续不再逐行 `!`。
- 验收：`pnpm lint` 的 144 基数降到 ≤100，**且不得靠新增 `eslint-disable` 达成**；每条消除要能说出运行时为何非空。

**O26 · `prettier --check` 在本 checkout 里对任何文件都报警** — 成本 XS，影响 中（会误导后续门禁）
根 `.prettierrc.yaml` 没设 `endOfLine`（默认 `lf`），而 git 的 `core.autocrlf` 使工作副本为 CRLF：`git ls-files --eol` 显示 `i/lf w/crlf`。实测完全未改动的 `codeMirror/modes.ts`、`codeMirror/overlayMode.ts`、`util/pdf.ts` 一并报 warn，而 index 中存的是 LF。

- 后果：若把 `prettier --check` 接进 CI，会对全仓历史文件 100% 假红；本轮 WORKPLAN 与两个源文件被重排数百行也是同一成因。
- 改法：`.prettierrc.yaml` 加一行 `endOfLine: auto`，之后再谈把 `--check` 纳入门禁；不要全仓 `--write` 刷一遍。

**O27 · 四条本地化键在 10 份语言里仍是英文** — 成本 XS，影响 低—中（2026-09-20 实施 O18 时实测）
`dialog.renameFailure`、`dialog.moveFailure`、`store.editor.errorWhileRenaming`、`store.editor.errorWhileMoving` 的值在 **11 份语言里全部与英文逐字相同**（同一对照下 `dialog.saveFailure`、`store.editor.errorWhileSaving` 都已翻译，我本轮新增的 `dialog.openFailure` 也逐语言写了译名）。也就是说重命名/移动失败弹窗在非英文界面下是英文串。

- 为什么门禁没拦住：`test/unit/specs/locale-validation.spec.ts` 查的是键齐、占位符齐、非空、术语拼写——**不查值是否等于英文**。
- 改法：补这 4 条的译名（10 语言 × 4 串），并把"值与 en.json 逐字相同"作为**告警**（非阻断）加进该 spec；告警而非阻断，是因为专有名词类的确可能合法同值。
- 验收：告警数从 4 降到 0（或每条有豁免理由）。

## 4. 分期 PR 路线

**第一批 · 一天内可全清（零架构风险，先把实锤 bug 和噪音关掉）**

| PR    | 内容                                                                                                                  | 依赖       |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ---------- |
| PR-1  | O1 quickOpen 具名导入 + 单测锁住发出的检索载荷（`mode: files`）；顺带让 `FileSearcher` 有引用，O13 的"孤儿"判定变干净 | 无         |
| PR-2  | O2 + O5 + O11 + O17（四个 XS 小修，一 PR 收）                                                                         | 无         |
| PR-3  | O3 `startUpAction` 值域下沉 `shared/types`，并去掉宽松的 `string` 兜底类型                                            | 无         |
| PR-4  | O16 工具小坏点（`check-md-links.py` 接入 CI、eslint 插件显式化、`dev-app-update.yml`）                                | 无         |
| PR-5  | 本文与 `docs/PROJECT_GUIDE.md` 的口径校准；旧两份文档顶部加指引                                                       | 前四条合完 |
| PR-21 | O26 `.prettierrc.yaml` 设 `endOfLine: auto`                                                                           | 无         |
| PR-23 | O27 四条英文残留译名 + locale 同值告警（2026-09-20 补进第一批）                                                       | 无         |

**第二批 · 一到两周（信任边界与响应性，需要设计确认）**

| PR        | 内容                                                                                                                  | 依赖                         |
| --------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| PR-6      | O8 契约双向化 —— **①已实现** `cba0836`；②载荷归属并入 O7②                                                             | 建议 PR-1 先合，作为回归样例 |
| PR-7      | O7① `imageFolderPath` 收进原生对话框 + O19 补 schema 声明（同族：先声明再约束）                                       | O8 的通道类型收窄先落        |
| PR-8      | O7② 读通道路径域                                                                                                      | PR-7                         |
| PR-9      | O9 批量写入合并广播 —— **已实现** `perf/preference-broadcast`（`2d56e65`+`300d03c`）                                  | 无                           |
| PR-22     | O22 Markdown 扩展名单一来源 —— **已实现** `fix/markdown-extension-single-source`（`76e5a92`）                         | 无                           |
| PR-11     | O4 空实现取舍（实现或摘入口）+ O18 最近文档失败可见性 —— **已实现** `fix/open-failure-visible`（`7bbedb5`+`f3e13be`） | 无                           |
| ~~PR-10~~ | ~~O6 图片补全缓存失效 + 有界~~ — **取消**：缓存本来就会重建（见 O6 前提更正），残余是有界性且未测出量级               | —                            |
| ~~PR-12~~ | ~~O10 `isSamePathSync` 去阻塞~~ — **取消**：不在热路径（见 O10 撤下说明）                                             | —                            |

> 第二批补记：O22 原本漏在 §4 表外（只在 §3 有条目），本轮以 PR-22 编号补进表内。O6/O10 从第二批移出，移出理由写在各自条目的更正段里，不另开"已删除"章节。

**第三批 · 持续投入（结构性，不设截止）**

| PR     | 内容                                                                 | 说明                                                 |
| ------ | -------------------------------------------------------------------- | ---------------------------------------------------- |
| PR-13… | O12 上帝文件分解（store 提 services → 拆 composable，每步 E2E 全绿） | 每步可独立 revert，禁止与功能改动混提                |
| PR-14  | O14 CI 矩阵与覆盖率报告                                              | 依赖 O15 先解决补丁，否则加平台腿会因未打补丁而假红  |
| PR-15  | O15 补丁迁到 `patchedDependencies`                                   | PR-14 的前置                                         |
| PR-16  | O13 死代码清理                                                       | 放在最后做：前面几批会改变引用关系，早期判定不稳     |
| PR-18  | O20 去多余 export + O23 `mltiplexMode.ts` 改名                       | 先跑 knip 全量取基线；只删 `export` 关键字，不删实现 |
| PR-19  | O21 长度/复杂度 warn 门 + O24 knip 全量进 CI                         | O24 的基线要在 O20 清完后重取，否则忽略清单会膨胀    |
| PR-20  | O25 `main/windows/editor.ts` 非空断言收敛（144 → ≤100）              | 独立于分解工作，但要在 O12 之前做，避免同一文件双改  |

**推进纪律**

1. 一批一分支一 PR，目标分支 `develop`（`CLAUDE.md:256`）。
2. 每个 PR 的验收命令写进描述，并至少包含 `pnpm lint && pnpm typecheck`；触及渲染进程的加 `pnpm test:unit`，触及跨进程行为的加相关 `test/e2e` spec。
3. O12/O13 这类"不改行为"的清理，PR 描述必须显式列出**它验证过不是跨文件动态引用**的方法（`listenBoth()` bus 名、菜单 id、`getMenuItemById`）。
4. 动 O7/O8 之前先跑 §1 的两条基线命令，把改动前面板数字抄进 PR，避免优化完发现退化。
5. 能在单测层锁住的契约优先用单测：`test.yml` 跑 ubuntu + windows 两腿，`e2e.yml` 只有 ubuntu，而 E2E 覆盖不到的平台恰是缺陷高发的平台；E2E 留给必须真窗口、真进程的行为。

## 5. 明确不做

| 项                                                  | 理由                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 渲染分片 / 虚拟滚动优先于其它                       | M1.3 已用剖析证明 `setContent` 瓶颈在解析管线（已修到 28.2ms），WORKPLAN 记"渲染分片暂不需要"。无新证据不重开                        |
| 把 E2E 铺到 5 平台                                  | 只做 mac（O14②）。Windows E2E 的无头与原生模块成本高于收益，先靠 `test.yml` 的 windows 单测腿兜                                      |
| 统一两包 ESLint/Vite 大版本                         | 引擎侧 antfu + ESLint 10 自成体系且根 ESLint 明确忽略 `packages/muya/**`；强行对齐的收益 < 回归风险（O16 只做记录）                  |
| 给 `getClipboardHtml` / `getHighlightHtml` 去 O(n²) | `perf-baseline.md` M1.3 判读：只处理选区/剪贴板级内容，不在文档级热路径                                                              |
| 给图片补全缓存加失效或 LRU（O6）                    | 缓存本来就随 `'rename'` 重建（`imagePathAutoComplement.ts:67-91`）；残余只是按目录只增不减，量级未测出，加淘汰机制是先写成本后写需求 |
| 去掉 `isSamePathSync` 的同步回落（O10）             | 只在大小写异体路径上触发，调用方全是离散用户动作（见 O10 撤下说明）；缓存规范化结果要给非热点加一层失效逻辑                          |
| 裁定功能路线图                                      | 按本文定位排除，见开头声明                                                                                                           |

## 6. 与既有文档的关系

| 文档                                  | 状态                                                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PROJECT_GUIDE.md`               | 项目结构与模块地图（同一基线）。优化项以本文为准，"东西在哪"以那份为准                                                                                    |
| `CODE_REVIEW_AND_ROADMAP.md`          | 保留为历史证据（生成于 2026-09-07，审查基线 `cd9ab53`）。顶部加指引，正文不改——它的判断过程本身有价值                                                     |
| `ColaMD_WORKPLAN.md`                  | 记录到 PR #32，含 M1/UI/Phase 1-3 的实施注记与 Windows 环境注意。七个梯队的"已完成"自述复核见 §7；其"未提交"标注与 git 实际状态不符，顶部加指引，正文不动 |
| `BUGLIST.md`                          | 2026-09-15 审计，全部已修，无需续写                                                                                                                       |
| `packages/muya/docs/perf-baseline.md` | 性能数字的事实来源，本文件只引用不复制；后续性能类优化必须先更新它                                                                                        |

## 7. 附录 · ColaMD_WORKPLAN.md 梯队自述复核

复核口径：**每条"✅ 已完成"都要能在代码里定位到它声明的落点**；性能与测试数字为重跑实测（`vitest run`，两包退出码均为 0），不采信文档自述。审查范围含全部七个梯队（第四、五梯队为逐项深挖，其余为落点抽查）。

| 梯队                  | 自述                                           | 判定            | 核对结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 一 · 性能专项 M1      | M1.0–M1.4 已合并，1MB 击键管线 P95 < 16ms 达成 | ✅ 成立         | `packages/muya/docs/perf-baseline.md` M1.2b/M1.3 两轮（1MB `edit+flush` p50 2.9 / p95 4.0ms；`setContent` 8489.9→28.2ms）；bench 在 `src/state/__tests__/keystrokePipeline.bench.spec.ts`；节流常量在 `store/bufferedState.ts:18-19`                                                                                                                                                                                                                                                                                                  |
| 二 · DOCX 导出 M4     | M4.1–M4.3 完成，零新依赖                       | ✅ 成立         | `util/exportDocx.ts` + `util/docx/{document.ts,zip.ts}` 均在；主进程落盘分支见 `docs/PROJECT_GUIDE.md` §9                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 三 · 图片引用清理     | IMG.1–IMG.3 完成，默认关                       | ✅ 成立         | `util/imageCleanup.ts`、`store/editor.ts:545`（开关判定）+ `:543-596`（5s 延迟 unlink）；⚠️ 但该开关键不在主进程 schema，见 O19                                                                                                                                                                                                                                                                                                                                                                                                       |
| 四 · 界面 Typora 化   | UI.1–UI.5 全部 ✅                              | ⚠️ **三处失真** | ① UI.1 声称"标题栏去面包屑"，实际 `components/titleBar/index.vue:27-31` 现渲染 `crumb-project` + `crumb-sep` + `filename` 面包屑——被后来的 V1 提交 `2987c99` 覆盖，WORKPLAN 未回写；② UI.3b 声称"去 45px 图标条"，注释与代码一致（`store/layout.ts:57`），但新建输入框留下一套与兄弟行不同的缩进算法 → O17（原判"45px 是图标条残留"是误判）；③ UI.4/UI.5 的"亮色 + Dracula 实机走查通过""偏好入口确认可用"属人工验收，无产物不可复核                                                                                                  |
| 五 · Phase 1 快赢包   | P1.1–P1.7 完成                                 | ✅ 七条全中     | P1.1 `static/preference.json:56` `footnote: true`；P1.2 `muya/src/inlineRenderer/{rules,lexer}.ts` 有 `inline_math_latex`，桌面 `codeMirror/markdownMathMode.ts:86-87` 一次注册 `markdown-math` 与 `markdown-math-latex`（`:36` 的 early-return 不构成缺陷，两模式同批定义）；P1.3 `codeMirror/index.ts:4` searchcursor；P1.4 `muya/src/clipboard/__tests__/pasteUrlOverSelection.spec.ts` 在；P1.5 `util/sourceModeToc.ts:92` + `sourceCode.vue:309`；P1.6 `statusBar/index.vue:67`；P1.7 `editor.vue:1267` 且 560/849/1626 三处调用 |
| 六 · Phase 2 语法扩展 | P2.1–P2.5 完成                                 | ✅ 四条成立     | `block/commonMark/blockQuote/alert.ts`、`block/extra/defList/`、`block/extra/toc/`、`inlineRenderer` 的 `inline_comment` 均在；P2.5 自述"核实为已有能力，无需开发"——与 PROJECT_GUIDE §9 的链接点击路径一致。其自述遗留（alert 段落菜单转换入口、def-list Enter 续行）确为遗留，非虚假完成                                                                                                                                                                                                                                             |
| 七 · Phase 3 导出补全 | P3.1–P3.3 完成                                 | ✅ 三条成立     | `main/utils/pandoc.ts:81` `exportViaPandoc` 接 `main/menu/actions/file.ts:206`；`main/utils/imageExport.ts::exportDocumentImage` 接 `:213`；P3.3 的 PDF 主题路径 `util/pdf.ts:30` `getCssForOptions` + `actions/file.ts:185` `printBackground: true`。其自述"长图与 pandoc 真实转换需实机走查"仍未闭合                                                                                                                                                                                                                                |

### 三条全局偏差

1. **用例数自述是过期快照，且方向相反。** WORKPLAN 记"muya 1501 / desktop 855 全绿"；本轮实测 **muya 222 文件 / 1495 例通过**、**desktop 61 文件 / 863 通过 + 1 跳过（864）**。引擎少 6 例、桌面多 9 例——大概率是 `409188a`/`57e0e65` 两轮清理连带删测 + 后续补测。两套件当前**全绿**，但引用 WORKPLAN 里的数字前必须重跑。
2. **"未提交"标注整体过期。** §1「当前工作区状态（未提交）」与 §1.1「乱码修复（已完成，待提交）」描述的内容，都已在 `develop` 历史里（HEAD `9449f8f`）；本轮审查开始时工作区仅 5 项变更，全是本轮新增/修改的文档。
3. **E2E 缺口比自述更大。** 第五/六/七梯队三处"验证"段都写了"e2e（Playwright）未跑"——事实如此，且这些新能力（阅读时长、大纲跟随高亮、模式切换保滚动、GitHub Alerts、定义列表、行内注释、`[toc]` 块）在 63 个 desktop E2E spec 中**零覆盖**。已并入 O14④。

### 一处方法论提醒

第四梯队失真那三条，全是"完成之后又被后续提交改动，而计划文档没回写"。梯队式进度文档天然会漂移——若继续维护 WORKPLAN，只应在每个梯队末尾加一行"后续被 X 覆盖"的注记，不要重写正文（正文是历史证据）。
