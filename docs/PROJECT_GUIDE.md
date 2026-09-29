# ColaMD 项目说明文档

> 面向新贡献者的整体说明：项目定位、技术栈、仓库结构、运行时架构、模块地图、功能到代码的落点、构建与测试体系，以及当前代码与既有文档不一致之处。
>
> 内容全部以当前工作区代码为准（`main`，v0.1.4，2026-09-29）。路径与行为如与本文冲突，以代码为准并请回修本文。

## 1. 一分钟认识 ColaMD

| 项目   | 事实                                                                                    |
| ------ | --------------------------------------------------------------------------------------- |
| 是什么 | 桌面端所见即所得（WYSIWYG）Markdown 编辑器，Typora 风格的极简界面                       |
| 出身   | [MarkText](https://github.com/marktext/marktext) 的 fork（提交 `b18c5f2` 起），MIT 许可 |
| 形态   | Electron 42 + Vue 3 桌面应用；编辑引擎为同仓的独立包 `@muyajs/core`                     |
| 版本   | `0.1.3`（`package.json:3`），引擎 `@muyajs/core 0.2.0`，已发标签仅 `v0.1.0`             |
| 平台   | Windows x64/arm64、macOS x64/arm64、Linux（AppImage / deb / rpm / snap / tar.gz）       |
| 规模   | 桌面端 236 个 ts/vue 文件约 4.0 万行；引擎 220 个 ts 文件（不含测试）约 4.8 万行        |
| 协作   | 单一作者仓库（`git shortlog` 124 commits，全部同一作者），PR 合入 `develop`             |
| 仓库   | https://github.com/TheQYQ/ColaMD                                                        |

**易被误解的一点**：`README.md` 的 Features 段落沿用 MarkText 时期的宣传口径，其中至少三项与当前代码不符（见 §11.2）。看功能请以本文 §9 的定位表为准。

## 2. 技术栈

| 层次     | 选型                                                                              | 备注                                                            |
| -------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 语言     | TypeScript 5.9，`strict: true`                                                    | 桌面端 target ES2022 / `moduleResolution: bundler`；引擎 ES2020 |
| 桌面壳   | Electron ~42.1                                                                    | ABI `node-v146`（决定原生模块预编译目录）                       |
| 构建     | electron-vite 5 → `out/{main,preload,renderer}`                                   | 打包 electron-builder 26                                        |
| 前端     | Vue 3 + Pinia 3 + Vue Router 4 + Element Plus                                     | `createWebHashHistory`                                          |
| 编辑引擎 | `@muyajs/core`：`ot-json1` + `ot-text-unicode` + `snabbdom` + `marked` 16 + RxJS  | 见 §8                                                           |
| 源码模式 | CodeMirror **5**（不是 6）                                                        | `packages/desktop/src/renderer/src/codeMirror/`                 |
| 全文检索 | `@vscode/ripgrep`（主进程 spawn）                                                 | `packages/desktop/src/main/ipc/ripgrep.ts`                      |
| 测试     | Vitest 4（单测/一致性）+ Playwright（E2E，含 `_electron.launch`）                 | 见 §10                                                          |
| 包管理   | pnpm 10 workspace，`shamefully-hoist=true`                                        | Node ≥ 20.19                                                    |
| 质量门   | ESLint 9 flat（根）+ ESLint 10 antfu（引擎）+ Prettier + knip + husky/lint-staged | 两套 lint 体系互不覆盖，见 §10.4                                |

## 3. 仓库结构

pnpm workspace 声明了 **三个** 包（`pnpm-workspace.yaml:2-8`：`packages/*` 之外还显式列了 `packages/muya/examples` 与 `packages/muya/e2e`，只写 `packages/*` 的旧说法见 §11.2 那条已删的 `CLAUDE.md:43`）：

```
ColaMD/
├── package.json              工作区编排层：所有面向 CI 的命令都用
│                             `pnpm --filter colamd …` 代理到桌面包
├── pnpm-workspace.yaml       packages/* + muya 的 examples / e2e 两个子工作区，
│                             外加 allowBuilds、postcss 与 esbuild 两项 overrides
├── eslint.config.js          根 ESLint 9 flat config，显式忽略 packages/muya/**
├── knip.json                 只配了 ignoreDependencies / ignoreBinaries 两件事
├── scripts/                  7 个仓库级脚本（postinstall、minify-locales、许可证三件套、2 个 Python）
├── docs/                     长文档：本文 + UI_REDESIGN_GUIDE + 11 语种 README
├── dist/                     electron-builder 产物目录（git-ignored，CI 采集 `dist/*`）
└── packages/
    ├── desktop/              Electron 应用，包名 `colamd`
    │   ├── src/{main,preload,renderer,common,shared,types}
    │   ├── static/{locales,welcome,preference.json,icons}
    │   ├── build/            electron-builder 资源（图标、mac entitlements、NSIS installer.nsh）
    │   ├── patches/          pnpm 目录下手工维护的 2 个 .patch
    │   └── test/{unit,e2e}   82 个单测 spec + 65 个 E2E spec（2026-09-22 重数）
    └── muya/                 编辑引擎，包名 `@muyajs/core`（自成一体的工具链）
        ├── src/              block / state / inlineRenderer / editor / ui / …
        ├── test/spec/        CommonMark 0.31 + GFM 0.29-gfm 一致性套件
        ├── examples/         `muya-examples`，Vite vanilla-TS 演示（独立工作区）
        └── e2e/              `muya-e2e`，Playwright 真浏览器套件（独立工作区）
```

根目录没有 `src/`、`test/`、`static/`、`build/`——都在 `packages/desktop/` 里。

## 4. 运行时架构：三进程 + 一引擎

```
┌─ main（packages/desktop/src/main，Node 全权）──────────────────────┐
│ 窗口/菜单/原生对话框 · 文件系统与原子写入 · 偏好存储 · 会话缓冲 ·   │
│ 版本历史 · 拼写检查 · ripgrep 子进程 · 自动更新 · 路径安全域        │
└────────────▲───────────────────────────────┬──────────────────────┘
             │ typed IPC（mt:: 通道）          │
┌────────────┴───────────────────────────────▼──────────────────────┐
│ preload（src/preload/index.ts，单文件，sandbox: true）             │
│   contextBridge 暴露 11 个全局、约 80 个成员                        │
└────────────▲───────────────────────────────┬──────────────────────┘
             │ window.electron.* / fileUtils.* │
┌────────────┴───────────────────────────────▼──────────────────────┐
│ renderer（src/renderer，Vue 3 + Pinia，每个编辑器窗口一个进程）     │
│   界面与状态 · 命令面板 · 菜单 · 导出 · 主题 · i18n                 │
│   ├── @muyajs/core（WYSIWYG 所见即所得）                           │
│   └── CodeMirror 5（源码模式）                                     │
└───────────────────────────────────────────────────────────────────┘
```

编译口径：`main` 与 `preload` 编译为 **CommonJS**，`renderer` 只有 **ESM**（renderer 里禁止 `require()`）。`main`、`preload`、`renderer` 各自的 `webPreferences` 与构建差异见 §6.2、§10.1。

### 4.1 主进程启动时序（`src/main/index.ts`，116 行，只有顶层副作用）

1. `import './globalSetting'` 设置 `global.__static` → `setupExceptionHandler()`（同时启动 `crashReporter`）
2. `cli()` 解析 argv（`--user-data-dir`、`--safe`、`--disable-gpu`）→ `setupEnvironment(args)` → 初始化 `electron-log`
3. 单实例锁（macOS 与 dev 模式跳过）→ `registerSandboxIpcHandlers()` 一次性注册全部 IPC
4. `new Accessor(env)` 充当 DI 容器：`Preference → DataCenter → EditorBufferStore → VersionHistoryStore → CommandManager → Keybindings → AppMenu → WindowManager`
5. `new App(accessor, args).init()` 只 **注册** `app.on('ready' | 'second-instance' | 'open-file' | 'activate' | 'web-contents-created')`
6. `ready()` 先 `await _initializeLanguage()`（Windows 上必须在 ready 之后），再放开路径安全域根、应用主题、Dock/Jumplist，最后 `createWindow()`

两处非显然的"只跑一次"保护：Linux 用 `nativeTheme.once('updated')` 与 150ms `setTimeout` 赛跑来决定开窗时机（`app/index.ts:448-459`）；主题监听用 `_themeListenerRegistered` 标志（`:373`）。

## 5. 主进程模块地图（`src/main`，84 文件）

| 目录                 | 职责                                                                                                                                                                                          | 关键文件                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `app/`               | `App` 控制器：ready/second-instance、开窗、路径打开、约 15 个 IPC；`Accessor` DI；`WindowManager`（505 行）窗口注册与 `findBestWindowToOpenIn`                                                | `app/index.ts`(894)、`app/accessor.ts`、`app/windowManager.ts` |
| `cli/`               | argv 解析；dev 模式强制 userData 目录为 `colamd-dev`                                                                                                                                          | `cli/index.ts:13-16`                                           |
| `commands/`          | 主进程侧命令注册（多数命令在渲染端）                                                                                                                                                          | `commands/index.ts:66`                                         |
| `contextMenu/`       | 编辑区**原生**右键菜单，仅在 `isInsideEditor(params)` 时构建；拼写建议必须走 `context-menu` 事件（Electron#28684）                                                                            | `contextMenu/editor/index.ts:59,123`                           |
| `dataCenter/`        | 图片/截图目录与图片缓存清单（`electron-store`），含旧 uploader 值迁移                                                                                                                         | `dataCenter/index.ts:58-62`                                    |
| `editorBufferStore/` | **未保存标签内容的磁盘副本**，用于崩溃/会话恢复；放在主进程是因为 `App.ready()` 要在任何窗口存在之前枚举它们；写入 `write-file-atomic` + fsync + 每文件 promise 队列                          | `editorBufferStore/index.ts:174-190,225`                       |
| `filesystem/`        | 原子写、Markdown 读取与编码探测、每窗口 chokidar watcher                                                                                                                                      | `filesystem/watcher.ts`(513)                                   |
| `ipc/`               | 沙箱安全 handler 层，一域一文件，由 `ipc/index.ts:14-27` 统一注册                                                                                                                             | `ipc/{fs,menu,shell,ripgrep,window,i18n,fonts,…}.ts`           |
| `keyboard/`          | `native-keymap` 键盘布局监听 + 加速器→命令派发；用户 `keybindings.json`                                                                                                                       | `keyboard/index.ts:87`、`keyboard/shortcutHandler.ts`(276)     |
| `menu/`              | **两套并存**：`AppMenu` 为每个窗口构建原生 `Menu`（`:443-451`，`:552` 自称 HACKY）；无边框窗口另在渲染端渲染菜单条，需要原生弹出时用 `mt::menu::popup` 传 JSON 模板、`mt::menu::click` 回流   | `menu/index.ts`、`menu/{actions,templates}/`                   |
| `preferences/`       | **只存不窗**：`electron-store` + schema + 迁移 + 同步广播。设置窗口在 `windows/setting.ts`                                                                                                    | `preferences/index.ts:48-52,135`                               |
| `security/`          | `pathScope`：写/删/移动类操作的根目录白名单，`assertPathInScope` 走 realpath；读通道刻意不设限                                                                                                | `security/pathScope.ts:28-42`                                  |
| `spellchecker/`      | `session.*` 薄封装 + 5 个 `mt::spellchecker-*`；macOS 用系统拼写检查                                                                                                                          | `spellchecker/index.ts:46`                                     |
| `utils/`             | 内部事件封装、pandoc、离屏打印窗导出图片、图片路径自动补全、生成 GitHub issue                                                                                                                 | `utils/{internalIpc,imageExport,pandoc}.ts`                    |
| `versionHistory/`    | 按文件快照存储 `{userData}/version-history/{sha1(path)}.json`，上限 50 条并去重；5 条 `mt::version-history:*` 通道（读侧 4 条把 pathname 只当 store 键，不进 pathScope，理由见 handler 注释） | `versionHistory/index.ts:44-95`                                |
| `windows/`           | `base.ts` 定义 `WindowType`/`WindowLifecycle` 并用 URL query 把窗口类型传给渲染端；`editor.ts`(694) 编辑器窗                                                                                  | `windows/{base,editor,setting,utils}.ts`                       |

## 6. 跨进程边界

### 6.1 IPC 契约

`packages/desktop/src/shared/types/ipc.ts`（368 行）是单一事实来源，分四张表：`IpcInvokeChannels` 41、`IpcSendChannels` 82、`IpcSyncChannels` 2、`IpcMainEventChannels` 69。实测主进程注册 **41 个 `ipcMain.handle` + 64 个 `ipcMain.on`**，反向 `webContents.send` 约 94 处。

- 命名：`mt::` 是主流但不彻底（handle 40/41、on 58/63）。例外包括 `update-buffer-state`、`app-create-editor-window`、`menu-clear-recently-used`、`settings::change-tab`、`language-changed`，以及约 22 个用 `ipcMain.emit` 派发的 **进程内通道**（`broadcast-preferences-changed`、`window-close-by-id`、`watcher-watch-file`…）。
- `mt::` 内部层级也不统一：`mt::fs::read-file`（双冒号）vs `mt::fs-trash-item` vs `mt::version-history:save`。
- 类型强度：preload 侧泛型以 `keyof` 约束通道名（真安全）；但主进程 `ipcMain.handle('mt::fs::write-file', …)` 与契约 **没有类型关联**（Electron 给 listener 的是 `any[]`），且契约自身把部分载荷写成 `unknown`（`ipc.ts:10-12`）。改载荷结构不会被编译发现。分支 `refactor/typed-ipc-handle`（`3731a74`）用 `src/main/ipc/typedHandle.ts` 把 41 个 handle 通道绑回契约，并用根 `eslint.config.js` 第 11 节禁止绕行；接线当场暴露 8 条**本来就写错**的契约声明（最实的一条：`mt::ask-for-image-path` 声明 `string[]`，实际答单个路径），清单见已退役的优化路线图（git 历史可考，v0.1.4 之前）。

### 6.2 preload 与沙箱（当前真实状态）

`src/preload/index.ts:282-292` 暴露 12 个全局，约 80 个成员：`electron`（`ipcRenderer` 6 个函数、`shell` 3、`clipboard` 3、`webFrame` 1、`webUtils` 1、`windowControl` 9、`dialog` 4、`process`/`paths`/`isUpdatable`）、`process`（shim 7 键）、`rgPath`、`fileUtils` 14、`path` 12（`pathe` 支撑）、`commandExists`、`i18nUtils`、`ripgrep` 6、`uploader`、`versionHistory`、`fonts`。启动时一次阻塞的 `ipcRenderer.sendSync('mt::boot-info')`（`:36`）。该握手原先还捎带 Markdown 扩展名清单（O22）：清单改由零依赖模块 `common/filesystem/markdownExtensions.ts` 直接进包后，`BootInfo` 少了一个字段、`fileUtils` 的 14 个成员里有 2 个不再依赖握手结果。

三类窗口全部 **`contextIsolation: true` + `sandbox: true` + `nodeIntegration: false`**（`src/main/config.ts`，编辑器窗 L12/13/18，偏好窗 L40/41/44，离屏导出窗 `utils/imageExport.ts:32-34`）。开发态放宽 `webSecurity` 以便 Vite dev server 加载 `file://` 图片，生产恢复全量同源策略。`app/index.ts:133-143` 拒绝 `will-attach-webview`、`will-navigate`、`setWindowOpenHandler`。

> 渲染端全局变量的类型声明在 `src/types/global.d.ts`，新增桥接方法要同时改契约、preload、ambient 三处。

## 7. 渲染进程地图（`src/renderer`，216 文件 / 47 `.vue` + 89 `.ts`）

### 7.1 启动与路由

`src/index.html` → `src/main.ts`。`bootstrapRenderer()`（`bootstrap.ts:101`）从 URL query 解析 `wid/type/udp/theme/cff/cfs/hsb/tbs`，注册全局错误处理（含一处 CodeMirror 竞态抑制 `:65`），构造 `RendererPaths`；随后 `createApp(Main)` 装 Element Plus（locale 硬编码 `en`）、Vue Router、Pinia、vue-i18n（`main.ts:33-48`），并 side-effect 引入 SVG sprite 与全局样式。`Main.vue` 只有一个 `<router-view/>`。

路由只有两页（`router/index.ts`）：`/editor` → `pages/app.vue`，`/preference` → `pages/preference.vue`（子路由 `general|editor|markdown|spelling|theme|image|keybindings`）。

### 7.2 状态（Pinia）

| Store                                                                | 文件                                                                                                                                                                                                                                               | 职责                                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `editor`                                                             | `store/editor.ts`（**924 行 / 79 条 action**，2026-09-26 重测；业务体已按簇搬进同目录的 `tabClose`/`fileSave`/`contentEvents`/`tabLifecycle`/`windowSession`/`imageCleanupActions`/`fileChange`/`selectionState`/`exportPrint`，这里留的是转委托） | 标签、当前文件、TOC、保存/导出/关闭/切换/自动存 —— 事实上的上帝 store |
| `preferences`                                                        | `store/preferences.ts`（348）                                                                                                                                                                                                                      | 全部用户偏好，经 `mt::set-user-preference` 同步                       |
| `project`                                                            | `store/project.ts`（394）                                                                                                                                                                                                                          | 打开的目录与文件树、新建/粘贴/重命名                                  |
| `commandCenter`                                                      | `store/commandCenter.ts`                                                                                                                                                                                                                           | 命令注册表 + `executeCommand`；`:53` 接收 `mt::keybindings-response`  |
| `layout` / `main` / `listenForMain` / `autoUpdates` / `notification` | 各自同名文件                                                                                                                                                                                                                                       | 面板可见性与宽度 / 平台与窗口激活 / IPC→bus 中继 / 自动更新 / 通知    |

同目录的非 store：`store/help.ts`（文件状态工厂 + O12 提出的换行归一与 crash-buffer 格式）、`store/tabOps.ts`（标签列表的纯规则：关闭后落点 / 循环环绕 / 拖放换算 / `file-changed` 载荷）、`store/bufferedState.ts`（会话缓冲，5s debounce / 30s maxWait）、`store/treeCtrl.ts`（树变更）。`help.ts` 与 `tabOps.ts` 分家的理由：前者处理**单个文件状态**的形状与默认值，后者是**标签列表的下标代数**，且只依赖一个类型。

**与引擎的耦合方式**：store 从不持有编辑器实例。`editor.vue:1468-1472` 用 `markRaw` 持有 `new Muya()`，再向 `editorStore` 推 `LISTEN_FOR_CONTENT_CHANGE`/`UPDATE_TOC`/`SELECTION_CHANGE`。跨模块解耦靠 mitt bus（`src/bus/index.ts`），`listenBoth()`（`:17`）一次注册同时挂 IPC 与 bus，于是原生菜单、窗口内菜单、命令面板共用同一条动作路径；`pages/app.vue:166-217` 挂载时注册约 30 个 `LISTEN_FOR_*`。

### 7.3 界面骨架

`pages/app.vue:2-45` 组合出 Typora 式外壳：

- 标题栏 `components/titleBar/index.vue`(362) —— 当前形态是 36px 面包屑标题栏（提交 `001ef24`）
- 菜单条 `components/menuBar/index.vue`(214) + `MenuList.vue`，模板来自 `menu/menus.ts`(724)，仅在 `titleBarStyle === 'custom' && !isOsx` 时渲染
- 侧边栏 `components/sideBar/index.vue`(206)，`files` / `toc` / `history` 三个 tab（`sideBar/help.ts:13-30`；历史 tab 于 2026-09-27 随版本历史面板回归，面板在 `sideBar/history.vue`）
- 编辑区 `components/editorWithTabs/index.vue`（含 `editor-search v-if="hasCurrentFile"` 的文档内查找条）
- 状态栏 `components/statusBar/index.vue`（左：源码模式开关；右：字数统计）
- 浮层：未保存对话框、命令面板、关于、导出设置、重命名、导入

最大的几个文件（2026-09-26 重测）：`components/editorWithTabs/editor.vue` 1768、`store/editor.ts` 924、`prefComponents/image/components/uploader/index.vue` 1186、`commands/index.ts` 766、`menu/menus.ts` 725、`prefComponents/theme/index.vue` 689、`util/docx/document.ts` 648、`sourceCode.vue` 628。改动这些文件请预期高冲突。

### 7.4 两个编辑面

`editorWithTabs/index.vue` 始终挂载 `<editor>`（Muya），`v-if="sourceCode"` 时并挂 `<source-code>`（CodeMirror 5，封装在 `codeMirror/index.ts`）。模式是 **全局偏好，不是每标签属性**；光标交接靠 `muyaIndexCursor` 与 `editor.vue:157` 的 `preSourceModeSelection`。两者共享同一份 `markdown` 与 bus 上的搜索事件，并用 `if (sourceCode.value) return` 互斥（如 `editor.vue:1198`）。

## 8. Muya 引擎（`packages/muya`，`@muyajs/core 0.2.0`）

引擎自带全套工具链（ESLint/antfu、stylelint、madge、vitest），根 ESLint 明确忽略 `packages/muya/**`。架构要点（完整版在 `packages/muya/ENGINE_GUIDE.md`）：

- `new Muya(el, options)` 替换目标元素为 `contenteditable` div，构造 `EventCenter`/`Editor`/`Ui`/`I18n`；`muya.init()` 里 `Editor.init()` 调 `registerBlocks()` 并创建根 `ScrollPage`。**新增块类型必须在 `src/block/index.ts::registerBlocks()` 注册，否则 `loadBlock` 返回 undefined。**
- UI 插件通过静态 `Muya.use(Plugin, options)` 全局注册、按 `pluginName` 存进 `muya._uiPlugins`；`examples/src/main.ts` 是权威装配样例。
- `Editor`（`src/editor/index.ts`）持有 `JSONState`/`InlineRenderer`/`Selection`/`Search`/`Clipboard`/`History`/`ScrollPage`，把 `click/input/keydown/keyup/composition*` 经 RxJS 合并后路由给当前活动块。`Editor.updateContents()` 手写 `ot-json1` 的 pick/drop walk，使块树与 JSON 状态同步。
- 块继承链 `TreeNode → Parent → (Content | Format)`；`Parent` 持有 `LinkedList` 子节点与 `attachments`。具体块在 `src/block/{commonMark,gfm,extra,content}`。
- Markdown 往返：`markdownToState`（`marked`）/ `stateToMarkdown` / `markdownToHtml` / `htmlToMarkdown`（`turndown` + gfm 插件）。引用式链接定义 **不是** 一等块类型，`case 'def'` 把原始定义行塞回 paragraph 以保证往返无损。
- 撤销栈是真 OT（`invertWithDoc`/`compose`、时间与词边界合并、IME 恒等 op 防护），不是快照栈；架构上为协同编辑预留了 `transform`，但 **没有任何 transport 接上**。
- 内联渲染：自写 lexer/rules + `snabbdom` 虚拟 DOM，集成 KaTeX、Prism、Mermaid、Vega/Vega-Lite、PlantUML。
- 排版契约：`IMuyaOptions` 的 6 个选项与 `--mu-*` CSS 变量一一对应（`packages/muya/ENGINE_GUIDE.md` 有完整表），运行时改动一律走 `muya.setOptions({...})`。
- 子目录规模（ts 文件）：`block` 117、`ui` 49、`inlineRenderer` 46、`state` 38、`clipboard` 35、`selection` 20、`editor` 8、`history` 6、`utils` 65。

## 9. 功能 → 代码定位表

| 功能                     | 落点                                                                                                                                                                                                                                                                                                                                                                                                            | 状态                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 命令面板 `Ctrl+Shift+P`  | `components/commandPalette/index.vue`(502)；派发链 `main/menu/actions/view.ts:42` → bus `show-command-palette`                                                                                                                                                                                                                                                                                                  | ✅                                                                                                                                                        |
| 快速打开 `Ctrl+P`        | `commands/quickOpen.ts` → `node/ripgrepSearcher.ts`                                                                                                                                                                                                                                                                                                                                                             | 已修：具名导入 `FileSearcher`（`mode: 'files'`），由 `quick-open-file-name-search.spec.ts` 钉住；§11.1-1 只留成因。查询→`RegExp` 那一面的代价与退化见 §15 |
| 文档内查找/替换          | `components/search/index.vue`(506)，`editorWithTabs/index.vue:23` 挂载                                                                                                                                                                                                                                                                                                                                          | ✅                                                                                                                                                        |
| 文件夹全文搜索           | 主进程管道齐备（`main/ipc/ripgrep.ts` 流式 `mt::rg::*`），`RipgrepDirectorySearcher` 可复用                                                                                                                                                                                                                                                                                                                     | ❌ 无 UI（`cdebf68` 随侧栏搜索面板下线）                                                                                                                  |
| 目录 / TOC               | `components/sideBar/toc.vue` + `util/{tocKeys,tocNavigation,sourceModeToc}.ts`；数据来自 `muya.getTOC()`                                                                                                                                                                                                                                                                                                        | ✅                                                                                                                                                        |
| 版本历史                 | 主进程 `main/versionHistory/`（`mt::version-history:save/list/get-content/delete/clear` 五条通道）+ `store/editor.ts:875,904`（`SAVE_VERSION_SNAPSHOT` / `LISTEN_FOR_VERSION_RESTORE`）+ 侧栏面板 `components/sideBar/history.vue`                                                                                                                                                                              | ✅ 面板于 2026-09-27 落地；列表通道只传元数据（不含正文），预览/恢复按需取 `get-content`                                                                  |
| 主题                     | CSS 在 `renderer/src/assets/themes/*.theme.css`（实测 32 个），登记于 `prefComponents/theme/config.ts`，注入 `util/theme.ts:61`，CSS 变量生成 `util/themeColor.ts`，菜单 `menu/menus.ts:203-242`                                                                                                                                                                                                                | ✅                                                                                                                                                        |
| 主题"市场"               | `util/themeMarket.ts`（本地 `.colamd-theme` JSON 清单校验/序列化）+ `util/themeRegistry.ts`；导入导出在 `prefComponents/theme/index.vue:67-125`                                                                                                                                                                                                                                                                 | ⚠️ 纯本地，**没有** 在线市场                                                                                                                              |
| 快捷键                   | 加速器在主进程 `main/keyboard/keybindings*.ts`；编辑 UI `prefComponents/keybindings/*`；渲染端镜像 `store/commandCenter.ts:53`                                                                                                                                                                                                                                                                                  | ✅                                                                                                                                                        |
| 专注 / 打字机 / 源码模式 | `store/preferences.ts:119-120`、类名 `editor.vue:4`、开关 `commands/index.ts:599-615`                                                                                                                                                                                                                                                                                                                           | ✅                                                                                                                                                        |
| 图片粘贴与清理           | `components/editorWithTabs/useEditorImages.ts:23`（`editor.vue:701` 解构、`:1471` 把 `imageAction` 交给引擎）、`util/imageCleanup.ts`（纯逻辑）+ `store/imageCleanupActions.ts:29,92`（延迟 5s unlink 与排队）                                                                                                                                                                                                  | ✅                                                                                                                                                        |
| 导出                     | 渲染端入口 `editor.vue:1358 handleExport`；落盘分支在主进程 `main/menu/actions/file.ts`：`styledHtml`/`pdf` 走 `util/{exportHtml,pdf}.ts` + `services/printService.ts`，`docx` 走 `util/exportDocx.ts` + `util/docx/`，`epub`/`latex`/`rtf`/`opml` 走 `main/utils/pandoc.ts::exportViaPandoc`（`:206`，缺 pandoc CLI 时预检并提示），`png`/`jpeg` 走 `main/utils/imageExport.ts::exportDocumentImage`（`:213`） | ✅ 8 种，其中 4 种依赖外部 pandoc                                                                                                                         |
| Front matter             | `preferences.frontmatterType`、`editor.vue:665,1919`、`menu/menus.ts:480`、`commands/index.ts:377`                                                                                                                                                                                                                                                                                                              | ✅                                                                                                                                                        |
| 数学 / 图表              | 引擎内渲染（KaTeX/Mermaid/Vega/PlantUML）；渲染端只配主题与 `plantumlServer`（`editor.vue:621-641`、`preferences.ts:211`）                                                                                                                                                                                                                                                                                      | ✅（未见 flowchart 相关偏好）                                                                                                                             |
| 字数统计                 | `wordCount` 来自 `@muyajs/core`，`statusBar/index.vue` 展示词/段/字符/阅读时长                                                                                                                                                                                                                                                                                                                                  | ✅                                                                                                                                                        |
| 自动保存 / 会话恢复      | `store/contentEvents.ts:179`（`HANDLE_AUTO_SAVE` 的实体，store 里只剩委托）；`store/bufferedState.ts` + 主进程 `main/app/index.ts:290` 的 `startUpAction`                                                                                                                                                                                                                                                       | ⚠️ 枚举值跨进程不一致，见 §11.1-3                                                                                                                         |
| 拼写检查                 | `main/spellchecker/` + 5 个 `mt::spellchecker-*`                                                                                                                                                                                                                                                                                                                                                                | ✅                                                                                                                                                        |
| 自动更新                 | `electron-updater`，动作在 `main/menu/actions/colamd.ts`                                                                                                                                                                                                                                                                                                                                                        | ⚠️ `dev-app-update.yml` 缺失，本地无法验证更新流                                                                                                          |
| 国际化                   | 11 语种（`static/locales/`，各含 `.json` 与 `.min.json` 共 22 文件）。只打包 `en`，其余经 `mt::i18n::load` 惰性加载（`src/i18n/index.ts`，含在途去重与 `safeMessageCompiler`）                                                                                                                                                                                                                                  | ✅                                                                                                                                                        |
| 主题编辑器 UI 规范       | `docs/UI_REDESIGN_GUIDE.md`（V1，已落地于 `12de485`/`001ef24`/`b7e81bf`）                                                                                                                                                                                                                                                                                                                                       | ✅                                                                                                                                                        |

## 10. 构建、测试与 CI

### 10.1 构建管线

`packages/desktop/electron.vite.config.ts` 产三个目标到 `out/{main,preload,renderer}`：

- main：CJS，`externalizeDeps.exclude: ['electron-store','plist']`（plist 5 是纯 ESM，不排掉会 `ERR_PACKAGE_PATH_NOT_EXPORTED`），`include: ['native-keymap']`，注入 `COLAMD_VERSION(_STRING)`
- preload：CJS，把 `pathe` 排除外链，使沙箱 preload 只需 `require('electron')`
- renderer：ESM，`define: { global: 'globalThis' }`（dragula→custom-event 读 Node `global`），`assetsInclude: ['**/*.md']`，postcss-preset-env `stage: 0` 且关掉 `logical-properties-and-values`（#4673 RTL）

别名三处一致（vite / vitest / tsconfig）：`@`→`src/renderer/src`、`common`→`src/common`、`@shared`→`src/shared`，渲染端额外把 `path` 映射到 `pathe`；只有 `tsconfig.base.json:26-31` 还声明了 `main_renderer/*`。

electron-builder（`packages/desktop/electron-builder.yml`）：`appId com.colamd.app`，`directories.output: ../../dist` 让安装器落在仓库根 `dist/`（CI 通配 `dist/*` 因此仍然有效）。产物命名 `colamd-win-${arch}-${version}-setup.${ext}`；`npmRebuild: false`（rebuild 交给 postinstall）、`electronLanguages: [en-US]`、NSIS 走 `build/windows/installer.nsh`、mac `notarize: false`、extraResources 排除非 min locale、并用 `!*.log` 防 asar 偏移损坏。**没有 `publish:` 块**，所有 build 脚本都 `--publish never`，发布只在 `release.yml` 里做。

原生模块 `ced` 与 `native-keymap` 需要 C++20 工具链（VS Build Tools），因此列为 `optionalDependencies` + 由 `scripts/postinstall.ts` 驱动 rebuild；`packages/desktop/patches/` 里两个补丁分别给 `native-keymap` 打开 stdcpp20、给 `ced` 加预编译 `.node` 兜底。

两条开发循环上的注意（原 `CLAUDE.md` 的 Build Notes，删除前逐条对过代码）：**改 `main`/`preload` 的代码不会被窗口重载拾取，要重启 `pnpm run dev`**（只有渲染端接了 Vite HMR；`Ctrl+R` 那类重载只重跑 preload）；**换 Electron 版本后要跑 `pnpm run rebuild-native`**（`packages/desktop/package.json` 里就是 `electron-rebuild -f`），否则两个原生模块与新 ABI 不匹配。渲染端是纯 ESM，**不要在 renderer 代码里写 `require()`**。

### 10.2 根脚本

| 脚本                                                   | 作用                                                                                                                                                                                    | 何时跑                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `scripts/postinstall.ts`                               | 5 步：还原 `native-keymap` 源 → 下载 Electron（npmmirror 兜底 + macOS 重解压绕过 yauzl 问题）→ `patch-package` → `electron-rebuild -f`（两者 cwd 都是 `packages/desktop`）→ 压缩 locale | `pnpm install`                  |
| `scripts/minify-locales.ts`                            | 为每个 locale 生成 `.min.json`                                                                                                                                                          | postinstall 与每个 `build:*` 前 |
| `scripts/generateThirdPartyLicense.ts`                 | 生成 `build/THIRD-PARTY-LICENSES.txt`                                                                                                                                                   | 手工                            |
| `scripts/validateLicenses.ts` + `thirdPartyChecker.ts` | 同一份数据的 CI 校验，白名单在 `thirdPartyChecker.ts:32-33`                                                                                                                             | `validate-licenses.yml`         |
| `scripts/check-md-links.py`、`colamd-logo.py`          | 未被任何脚本或工作流引用（`colamd-logo.py` 生成 `build/icons`）                                                                                                                         | 手工                            |

### 10.3 测试规模

> 口径（2026-09-29 重数）：`spec 文件` 一列与 desktop 单测的用例量是当天实测（`find`/`pnpm test:unit` 退出 0），其余 `~用例量级` 仍是上一轮估算，别当基线引用。

| 套件                           | spec 文件 | 用例量级        | 配置 |
| ------------------------------ | --------- | --------------- | ---- |
| desktop 单测 `test/unit/specs` | 110       | 1207（+1 跳过） |

| desktop E2E `test/e2e` | 73（+12 个 `data/*.md`） | ~444 | `test/e2e/playwright.config.ts`，`workers: 1`，30s 超时 |
| muya 单测 `src/**/__tests__` | 224 | ~1398 | 默认配置在 `vite.config.ts`（引擎无独立 `vitest.config.ts`），`css: true` |
| muya 一致性 `test/spec` | 5 | ~670 CommonMark + 672 GFM + 11 往返 | `vitest.spec.config.ts`，happy-dom |
| muya E2E `e2e/tests` | 71 | ~323 | 独立工作区，`webServer` Vite :5174 载 `e2e/host/` |

一致性套件采用"只能变好"的钉死语义：`test/spec/expected-failures.json` 列了 78 个 CommonMark + 90 个 GFM 已知失败，**预期失败变成通过也会让套件失败**（`test/spec/runner.ts`），基线记录在 `test/spec/conformance.md`（CommonMark 88.0% / GFM 86.6%，2026-09-26 按 `expected-failures.json` 重算）。

E2E 通过 `_electron.launch` 起真应用（`test/e2e/helpers.ts:74`），会代点未保存对话框、经 `mt::handle-renderer-error` 统计渲染端错误、并用 `Menu.getApplicationMenu().getMenuItemById(id).click()` 驱动原生菜单。已知 `test.fixme`：`loose-list-toggle.spec.ts:54`、`view-modes.spec.ts:314`；`test.skip`：`paragraph-blocks.spec.ts:92,126`。

跑单条：

```bash
pnpm -C packages/desktop exec vitest run test/unit/specs/<name>.spec.ts
pnpm -C packages/desktop exec playwright test test/e2e/<name>.spec.ts
pnpm -C packages/muya exec vitest run src/<path>/<name>.spec.ts
```

### 10.4 CI 与质量门

12 个工作流（`.github/workflows/`；`claude.yml` 已于 2026-09-26 从 `develop` 移除。**这条通路是 2026-09-27 才真关掉的**：删除先落在 `develop`（`ba84e3b`），再由 **PR #41** 合进默认分支（merge `9637c8c`）——只删 `develop` 不算关掉，因为 `issue_comment` / `pull_request_review_comment` / `issues` / `pull_request_review` 这类触发跑的是**默认分支上那份定义**，注册表里它当时仍 `active`。合并后实测：`git ls-tree origin/main .github/workflows/` 为 12 份且无 `claude.yml`，`gh api .../actions/workflows` 的 `total_count` 从 13 变 **12**。它生前从未执行过一次（515 条历史 run 里 `Claude Code` 名下 **0 条**），仓库 **Actions secrets 总数 0**（`CLAUDE_CODE_OAUTH_TOKEN` 从未在此仓库配置），所以在那之前真正挡着它的只有 `github.actor == 'TheQYQ'` 守卫加缺 token）：

| 工作流                                         | 内容                                                                        | 触发                                                                    | OS                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `build.yml`                                    | postinstall + 全平台 `build:*`，上传 `dist/*`，PR 产物评论                  | PR（paths-ignore muya）/dispatch                                        | 5 腿矩阵：ubuntu、windows、windows-11-arm、macos-15-intel、macos-15 |
| `release.yml`                                  | 校验 `v*` 语义化标签 → 构建 → SHA256SUMS → 草稿 Release → 提升              | tag push                                                                | 同上 5 腿（Linux 用 ubuntu-22.04）                                  |
| `lint.yml`                                     | `pnpm lint` + `pnpm knip` + 引擎类型构建 + `typecheck`                      | PR + push `develop`（`paths-ignore: packages/muya/**`，两个事件同过滤） | ubuntu                                                              |
| `test.yml`                                     | desktop 单测 + 非阻断 `coverage`                                            | PR + push `develop`（同 `paths-ignore`）                                | **ubuntu + windows**                                                |
| `e2e.yml`                                      | apt 依赖 → postinstall → build → `xvfb-run test:e2e`                        | PR/dispatch                                                             | ubuntu-24.04                                                        |
| `muya-{build,circular,lint,test,spec,e2e}.yml` | 引擎构建、`madge --circular`、lint+类型、单测、一致性、Playwright(chromium) | PR                                                                      | ubuntu                                                              |
| `validate-licenses.yml`                        | `pnpm run validate-licenses`                                                | PR + push `develop`（package.json/lock 变更）                           | ubuntu                                                              |

`.github/actions/setup/action.yml`：pnpm/action-setup@v4.4.0 → setup-node@v4.4.0（node 22.21.1 + 缓存）→ `pnpm install --frozen-lockfile --ignore-scripts`。**`--ignore-scripts` 意味着补丁与 rebuild 只在显式重跑 postinstall 的 `build/e2e/release` 里发生。**

代码风格：根 ESLint 9 flat（`@eslint/js` + neostandard + typescript-eslint + vue + jsonc），2 空格、无分号、单引号、`no-explicit-any: error`、`consistent-type-imports`；两处自定义规则值得记住——第 10 节（`eslint.config.js:206-239`）在 `src/renderer/**` 禁用 `Buffer`/`process`/`__dirname`/`__filename`/`require`（起因是一次静默的 SAVE*VERSION_SNAPSHOT 故障），第 7 节给测试注入 Vitest 全局。引擎侧是 antfu 配置：4 空格 + 分号、接口必须 `I` 前缀、私有成员必须 `*` 前缀、`complexity ≤ 20`、`max-lines-per-function ≤ 200`、禁 `as unknown as`。注释规范见 `.github/COMMENTING-GUIDELINES.md`。提交前 `pnpm lint && pnpm typecheck`（`.husky/pre-commit` 已跑 lint-staged）。

## 11. 已核实的问题与文档偏差

### 11.1 代码缺陷（本文写作时实测）

下列十条是初次实测时的原样描述，**其中 1/2/3/6/7 已修掉，4 与 8 的原判定被撤回或降级，10 的写域自扩一半已闭、读域一半仍开**——全部条目已闭环或随 2026-09-29 的路线图退役一并关闭（处置理由在退役前版本的 git 历史可考）；本节保留的是缺陷成因描述。

1. **快速打开 `Ctrl+P` 退化为全文搜索。** `commands/quickOpen.ts:3` 写的是默认导入 `import FileSearcher from '@/node/ripgrepSearcher'`，而该文件的默认导出是 `RipgrepDirectorySearcher`（`node/ripgrepSearcher.ts:129-142`，`mode: 'text'`）；真正做文件名检索的具名 `export class FileSearcher`（`:144`，`mode: 'files'`）反而无人引用。根因是清理提交 `0646ad1` 删掉了 `node/fileSearcher.ts` —— 那 4 行只是 `export { FileSearcher as default } from './ripgrepSearcher'` 的转发垫片，被误判为死代码。**修法：改成具名导入。**
2. **拼写检查可用性判断恒真**：`main/spellchecker/index.ts:46` 写成 `if (!win.webContents.session.isSpellCheckerEnabled)`，缺 `()`，"不可用"告警永不触发。
3. **`startUpAction` 枚举跨进程不一致**：渲染端类型是 `'restoreAll' | 'lastSession' | 'blank'`（`store/preferences.ts:10`），主进程实际比较 `'restoreAll' | 'folder' | 'openLastFolder'`（`main/app/index.ts:288-299`），`'lastState'` 靠迁移改写（`main/preferences/index.ts:49-50`）。因为字段声明为 `StartUpAction | string`，编译不报错，但 `'lastSession'` 是死值、`'folder'`/`'openLastFolder'` 未被类型覆盖。
4. **偏好写入的同步广播**：`main/preferences/index.ts:135` 每次 `setItem` 都同步 `ipcMain.emit('broadcast-preferences-changed')`，`setItems` 逐键循环。**原判定"N×M 次原生菜单重建"不成立**：唯一的重建方 AppMenu 已在 `main/menu/index.ts:527-537` 按 key 判定（只有 `theme`/`followSystemTheme`/`language`/`autoSave` 才重建），而实测三处 `setItems` 调用方（`main/app/index.ts:521,842`、`main/windows/editor.ts:425`）每次只传一键。真正剩下的是批量写入时的广播条数与空对象也广播，见 O9。
5. **无监听者的 IPC**：`main/dataCenter/index.ts:83,93` 广播 `broadcast-web-image-added/-removed`，全仓零监听且不在契约里。
6. **空实现与名不副实的开关**：`main/preferences/index.ts` 的 `exportJSON`/`importJSON` 曾是空 `// todo`——**但全仓零调用方**（没有菜单项、没有 IPC、没有命令），所以不是"点了没反应"；`--safe`（`main/app/env.ts:101` 设 `global.COLAMD_SAFE_MODE`）也**并非无人消费**，`main/keyboard/shortcutHandler.ts:176-178` 会据此跳过用户键位文件，不实的是帮助文本"Disable plugins and other user configuration"（本仓无插件系统）。两条均已在 `fix/open-failure-visible`（`0c6df61`）按"摘掉入口"处理，见 O4。
7. **重复实现**：最近文档读取逻辑在 `main/menu/index.ts:18-19` 与 `main/ipc/menu.ts:14-15` 各一份，含两份 `MAX_RECENTLY_USED_DOCUMENTS`。
8. **同步 IPC 回落**：`preload/index.ts:141-157` 的 `isSamePathSync` 在 `a.length === b.length` 且 `a !== b` 但大小写相同（同一文件系统上的异体写法）时才回落 `sendSync`。**原判定"热路径每次比较都阻塞"不成立**：六个调用方（`sideBar/treeFile.vue:57`、`store/editor.ts:276,389,690,1425,1848`）全是点文件、保存、关标签这类离散用户动作，不在击键路径上，O10 已因此撤回。
9. **遗留但无害**：`main/app/index.ts:465-485` 整段注释掉的截图/快捷键捕获；`renderer/src/assets/symbolIcon/index.js`（MarkText 图标雪碧图，被 `main.ts:5` 引入却无模板引用）；`commands/descriptions.ts:169-175` 列了 3 个没有对应命令的 id；`components/titleBar/index.vue:99` 按 `.js` 引入实为 `.ts` 的文件。
10. **安全面残余（①已闭，②仍开）**：`main/security/pathScope.ts` 曾把"`imageFolderPath` 可由渲染端经 `mt::set-user-preference` 设置"记为已接受风险——该键同时是**写域授权根**，等于让被攻破的渲染进程自选可写范围，而且它在 preferences 与 dataCenter 各有一份、授权读的是可伪造的那份。分支 `security/image-folder-dialog-only`（`7fc33d9`）收为单一归属：只有对话框能赋值、泛型偏好通道丢弃该键、授权改随 user-data 广播。**仍未解决**的是读通道不设限（`pathScope.ts:27-31`），前置与量法见 O7②。

### 11.2 README / 已删除的 `CLAUDE.md` 与代码不符

> **口径**：`CLAUDE.md` 已于 2026-09-27 随本轮"去 Claude 绑定"删除，下表里 `CLAUDE.md:行号` 是**删除前的快照**，留着是因为它记的是"当时哪份文档在骗人"这件事本身；仍然有效的内容已并入本文（构建注意 → §10.1，命令与脚本 → §10.2）。

> **README 的源与快照（2026-09-27 起）**：根 `README.md` 是**中文**（GitHub 默认页），`README.en.md` 是英文，**只有这两份是源**；`docs/i18n/README-*.md` 其余 10 种是社区翻译快照，会落后于源，功能增删只在源文件里改。12 份文件顶部各有一条相同的文字语言栏（原来那排 emoji 国旗撤了——旗帜不等于语言，读屏与纯文本下也不可读）。

| 位置                                | 说法                                                                                    | 实际                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md:215-216`                 | 编辑器窗口 `contextIsolation: false + nodeIntegration: true`，文件 `src/main/config.js` | **错**。`main/config.ts:12,13,18`（编辑器）与 `:40,41,44`（偏好窗）均为 isolation+sandbox+无 nodeIntegration；文件是 `.ts` 不是 `.js`。`CLAUDE.md:82-86` 的表述才是对的                                                                                                                                                           |
| `CLAUDE.md:176`                     | 示例单测 `test/unit/specs/markdown-basic.spec.ts`                                       | 文件已不存在，用例回移到 `packages/muya/test/spec/roundTrip.spec.ts`                                                                                                                                                                                                                                                              |
| `CLAUDE.md:233`                     | 举例通道 `mt::open-new-tab`、`mt::file-saved`                                           | 契约中不存在这两个通道                                                                                                                                                                                                                                                                                                            |
| `CLAUDE.md:43`                      | `packages: ['packages/*']`                                                              | 另有 `packages/muya/examples` 与 `packages/muya/e2e` 两个显式工作区                                                                                                                                                                                                                                                               |
| `README.md:97`（现 `README.en.md`） | 侧栏含"文件树、全文件夹搜索、目录、版本历史"                                            | **已修（2026-09-27）**：中英两份都改成"文件树 + 文档大纲两个面板"（代码依据 `sideBar/index.vue:22,25`）；"全文件夹搜索"与"版本历史"这两项无 UI 的已从宣传里撤掉。**同日再改**：版本历史面板落地（`sideBar/history.vue`，读侧 IPC 真正接线），两份 README 的侧栏描述改为"文件树、文档大纲与版本历史三个面板"，这次是先有 UI 再宣传 |
| `README.md:98`                      | "命令面板与快速打开"                                                                    | **不再是偏差**：快速打开的退化已由 O1 修好（`8765cee`），这句现在与行为一致                                                                                                                                                                                                                                                       |
| `README.md:100`                     | 输出 HTML / PDF / Word                                                                  | **已修（2026-09-27）**：两份都写"导出 8 种"，与 `main/menu/templates/file.ts:112-120` 的菜单项一致（html/pdf/docx/png + pandoc 的 epub/latex/rtf/opml）                                                                                                                                                                           |

### 11.3 工具链偏差

状态同 §11.1：全部处置已闭环（O16 一轮修掉其中 5 条，分支 `chore/tooling-gates`）。

- `prettier --check` **不能当门禁**：`.prettierrc.yaml` 已设 `endOfLine: auto`（`chore/prettier-eol`），全仓告警从 533 降到 266；剩下的不是换行假红，而是 173 个 `.ts` 里 **84 个只差 `async(` vs prettier 的 `async (`**（根 ESLint 的 `space-before-function-paren: never` 与 prettier 直接对立），另 89 个带从未格式化过的换行差异。`pnpm format` 与 lint-staged 的 `prettier --write` → `eslint --fix` 顺序，本质是后改的赢。
- `patch-package` 走 `scripts/postinstall.ts` 手工调用而非 pnpm `patchedDependencies`（**不存在该键**），而多数 CI 安装带 `--ignore-scripts`，所以 `lint.yml`/`test.yml`/`validate-licenses.yml` 环境里没有打过补丁；`knip.json:5` 的 `ignoreDependencies: ["patch-package"]` 正是为了让 knip 别报这个。
- `pnpm-workspace.yaml:17` 的 `allowBuilds.keytar` 是残留：两个 package.json 与全部 `src/` 都没有 `keytar`（`sharp`/`workerd` 大概率也只剩传递依赖）。
- `electron-builder.yml:11` 排除了 `eslint.config.mjs` 与 `dev-app-update.yml`，两者都不存在（根文件是 `eslint.config.js`，已在 `:31` 排除；`dev-app-update.yml` 是真的缺，而 `electron-updater` 已接在 `main/menu/actions/colamd.ts`）。
- `scripts/generateThirdPartyLicense.ts:7` 与 `validateLicenses.ts:6` `require('./thirdPartyChecker.js')`，实际只有 `.ts` —— 全靠 tsx 的后缀改写才没炸。
- `eslint.config.js:1-8` 直接 import `@eslint/js` 与 `globals`，两者都不在根 `devDependencies`，靠 `shamefully-hoist` 才解析得到。
- 大版本分裂：根 ESLint ^9.39.4 vs 引擎 ^10.5.0；desktop Vite ^7.3.5 vs 引擎 ^8.0.16。
- `scripts/check-md-links.py:10` 的 `ROOT = dirname(abspath(__file__))` 指向 `scripts/` 而非仓库根，脚本一跑就 `FileNotFoundError`；加上它只覆盖 `README.md` 与 `docs/i18n/*.md`，这解释了为什么没有任何工作流引用它。
- 根目录 `count-lines.cjs`（未跟踪）同样未被任何脚本或工作流引用。

## 12. 上手路径与文档索引

**新人 30 分钟路线**

1. 读本文件 §3–§6（结构与跨进程边界），再看 §10.1 的构建注意与 §10.4 的代码风格与门禁。
2. `pnpm install`（会下载 Electron、打补丁、rebuild 原生模块；Windows 需 VS Build Tools 或手工放预编译 `.node`），`pnpm run dev`。
3. 跑一遍 `pnpm test` 与 `pnpm -C packages/muya test`，把 §10.3 的表格和实际输出对上。
4. 沿一条真实链路读码，看清"菜单在 main、状态在 renderer"是怎么咬合的：
   `Ctrl+S` → `main/menu/actions/file.ts` 发 `mt::editor-ask-file-save` → 渲染端 `store/editor.ts:329 LISTEN_FOR_SAVE` → `FILE_SAVE()`（`store/editor.ts:324` 委托到 `store/fileSave.ts:66`）→ 回主进程 `mt::save-tabs`（`actions/file.ts:378`）→ 原子写盘（`main/filesystem/index.ts:47-56`，write-file-atomic）→ `mt::tab-saved` 回执（`actions/file.ts:309`）。看懂一条比看十个模块有用。
5. 想动编辑区，先读 `packages/muya/ENGINE_GUIDE.md` 的 Architecture 与 Appearance contract，再进 `editor.vue`。

**仓库内文档**

| 文档                                                          | 内容                                                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`（中文，默认页）/ `README.en.md`（English）        | 面向用户的功能与下载说明。这两份是**源**，`docs/i18n/README-*.md` 其余 10 种是翻译快照（口径见 §11.2）                                                                    |
| `docs/CI_RUN_LEDGER.md`                                       | 文档引用的每条 CI run 的仓库内副本（run → workflow → `head_sha` → 结论 → 各 job），由 `python scripts/exportCiRuns.py` 生成；仓库若重建，run 页会 404，这份是唯一的留存处 |
| `AGENTS.md`                                                   | 面向 AI 代理与新贡献者的动手须知：环境、门禁基线、四条必读规矩与流程（取代已删除的 `CLAUDE.md`）                                                                          |
| `packages/muya/ENGINE_GUIDE.md`                               | 引擎架构、约定、构建细节                                                                                                                                                  |
| `docs/UI_REDESIGN_GUIDE.md`                                   | V1 设计系统、布局与微交互规范（已落地）                                                                                                                                   |
| ~~`docs/OPTIMIZATION_ROADMAP.md`~~（已退役删除，2026-09-29）  | §8 功能候选经重评估全部关闭（不做处置+重启条件留档），基线面板迁入本文 §14，历史证据在 git（v0.1.4 之前）                                                                 |
| `BUGLIST.md`                                                  | 2026-09-15 审计的实锤 bug 清单，已全部修复                                                                                                                                |
| `.github/CONTRIBUTING.md`、`.github/COMMENTING-GUIDELINES.md` | 贡献流程与注释规范                                                                                                                                                        |

> 原 `CODE_REVIEW_AND_ROADMAP.md`（生成于 2026-09-07，审查基线 `cd9ab53`）**与 `ColaMD_WORKPLAN.md` 已于 2026-09-27 删除**：前者的复核结论在 `OPTIMIZATION_ROADMAP` §2/§3，其 §8 功能路线图整体搬进该文档 §8；后者的七梯队自述复核在 §7（那里的行号是删除前快照），未开工的 Typora 对标打磨清单在 §8.1。

## 13. 代码质量体检（2026-09-19 实测）

**方法**：`node` 脚本静态扫描两包 `src`（459 个 ts/vue/js 文件、91,212 行）＋ `eslint`/`knip` 权威输出 ＋ 对每条可疑命中逐个回读代码定性。下表"结论"列区分**实锤**与**启发式误报**——本轮共有三类启发式命中经复核后不成立，一并记录以免被重复劳动。

| 维度           | 实测                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 结论                                                                                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 类型逃逸       | `as unknown as` 生产代码 64 处（main 17 / renderer 33 / muya 14）；测试里另有约 300 处                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 可控。muya 的 `no-restricted-syntax` 禁令**确实被遵守**：生产仅 14 处，集中在 `block/base/treeNode.ts`(4)、`state/index.ts`(2) 等 ot-json1 ↔ TState 边界                                                                                                                       |
| 显式 any       | `: any` 29 处（muya 23、desktop 6）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | muya 侧 `ts/no-explicit-any: error` 生效，残留者均带 `eslint-disable-next-line` 与理由注释                                                                                                                                                                                     |
| 非空断言       | `pnpm check` = 0 errors / **94 warnings**（94 条全是 `no-non-null-assertion`，`no-unused-vars` 已清零；2026-09-26 重测。基线 99 → 95 → 94：先删掉 4 条真死代码告警（`versionHistory` 的 `SnapshotLabel` 表、`util/pdf.ts` 的 `catch (_)`、`xss.spec.ts` 从不读的 `page`、`themeRegistry.ts` 的死 import），再删掉 `codeMirror/index.ts` 的 `getModeFromName` 及其链式依赖（连带 `codeMirror/modes.ts` 整份 425 行手抄语言表，见路线图 O13 末段）。2026-09-22 重测。此前是 103 = 98 + 5，少的 4 条是目录监听 reducer 外提后不再需要的 `projectTree.value!`），99 条按目录：`src/main` 54 / `test/e2e` 23 / `test/unit` 12 / `src/renderer` 10 | `main/windows/editor.ts` 原占 44 处（31%），已 `f9316bc` 清零（见路线图 O25）；现存最多的是 `main/menu/actions/paragraph.ts` 13 处与 `main/menu/actions/file.ts` 8 处，同为"窗口必定已建"的模式                                                                                |
| 多余导出       | `knip --workspace packages/desktop`：全量跑为 合入前全量跑为 **34 未使用导出 + 13 未引用类型**（更早快照 48 + 46，差值即 O20 已清的部分）；`cleanup/dead-symbols` 清完后**只剩 1 项**（刻意保留的 `sanitizeThemeText`）                                                                                                                                                                                                                                                                                                                                                                                                                      | 实测三分（见 O20）：**49 处仅 export 多余**（已清 `d35d5d3`）、**29 处去 export 后连本文件都不引用＝真死代码**（移交 O13）、**1 处 `FileSearcher` 与 quick-open 分支冲突需排除**。首轮曾把死代码误判为"只是关键字多余"，判据已改为"去 export 后 eslint 是否立刻报 unused-vars" |
| 上帝文件       | `store/editor.ts` 924、`components/editorWithTabs/editor.vue` 1,768、`prefComponents/image/…/uploader/index.vue` 1,186（2026-09-26 重测；`store/editor.ts` 从 2,347 经 O12 各刀降到 924，业务体分散在同目录按簇命名的 `store/*.ts` 里）；引擎 `block/base/format.ts` 1,850、`muya.ts` 1,732                                                                                                                                                                                                                                                                                                                                                  | 已有 O12 覆盖（桌面包）。`muya/src/config/emojis.ts` 12,983 行是数据文件，不计入                                                                                                                                                                                               |
| 超长函数       | >100 行的函数：`store/project.ts:75`(setup，250)、`editor.vue:1431`(onMounted，148)、`main/app/index.ts:249`(ready，165)、`main/ipc/ripgrep.ts:181`(158)、`util/theme.ts:61`(153)、`editor.vue:1358`(158)、`lazyMarkdownPipeline.ts:66`(144)、引擎 `blockTransforms.ts:20`(297)                                                                                                                                                                                                                                                                                                                                                              | 桌面包**没有** `max-lines-per-function` 规则（muya 有 ≤200 的警告线），所以这类函数不会报修；见 O21                                                                                                                                                                            |
| 重复实现       | ① Markdown 扩展名清单曾在 `common/filesystem/paths.ts:7-20` 与 `preload/index.ts:~112-120` 各一份（现已收进无依赖叶子模块 `common/filesystem/markdownExtensions.ts`，见 O22）；② 键位表 `keybindings{Darwin,Linux,Windows}.ts` 大段默认项相同；③ 最近文档 reader 双份（本轮 O5 已合并）；④ `byteLengthUtf8`（渲染端安全的 UTF-8 字节数）曾在 `store/editor.ts:80` 与 `util/themeMarket.ts:219` 各一份（O12 第 2 步已收进 `util/byteLengthUtf8.ts`，两处同引）                                                                                                                                                                                | ①当初的"preload 只能依赖 `electron`+`pathe`"被读成了"不能 import `common/`"，实际约束的是 **Node 内置模块**：`electron.vite.config.ts` 的 preload 段本来就配了 `common` 别名，把清单挪进零 import 的叶子模块即可两边共用；②属平台差异，暂不动                                  |
| 击键热路径     | `editor.vue` 中 `getTOC()` / `getMarkdown()` 仅出现在 **挂载阶段**（`:1969`、`:1977`，用于播种 TOC 与 synthetic 基线）；渲染端 `deep: true` watcher **0 处**；`state/index.ts` 无 `structuredClone`                                                                                                                                                                                                                                                                                                                                                                                                                                          | 与 M1.2/M1.2b 的记录一致：每击键已无全文级操作。`deepClone` 仍在 45 处被调用，但克隆对象是 `emptyStates.*` 小模板与单个 `op.operation`，**不是全文档**——后续审计不要据此重开性能项                                                                                             |
| 命名           | `renderer/src/codeMirror/mltiplexMode.ts` 文件名拼错（导入方 `codeMirror/index.ts:11` 写的也是这个错名，符号本身 `multiplexMode` 正确）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 见 O23（`git mv` 已落在 `cleanup/redundant-exports` 分支 `0875173`）                                                                                                                                                                                                           |
| 有意为空的分支 | `pages/app.vue:153-158`（web-link 拖拽故意放行，交给引擎处理）、`util/exportHtml.ts:225-229`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **启发式误报**：我的"空控制流"扫描命中 7 处，回读后全部是注释先行或确有实现的分支。该启发式对本仓库无效，不再使用                                                                                                                                                              |
| TODO 债        | `TODO/FIXME/HACK` 55 处（排除 vendored）；最高 `muya/block/base/format.ts` 7、`main/windows/editor.ts` 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 中等，无专项                                                                                                                                                                                                                                                                   |

**一条反向结论值得记住**：本轮 5 个"未被引用"的符号（`validateTheme`、`DANGEROUS_EXECUTABLE_EXTENSIONS`、`exportPDF`、`getContentHash`、`TOP_LEVEL_HEADINGS_SELECTOR`）经 ripgrep 复核**全部在本文件内被使用**，其中 `DANGEROUS_EXECUTABLE_EXTENSIONS`、`validateTheme` 还都是安全校验路径。任何"零引用即删"的结论必须先做这一步——`0646ad1` 删掉四行 re-export 垫片弄坏 `Ctrl+P` 是同一个坑（见 §11.1-1）。

## 14. 实测基线面板（自 2026-09-29 退役的优化路线图迁入）

> 本节原是 `docs/OPTIMIZATION_ROADMAP.md` §1。该文档当日退役删除（§8 功能候选经重评估全部关闭，其余条目已全部闭环；完整历史见 git，v0.1.4 之前任意提交可考）。**数字是各自测量时点的快照**，方法列可直接复现。

| 维度         | 实测值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 测量方法                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面端规模   | 267 个 ts/vue 文件、**40,618 行**（2026-09-26 重测；比上一行的 268 / 41,095 少 1 个文件、少 477 行——O13 删掉的 `codeMirror/modes.ts` 425 行，加 `codeMirror/index.ts` 少 43 行、`versionHistory/index.ts` 少 8 行、注释净减 1 行；在那之前的一天，第二十刀那行为 268 / 41,093，多的 2 行是给 File 菜单偏好项加 `id` 的注释；第二十刀那一行比第十九刀的 267 / 41,040 多 1 个文件、多 53 行，新增文件是 `exportPrint.ts`；第十九刀那一行比第十七刀那行的 266 / 40,980 多 1 个文件、多 60 行，新增文件是 `selectionState.ts`；第十一刀之前是 254 / 40,473，多出的 13 个文件是其后各刀新增的 `typedOn`/`typedSend`/`muyaPlugins`/`muyaBusEvents`/`tabClose`/`autoSaveTimer`/`fileSave`/`contentEvents`/`tabLifecycle`/`windowSession`/`imageCleanupActions`/`fileChange`/`exportPrint`，O12 六步时是 245 / 40,653）                                                                                                                                                                                                                         | `find packages/desktop/src … \→ wc -l`                                                                                                |
| 引擎规模     | 220 个 ts 文件（不含 `__tests__`）、48,485 行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 同上，`packages/muya/src`                                                                                                             |
| 最大文件     | `store/editor.ts` 924（第十一至二十刀连做九簇：关闭标签、保存与改名、内容变更与自动保存、标签新建与切换、窗口引导与缓冲还原、图片补全与清理、文件重载与关闭询问、大纲与选区、导出与打印，从 1970 共减 1,046 行；前五步从 2347 提出 370 行，见 §3 O12）、`editor.vue` 1768（第九刀搬掉 17 个插件注册与 31 条 bus 清单后从 1840 降到 1768）、`prefComponents/image/…/uploader/index.vue` 1186、`main/menu/actions/file.ts` 982、`main/app/index.ts` 897、`commands/index.ts` 766（2026-09-26 重测）。**菜单模板已不在榜上**：`file/edit/paragraph/format` 由 259/181/206/131 降到 147/74/97/39（2026-09-22 重测）。`store/project.ts` 整文件只剩 269 行，其中 setup 按长度门口径 167 行                                                                                                                                                                                                                                                                                                                                                   | `wc -l`                                                                                                                               |
| runtime 依赖 | 桌面 35 个，**零引用 0 个**；引擎 28 个 `dependencies` 同样零冗余（2026-09-27 实测：26 直接引用 + `vega`/`vega-lite` 作 `vega-embed` 的 peer 供给，方法与结论见 §8 S1）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 纯 Node 扫描 477 个源/配置/测试文件；`node node_modules/knip/bin/knip.js --workspace packages/desktop --dependencies` 退出 0 且无输出 |
| IPC 面       | 三个方向都绑到契约上（2026-09-23 实测）：**invoke** 41 条全走 `typedHandle`（唯一的裸 `ipcMain.handle` 就是垫片自己 `ipc/typedHandle.ts:23`）；**on** 64 个 `ipcMain.on` 站点全走 `typedOn`/`typedSyncOn`，唯一豁免是 `utils/internalIpc.ts`（通道名为运行期字符串）；**send** 99 个推送站点里 93 个走 `typedSend`，6 个运行期拼通道名的逐个带理由豁免。契约声明数 41 invoke + 83 send + 2 sync + 69 主→渲染                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `grep -c` 于 `src/main`，契约计数于 `src/shared/types/ipc.ts`，`npx eslint packages/desktop/src/main` 0 error                         |
| 测试面       | 5 套共 **483** 个 spec 文件（2026-09-30 重数）：desktop 单测 **110**（1207 通过 + 1 跳过，`pnpm test:unit` 退出 0）、desktop E2E **73**（`search-redos.spec.ts`、`crash-ref-link-label.spec.ts`、`quick-open-pattern-safety.spec.ts`、`format-line-ending-dirty.spec.ts`、`percent-link-click.spec.ts`）、muya 单测 **224**、muya 一致性 **5**（+1：`fixtureEol.spec.ts`，见 §3 O12 末段）、muya E2E **71**。改前记的是 461/95/67/223（2026-09-24 第二十刀后），此后 PR #5–#17 各自补了用例。desktop 单测这一列从 98 起连加十二份：`quick-open-pattern-compile.spec.ts`、`image-filename-token.spec.ts`、`sfc-import-strip.spec.ts`（守的是测试自身的剥 import 规则，见 AGENTS.md 的 harness 那条）、`format-actions-dirty.spec.ts`、`link-click-pathname.spec.ts`、`command-palette-stale-results.spec.ts`、`quick-open-empty-cancel.spec.ts`、`history-preview-stale.spec.ts`、`recent-documents-write.spec.ts`、`quick-open-glob-inclusions.spec.ts`、`buffered-state-signature-gate.spec.ts`、`close-requires-saved-tabs.spec.ts`。 | `find … -name '*.spec.ts' \→ wc -l`                                                                                                   |
| 一致性       | CommonMark **88.0%** / GFM **86.6%**（2026-09-26 重跑一致性套件后同步：574/652 与 582/672；钉死在 `test/spec/expected-failures.json`，78 + 90 条）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `packages/muya/CLAUDE.md`、`test/spec/conformance.md`                                                                                 |
| CI           | 12 个工作流（2026-09-26 删掉 `claude.yml` 后重数；**该删除已于 2026-09-27 经 PR #41 落到默认分支，注册表 `total_count` 从 13 变 12**）；**双平台腿有四条**——`test.yml`（ubuntu + windows 单测 + 一张非阻断 `coverage`）、`e2e.yml`（ubuntu-24.04 + macos-15 全量 E2E）、`muya-test.yml` 与 `muya-spec.yml`（各 ubuntu + windows，2026-09-27 补，见 O14 条目末尾的尾巴关闭记录），另 `build.yml` 五条平台腿在各自打包前先跑本平台单测（O14 ①②③，2026-09-22/23 已拿到真跑证据并随 PR #37 promote）。**故意保持单平台的**：`lint.yml` 与 `muya-{lint,build,circular,e2e}.yml`，理由写在 O14 条目末尾                                                                                                                                                                                                                                                                                                                                                                                                                                       | `ls .github/workflows \→ wc -l` + 逐文件读                                                                                            |
| 击键热路径   | 1MB `edit+flush` p50 2.9 / p95 4.0 ms（验收线 P95 < 16 ms，余量 4×）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `packages/muya/docs/perf-baseline.md`（M1.2b 轮，2026-09-12）                                                                         |
| 入口路径     | 1MB `setContent` p50 28.2 ms（基线 8,489.9 ms，−99.7%），增长已线性                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 同上（M1.3 轮，PR #27）                                                                                                               |
| 注释密度     | `TODO`/`FIXME` **64 处**（口径：只数 `TODO`/`FIXME`、不排除 vendored、不含 `HACK`；换成 `PROJECT_GUIDE` §13 的口径——加上 `HACK` 并排除那份 vendored diagram 文件——是 **55**，两个数都对得上）（2026-09-26 重测；桌面 23、引擎 41，其中 14 条集中在 `muya/src/utils/diagram/sequence/sequence-diagram-snap.js`、7 条在 `block/base/format.ts`；上一行的 52 是 2026-09-19 的数）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `grep -rn` 于两包 `src`                                                                                                               |

复现基线：

```bash
node node_modules/knip/bin/knip.js --workspace packages/desktop --dependencies   # 依赖体检
pnpm -C packages/muya exec vitest run src/state/__tests__/keystrokePipeline.bench.spec.ts --testTimeout 420000   # 性能（2-10 分钟）
```

> 本机 `pnpm` 不在 Git Bash 的 PATH 上（`/c/Users/lyg/AppData/Local/pnpm` 里没有可执行文件）。本轮做法：`corepack prepare pnpm@10.33.4 --activate` 装钉定版本，再放两个垫片到 PATH 前面——`pnpm`（`exec corepack pnpm "$@"`）与 `pnpm.cmd`（后者必需，因为 `pnpm --filter` 会派生 cmd.exe，而 cmd 认不了无后缀脚本）。**不用 `--no-verify` 绕门禁。**

### 14.1 E2E 抖动日志（红先用不含改动的对照跑定性，再分类）

AGENTS.md 的门禁表把"已知间歇形状"指到这里。这里只收**有 run 号或本机复现**的形状，没证据的一律写明"未定性"。

| 形状                                                                                                                                                 | 证据                                                                                                                                            | 定性                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mac 腿 `export-long-image-and-pandoc.spec.ts:83` 的 `pandoc latex converts for real` 两次 attempt 全红；同文件 `rtf` 那条重试转绿                    | run `36268664649`（2026-09-26，develop 的 PR）                                                                                                  | 独立用例的重试机制本身有效（`rtf` 就是证据）。该次红未再复现，pandoc 相关                                                                                                                                                                                       |
| mac 腿 `find-replace.spec.ts:213` 首跳 `Expected "3 / 3" / Received "1 / 3"`（10 s 轮询超时），`retry #1` 变成 `Expected "1 / 3" / Received "0 / 0"` | run `36572698150`（PR #32，diff 只有侧栏 `history.vue` + 一份单测 + 文档）；对照跑 run `36575033113`（develop `e2f60f0`，零改动）**两条腿全绿** | **重试那一半已定性并修掉**：该用例继承了上一条的 `1/3` 基线，而 Playwright 的重试是"单独重跑失败那条 + `beforeAll` 重启干净 app"，所以它的重试必然读到 `0 / 0`——本机在 `e2f60f0` 上 `-g "findPrev from"` 稳定复现同一行同一字。**首跳那一半根因未确立**，见下段 |

**未定性那半的边界要记清**。计数器停在 `1 / 3`（截图里第一个 apple 仍是活动高亮、页面上没有错误元素）说明 `SEARCH` 根本没被调到：`Search.find()` 在 `matches.length === 0` 时虽然原样返回，但随后的 `SEARCH` 仍会把计数器写成 `0 / 0`，所以"匹配空了"可排除。**也不是总线吞异常**——装的 mitt 3.x 的 `emit` 里没有 try/catch（实测 `node_modules/.pnpm/mitt@3*/node_modules/mitt/dist/mitt.mjs`），异常会同步抛回 IPC 回调。剩下的可能是链上某处抛了：`src/main/exceptionHandler.ts:21` 的 `SHOW_ERROR_DIALOG = !process.env.COLAMD_ERROR_INTERACTION` 在 e2e 下为真（helper 只在 `suppressErrorDialog` 时才设这个变量），于是会弹阻塞式原生框——页面截图看不见它，而主进程 `await dialog` 期间照常处理 IPC，所以"同文件其余 14 条仍然通过"**既不能证实也不能证伪**这条路径。基线数字：新库 35 次 e2e 跑里 2 次红，两次都只在 mac 腿。下次同一症状再现时，先给该 describe 开 `suppressErrorDialog`、动作前 `clearRendererErrors` 动作后 `expectNoRendererErrors`，把"抛了"和"没跑到"分开，再谈修法。

**这个形状暴露的覆盖面（已实测，本批未处理，记在 issue #34）**：`playwright test --list` 口径下 `test/e2e` 共 **73** 个 spec 文件 / **258** 条用例，其中 **55** 个文件里有多条用例，而全仓 `mode: 'serial'` **零使用**——任何一条"靠上一条建状态"的用例都有同样的重试失效问题。逐条核查办法（本批对 `find-replace.spec.ts` 全 15 条就是这么跑的，结果 15/15 能独立通过）：先 `playwright test --config=… <file> --list` 取全部标题，再对每个叶子标题单独跑一次 `-g "<正则转义后的叶子标题>"`。

## 15. 稳定期审计记录（2026-09-29 起）

进入稳定期后按类扫描找 bug，每轮的覆盖面与结论记录于此。

**第一轮**（监听器与解析类）：泄漏扫描 18 命中 → 3 真泄漏修复（tree.vue 的 bus+3 个 document 监听、treeFile/treeFolder 的行级 bus 监听——均无清理，树卸载/折叠后按行累积；已对称清理）+ history.vue 过期响应竞态守卫（PR #16）。JSON.parse 三处全有 try、空 catch 零命中、v-html 单处且消毒、deep watcher 仍为 0。

**第二轮**（跨进程与生命周期类）：

- IPC 面复核：裸 `ipcMain.handle` 仍只有 `typedHandle.ts` 自身，裸 `ipcMain.on` 唯一豁免点仍是 `utils/internalIpc.ts`（运行期字符串通道），`typedHandle` 站点 41 → 45（版本历史 4 条）。
- muya 事件总线对账：22 emit 对 on/subscribe 消费者，**0 死发射**（注意对账必须把 `eventCenter.subscribe` 算进消费者形式，漏了会误报 11 条）。
- main 浮动 Promise：唯一命中是 `editorBufferStore` 的两参 `then(() => {}, () => {})`（拒绝已处理）——无未处理拒绝崩溃风险。
- 资源生命周期：watcher 的 close/unwatchByWindowId 链在 windowManager 三处关闭路径完整接线；ripgrep 子进程可取消；离屏导出窗口 try/finally + destroy + 临时文件清理。

**第三轮**（正则执行面，2026-09-29）：起因是第二轮末尾那条"已知边界"——它后来被立项并修掉了（PR #17 + 本批收尾），而这一轮顺着同一类问题又找出引擎里的一处。**搜索框**原先把用户正则同步编译执行（`new RegExp(searchValue)`），病态正则 × 大文档会冻结渲染进程。当时的结论是"自伤型健壮性、不立项"，理由是修复要分块执行器或非回溯引擎（re2 与依赖瘦身冲突）；该结论已被下面这套**零新依赖**的做法取代：正则在交给引擎之前先在 Worker 里预跑（`packages/desktop/src/renderer/src/components/search/searchRegexProbe.ts`），Worker 内的扫描在两次 `exec` 之间查预算（`regexProbeShared.ts:14` `scanWithBudget`，4s），单次不返回的 `exec` 由主线程看门狗 5.5s `terminate()` 兜住（`searchRegexProbe.ts:18`），拒绝时给 11 份语言的 `search.regexTimeout` 提示。正则构造逐条镜像 muya 的 `matchString`（`packages/muya/src/utils/search.ts:4-34`：同样的 flags 规则、纯文本转义、`\b` 包裹），普通文本搜索不探测（转义后的字面量是线性的）。

**本批在已合入的 `74f0f6f` 之上补的三处**（该提交信息称"§15 已记录"，但它改的 16 个文件里没有 `docs/`，本节记录是这次才补上的）：

- Worker 已经上报 `timedOut`，主线程却只看 `status` 就判成 `ok`——于是"慢但有限"的扫描（探针自己花了 4s 才停）照样放行，真正的同步搜索仍在主线程花同样长的时间，预算层形同虚设。修法是把映射做成纯函数 `probeResultFromReply`（`regexProbeShared.ts:39`）并让 `timedOut` 映射为 `timeout`，配 3 条单测。**变异验证**：把该映射改回旧写法（忽略 `timedOut`）重跑，`regex-probe.spec.ts` 正好红 1 条且就是新写的那条（7 条里 1 failed / 6 passed）。
- `searchFn` 变成 `async` 之后，`await` 探针最长 5.5s，返回时用的是**发射时刻**的 `searchValue`：既能发出一个从未被探测的值（闸门被绕过），也会把超时提示挂到另一个模式上。改成调用时快照 `value`/`opt`、`await` 后丢弃被取代的结果、`bus.emit` 只发快照（`search/index.vue:316-361`）。其中"最新调用才有效"这段判定已抽成纯函数 `createSeqGuard`（`searchRegexProbe.ts:81-88`）并配 3 条单测；**变异验证**：把 `isLatest` 改成恒真 → 正好红 1 条（"被取代的调用不可执行"那条）。
- **顺带挖出一个 harness 空洞**：`test/unit/specs/search-prefill.spec.ts` 会把 SFC 的`<script setup>` 里所有 `import` 行剥掉，再用 `new Function` 注入一份**手写**的依赖清单去跑真实的 setup 代码。清单里缺的符号不会编译报错，只在该表达式真被求值时抛 `ReferenceError`——所以 PR #17 加进去的 `probeSearchRegex` 一直没人补进清单也没暴露（那两个用例不走正则分支）。本批给 SFC 加了 setup 期就要求值的 `createSeqGuard`，`pnpm test:unit` 当场红 2 条才把它揪出来，两个绑定一并补齐（`probeSearchRegex` 用 `vi.fn` 桩、`createSeqGuard` 用真实实现）。
- 挂死的探针会拖住下一个查询：Worker 是单线程的，新请求的消息排在永不返回的 `exec` 后面，只能等看门狗 5.5s 后连同新请求一起被判超时。改成新请求先 `killWorker()` 再接管（`searchRegexProbe.ts:92`），看门狗随之重新计时。**变异验证**：删掉那行 `killWorker()` 重构建，`test/e2e/search-redos.spec.ts` 第二条 15s 内计数器纹丝不动（红），第一条不受影响；恢复后第二条 1.0s 绿。

**同一类问题在引擎里另有一处，已修（本批第二处）**：`ScrollPage.updateRefLinkAndImage` 把**参考式链接定义的标签**直接拼进 `RegExp` 的模式串（模式形如 `\[` 标签 `\](?!:)`，见 `packages/muya/src/block/scrollPage/index.ts:120-127`），而 label 来自文档内容（`paragraphContent/index.ts:214-217` 取 `getLabelInfo`），随后对**每个内容块**跑 `REG.test(node.text)`。后果实测两种：标签写成 `a(b` 时 `new RegExp` 抛 `SyntaxError: Unterminated group` 并直达渲染端错误处理（`crash-ref-link-label.spec.ts` 第一条修复前红，记录到两条错误栈，都经 `ParagraphContent.keyupHandler` → `ParagraphContent.update` → `updateRefLinkAndImage`；同一份文档的**初次加载不报错**，触发点是让那个定义段落走一次 `update`）；标签写成 `(a+)+b` 且文档里另有一段 `[` + 一长串 `a` 时，单次 `REG.test` 在 node 里量到 **2206 ms（28 个 a）**，34 个 a 直接把真窗口跑到 30 s 测试上限（第二条修复前红、修复后 2.2 s 绿）。修法是把标签按字面量转义（一行），行为变化只影响本来就匹配错的标签（`[v1.2.0]:` 这类含 `.` 的标签此前是"点号通配"）。引擎侧回归：`pnpm -C packages/muya test` 223 文件 / 1498 通过、`test:spec` 5 文件 / 1359 通过、`pnpm -C packages/muya lint` 9 warnings / 0 errors，全部退出 0。

**同面第三处：`Ctrl+P` 的 glob → `RegExp`（本批）**。`commands/quickOpen.ts` 把查询里的 `*` 映射成 `.*`，连续星号因此嵌套成 `.*.*.*…`，对不匹配的尾部逐组回溯。**真窗口实测**：一个标签页（路径 69 字符）、查询 `******zzz`，一次 `page.evaluate` 往返被挡 **23,239 ms**——扫描在渲染主线程上，这期间面板不接受任何按键。同样的曲线在 node 里（9 条典型路径的语料）量到 3/4/5/6 星 = 6 ms / 85 ms / 1082 ms / **8 s 未返回**（子进程带 8s kill 量的，别信"跑完的"数字）。

- **编译失败那一支的后果和我原先写的不一样**。`{` 与 `}` 不在转义集合里，所以 `{2,}`、`*{2,}`、`a{2,}{2,}`、`{1,2}name` 会让 `new RegExp` 抛 `Nothing to repeat`；抛点在 300 ms 防抖之后的 async 调用里，`components/commandPalette/index.vue:271-280` 的 `.catch` 把它吞成"列表清空 + 一条 electron-log"。**不是崩溃**：`expectNoRendererErrors` 只统计走 `mt::handle-renderer-error` 的未捕获异常（`test/e2e/helpers.ts:94-118`），`log.error` 不经那里。
- **撤回我在此处写下的两条错判**：`^[` 与单个 `\` **都不抛**——`[`、`^`、`\` 都在转义集合内，编译出的模式串是 `\^\[` 与 `\`；把它们当反例的探针自己有问题（try 块里漏了 `new RegExp`，于是无条件返回"成功"，这是"用例绿了≠用例测到了"的又一种形态）。#18 里"危害远小于搜索框：输入面短且数量有界"的判据同样不成立，**一个标签页就够冻结 23 秒**。
- **修法**（零新依赖）：`compilePattern()`（`quickOpen.ts:10-36`）转义后把 `(?:\.\*)+` 折叠为 `.*`——`.*.*` 与 `.*` 是同一语言，且折叠只可能命中星号产生的相邻 `.` `*` 对（查询里的字面 `.` 到模式串中是 `\.`，永远接不进这个 run）；编译失败返回 `null`，调用处退化为大小写不敏感的**子串**匹配（`quickOpen.ts:153-162`）。行为面只改了两件：不再抛、不再慢；匹配结果逐条与修复前的映射等价（单测拿**测试内复制的修复前映射**做参照实现）。
- **回归**：`test/unit/specs/quick-open-pattern-compile.spec.ts` 3 条（等价性、5 星 <500 ms、无法编译的查询按字面量命中 `/tmp/weird{1,2}name.md`）——修复前红 2 条（成本条实测 ~1.08 s；`{1,2}name` 那条由修复前那行裸 `new RegExp` 抛 `SyntaxError: Nothing to repeat`），等价条修复前后都绿，因为它守的正是"不许改行为"。`test/e2e/quick-open-pattern-safety.spec.ts` 2 条，第一条只证明标签页分支真被执行（查询 `note` 列出了 `note.md`），第二条是 23,239 ms → 3.0 s 的那条时间断言。
- **这一批挖出的 harness 空洞（第三条教训）**：输入框的 `v-model` 只把文本写进 `query.value`，**检索由按键触发**——`updateCommands()` 的调用方逐条数过共四处：`@keyup`（`commandPalette/index.vue:21,230`）、Enter（`:254`）、静态子命令装载（`:318`）、语言切换（`:332`），`input`/`change` 不在其中。而 `locator.fill()` 不产生 keyup——所以我第一版两条 e2e **全部空跑**：`fill('******zzz')` 之后断言 `inputValue()` 回显，测的是"从没发起过搜索"。同理 `page.keyboard` 上没有 `pressSequentially`（只有 `Locator` 有），运行期报 `is not a function` 才暴露。再加一条判据：**被阻塞的 `fill`/`press` 只会晚返回**，所以"文本最终回显了"是不可失败的断言，能失败的只有"扫描进行中的一次往返耗时"。
- **未做，留在 #18**：不转义 `{`/`}`（那会把 `a{2,3}` 这类既有量词语义改成字面量，属行为变更，本批只做"抛了就退化为字面量"）；`_getInclusions()` 交给 ripgrep 的 `*${query}` glob 不在这个面上。

**这套闸门的实测前提与限度（都验过，别再当作等价证明）**：

- Worker 在**打包态**确实加载并执行：生产渲染进程走 `file://`（`packages/desktop/src/main/windows/editor.ts:287` → `windows/base.ts:124`），Vite 把它切成独立 chunk（构建产物 `out/renderer/assets/searchProbe.worker-*.js`），E2E 跑的就是这份构建产物并真拿到了超时提示（`search-redos.spec.ts` 第一条耗时 6.4s ≈ 看门狗 5.5s）。CSP 是 `default-src 'self'; script-src 'self'`（`packages/desktop/src/renderer/index.html:7-13`），`worker-src` 回落到 `default-src` 即放行同源。
- 探针扫的是**整篇 raw markdown**，而 muya 实搜是**逐内容块**（`packages/muya/src/search/index.ts:171-175` 深度优先遍历里 `matchString(block.text, ...)`）；块文本会剥掉行内标记，与 raw markdown 不总是子串关系。所以这是一次启发式预检：误拒与漏拒两个方向都可能存在，误拒是安全方向。
- `probe === null`（Worker 建不起来，或文档为空）时**不加闸门直接搜**，只 `console.warn` 一次——宁可退回旧行为，也不因为探针自身故障而拒绝用户的正常搜索。
- 代价的量级：合法正则每次输入（150ms 防抖）都要多一遍全篇扫描 + 一次整篇文本的结构化克隆；命中预算的模式先花 4s 探测再拒绝。

**第四轮**（用户内容进 `String#replace` 的 replacement 串，2026-09-29 起）。扫描面：`$&`、`` $` ``、`$'`、`$$` 在 replacement **字符串**里不是字面量，所以任何"把用户内容/文档内容/偏好值当作替换串"的调用都会静默改写内容。两条 grep 形状（第二参是标识符 / 是模板串）命中 6 处，逐条定性：**3 处真缺陷**、1 处已经是正确写法、1 处是假阳性、1 处同形但不可达。

- 真缺陷一（导出，影响三种格式）：`util/exportHtml.ts` 把 `[TOC]` 注入与 `<body>` 重发都用字符串 replacement，而 replacement 的内容（TOC 条目文本、整篇渲染 HTML）就是用户文档本身。修复前实测：正文里一个 `` `$&` `` 让导出 HTML 出现 **2 个 `<body>`**（整篇 body 被粘贴进自身）；`` `$$` `` 被压成 `<code>$</code>`（静默掉字）；标题 `Args $& and $1` 注入 TOC 后 `<p>[TOC]</p>` 仍在。上游是 `editor.vue` 的 styledHtml / docx / jpeg / print 五条导出腿（`:942/:965/:997/:1025/:1055`）与 `util/exportDocx.ts:14`——**HTML、DOCX、PDF/打印三条出口共用这段代码**。
- 真缺陷二（图片落盘目录）：`useEditorImages.ts` 的 `${filename}` 模板展开把**当前文档名**当作 replacement 串。修复前实测：`my$$file.md` 的图片静默写进 `my$file/`，`a$&b.md` 写进字面名为 `${filename}` 的目录。已抽成模块级纯函数 `resolveImageFilenameToken` 以便直接测（6 条）。
- 真缺陷三（源码模式改图）：`sourceCode.vue` 把图片动作的结果写回源码行。修复前实测：alt 写成 `cost $& here` 时，那一行里的 `$&` 被展开成**整段被匹配到的旧图片标记（连内部图片 id `abc123` 一起）**，插进 alt 中间——内部 id 泄漏进可见文本，那一行也从此坏掉。（这里刻意不照抄那串嵌套方括号的原文：`scripts/check-md-links.py` 会把 `](` 后面的东西当图片链接目标去解析，实测红过一次，报 `missing target "new.png"`。）
- 已是正确写法：同文件的 `rewriteImageSrcs`（`exportHtml.ts:144-148`）早就用函数 replacer，所以本批的修法是沿用文件内既有惯例，不是新发明。
- 假阳性：`editor.vue:872` 的 `editor.value.replace(value, opt)` 是引擎的替换动作，不是 `String#replace`。
- 同形但不可达（**故本批不修**）：`codeMirror/loadmode.ts:53` 用围栏 info string 替换 `CodeMirror.modeURL` 里的 `%N`；要让 `$&` 生效得把语言名写成 `$&`，而那种 mode 本来就不存在，后果只是拿不到一个不存在的 mode 的 URL。
- 我自己的一次用例错判：第三条用例我先按"顶级标题"构造，`getHtmlToc` 在未设 `tocIncludeTopHeading` 时**本来就要丢掉 lvl≤1 的条目并返回空串**——那是功能不是缺陷。红要先问"为什么红"，否则会把正确行为钉成回归。**已改成 lvl 2**，并加了一条 `expect(toc).not.toBe('')` 守住用例自身。
- **同批改完提交后才发现的连带破坏（值得单独记）**：`source-code-image-action.spec.ts` 与 `search-prefill.spec.ts` 靠"逐行删掉 `import` 行 + `new Function` 注入依赖清单"来跑真实 SFC setup。本批只改了 `sourceCode.vue` 里一个表达式，提交钩子的 prettier 顺手把文件里那行 88 列的 `import { a, b, c } from '…'` 折成四行，而逐行过滤器只删第一行——剩下三行 `  findMarkdownHeadingLine,` 变成"求值即抛"的表达式语句，**11 条用例（含 10 条既有）在装载阶段全红**。修法是把剥 import 做成按语句（`test/unit/sfcScriptHarness.ts`，深度跟踪 `import { … } from`），并补 `sfc-import-strip.spec.ts` 6 条把折行形状钉住。教训两条：**prettier 重排的不是"无关空白"，它是会改变逐行文本处理器的输入**；以及"我只改了一个表达式"不能推出"只有测那个表达式的用例会受影响"。

**第四轮另三面（写路径自洽 / 文件名与路径 / 过期异步响应）已立案跟踪**：分别是 issue **#26**、**#27**、**#28**，条目、复现配方与"已确认干净"的清单都写在 issue 正文里，本节只记每批第一条的实测闭环。

**#26 第 1 条：格式类动作把标签标成"已保存"→ 重启后静默丢内容（本批已修）**。`store/editor.ts` 的 `SET_LINE_ENDING`（`:755`）、`LISTEN_FOR_SET_ENCODING`（`:774`）、`LISTEN_FOR_SET_FINAL_NEWLINE`（`:786`）三处都写了 `this.currentFile.isSaved = true`，而**这三个动作根本不写盘**——`mt::set-line-ending` 只有菜单在发（`src/main/menu/actions/edit.ts:132`），主进程侧没有任何 handler；另两条是渲染端 bus 事件（`commands/fileEncoding.ts:77`、`commands/trailingNewline.ts:71`）。清掉脏标记之后：关标签不再询问（`store/tabClose.ts:30` 以 `isSaved` 判断），而重启时 `main/windows/editor.ts:641-646` 的规则是"已保存的标签可以用磁盘文本替换缓冲"——于是那次未保存的编辑**从磁盘、内存、崩溃缓冲三处同时消失**。修法就是把这三行去掉（元数据变更交给下一次保存落地），不新增"标成脏"的语义：那会让"打开菜单项点个值"凭空产生未保存工作，属产品决策，留在 #26。

- 回归：`test/unit/specs/format-actions-dirty.spec.ts` 5 条（三个动作各一条 + 两条守住"干净标签不许变脏"和"同值重复调用无副作用"）。修复前**正好红 3 条**（`expected true to be false`），两条守卫修复前后都绿。
- e2e：`test/e2e/format-line-ending-dirty.spec.ts`，真窗口里打字 → 发行尾切换 → 断言 `.editor-tabs li.unsaved` 还在。修复前红在**第二次**切换（`Expected: 1 / Received: 0`），因为第一次发送的值恰好等于文档当前行尾、被 `if (lineEnding !== oldLineEnding)` 早退吞掉——**这就是第一版用例空跑的原因**（初稿点一次菜单、断言标记还在，在未修复的构建上 2/2 全绿）。改成 `crlf → lf → crlf` 交替后，无论初始值是什么都至少两次是真切换。
- 另两条同族动作没有 e2e：它们的唯一入口是命令面板的子命令流程（要开面板→选子命令），单条 IPC 打不到 `bus.on`；已按"覆盖到什么程度就说什么"记在 PR 里，store 层三条都有。

**#27 第 1 条：文档里的链接目标含裸 `%` 让主进程抛 `URIError`（本批已修）**。`main/menu/actions/file.ts` 的 `mt::format-link-click` 处理器对拼好的路径直接调 `decodeURIComponent`，而 `typedOn`（`main/ipc/typedOn.ts:25-31`）**不加 try/catch**——`%` 后面不是两位十六进制就抛（实测：`100%done.md`、`50%.md`、`%.md`、`%zz.md` 全抛 `URIError: URI malformed`），异常沿 `process.on('uncaughtException')` 走到 `main/exceptionHandler.ts:108,125` 弹**模态错误框**，而链接本身什么都没发生。修法是把解码收进 `common/filesystem/paths.ts` 的 `decodeLinkPathname()`：抛了就按原样返回。

- 语义边界要说清：`My%20Image.png` → `My Image.png`、`100%25done.md` → `100%done.md` 这些**仍然是解码**（那正是 issue #57 加这条通路的原因）；而**真名叫 `a%41b.md` 的文件会被打开成 `aAb.md`**——两种写法在字符串层面不可区分，本批不假装解决，只把它钉成一条用例（`link-click-pathname.spec.ts` 第 4 条）并注明这是接受的残余，避免以后有人"顺手"把解码整个去掉。
- 回归：单测 5 条（六种抛法都不抛、合法编码照旧、普通路径不变、歧义残余、空串）；e2e 走**真实通道** `window.electron.ipcRenderer.send('mt::format-link-click', …)`，修复前红在 `toHaveCount(2)`（`Expected: 2 / Received: 1`，第二个标签页根本没出现，即"点了没反应"），修复后 2 passed。
- 同面未做：**#27 第 2 条**（导出把路径拼成 `file://…` 却不编码，名字含 `#` 或 `%20` 的图片在导出的 HTML/PDF 里失效）与**第 3 条**（quick-open 查询未转义进 `rg --iglob`）是另外两条独立通路，各自单独一批；**三条"需要测量"的**（保留设备名走对话框默认值、尾点、侧栏新建用 `/` 硬拼）也留在 #27 里等复现结论。

**#28 第 1 条：历史面板预览的过期响应（本批已修）**。`components/sideBar/history.vue` 的 `openPreview` 在 `await window.versionHistory.getContent(...)` 之后无条件写 `preview.content` 与 `preview.loading`——**同一文件里的 `loadSnapshots` 早就有 `if (requested !== currentPathname.value) return` 这道守卫（`:157`），预览这半边漏了**。后果：连点两个快照时，先点那个的磁盘读后到，正文会挂在新选中标题下，而且它的 `finally` 会提前灭掉仍在飞的那次请求的 loading。

- 修法是一个 newest-wins 计数器（`let previewRequest = 0` + `const seq = ++previewRequest`）。**为什么不用对象身份比较**：`preview` 是 `reactive()`，存进去的对象取出来是代理，`preview.meta !== snapshot` 对**合法**响应也成立——我第一版就是这么写的，被自己的第二条用例当场抓红（`expected '' to be 'ONLY-CONTENT'`）。计数器同时覆盖"同一行点两次"这种身份比较本来会判错的情形。
- 回归用**确定性**构造而不是时序：`getContent` 由测试返回手工结算的 deferred，A 只可能在 B 被选中之后才落地，所以没有"跑得慢就算过/跑得快就算不过"的抖动。修复前红 1 条（`expected 'A-CONTENT' not to be 'A-CONTENT'`），另一条"合法响应照常渲染"前后都绿（它守的是守卫别把好的也丢掉）。

**#28 第 2 条：导出把 A 标签的内容配 B 标签的身份（本批已修，#28 里后果最重的一条）**。`store/exportPrint.ts` 的 `sendExportResponse` 在**被调用的那一刻**现读 `store.currentFile`（`filename`/`pathname`）与 `store.listToc`（标题），而调用它的 `editorStore.EXPORT(...)` 全部位于 `editor.vue` 的 `handleExport` 里、**在 `await exportStyledHTML(...)` 之后**（导出要渲染整篇文档，之后还要开原生保存框）。导出设置对话框先关（`components/exportSettings/index.vue:486-487`），所以那段等待期里用户可以切标签——于是**文档 A 的字节被写进以文档 B 命名的文件**（`type` 为 docx 时连 `exportDocx(content, … filename)` 都用现读的 `currentFile`）。

- 修法：**身份随请求走**。`ExportPayload` 加必填字段 `source: ExportSource | null`（`{filename, pathname, title}`），由新 store action `CAPTURE_EXPORT_SOURCE()` 在 `handleExport` 第一个 `await` 之前冻结；`sendExportResponse` 不再读 `store`，没有 `source` 就不发。类型系统这次站在我们一边：把字段设成必填后 `vue-tsc` 立刻指出全部 5 个调用点（`editor.vue:949/:973/:1008/:1032/:1049`）都缺它，不会有漏网的分支。
- **变异验证**（不是"改回旧代码看红"）：保留新 API，只把 `sendExportResponse` 内的身份来源换回现读 `store.currentFile`/`store.listToc`——**正好红 2 条新用例，8 条既有用例全绿**；恢复后 10/10 绿。这说明新用例测的是身份时机，不是函数签名。
- 没做 e2e：那条竞态要"导出渲染期间切标签"，在真窗口里只能靠时序撞，不稳。改为在 store 层用**手工切换 `currentFile` / `listToc`** 构造出同一时机（`export-print-actions.spec.ts`）。
- `#27` 的第 2/3 条（导出不做 URL 编码、quick-open 查询未转义进 `rg --iglob`）同理另开批次。

**#28 第 3 条：收起搜索条之后，在飞的 ReDoS 探针把用户已经丢掉的查询重新打上高亮（本批已修）**。`components/search/index.vue` 的 `emptySearch`（`:276` Escape、`:282` 点正文任一处）原先只是收起搜索条并清 `searchValue`，而 `searchValue` 的 watch 在收起态直接早退（`:168-171`）——**没有任何人取新的序号**，于是停在 `await probeSearchRegex(...)`（预算 4000 ms，看门狗 5500 ms = 预算 + 1500，`searchRegexProbe.ts:18` + `regexProbeShared.ts:7`）上的 `searchFn` 仍然是"最新一次"，几秒后照常 `bus.emit('searchValue', {value: 已丢弃的查询})`，把高亮打回一篇用户已经不想搜的文档。

- 修法：`emptySearch` 里 `seqGuard.take()`——"作废"本身就是一次新意图，取号即让在飞的探针失去发射资格。这类写点全仓只有一处（`showSearch.value = false` 只出现在 `emptySearch` 内，`:291`），两个入口都经过它，所以不存在漏网的第二处。
- 回归：`test/unit/specs/search-prefill.spec.ts` 加 3 条——一条把探针换成**手工结算的 deferred**，在飞行途中调 `emptySearch()`，结算后断言 `bus.emit` 没收到那个被丢弃的正则查询；一条断言**迟到的超时报告**也不许写进 `searchErrorMsg`（那行写在 `await` 之后，同一道闸门正好顺住它）；第三条是正对照（不作废时**必须**发射），防修法退化成"探针结果一律不发"。修前 1 failed / 3 passed，修后 5 passed；**变异验证**：把那行 `seqGuard.take()` 注掉 → 恰好 2 条作废用例红、正对照与原有 2 条全绿，还原后 5/5。顺带给这份 harness 加了依赖覆写与 `emit` 句柄：原先 `bus.emit` 的 spy 不外露、`useEditorStore` 桩件对任何属性都返回函数，正则分支根本走不到探针。
- 没做 e2e：真窗口里要稳定复现"探针在飞 + 中途作废"，得让 worker 真的忙几秒（灾难性正则 + 足够大的文档），那是靠时序撞的用例，正是 §14.1 刚记下的那类形状。手动复核（约 20 秒）：开搜索条 → 勾正则 → 输入 `(a+)+$`（文档需有几十行长文本）→ 回车后**立刻点正文空白** → 看高亮是否在几秒后自己回来（修复前会回来）。

**#28 第 4 条：quick-open 退格清空之后，旧查询的结果还是填回列表（本批已修，顺带查出一个更深的死开关）**。三处独立缺陷叠在一起：

- **面板侧**：`components/commandPalette/index.vue` 的 `updateCommands()` 把 `cmd.search()` 的答案**无条件**写回 `availableCommands` / `selectedCommandIndex`。空查询那一次是在微任务里就结算的（直接返回已打开标签表），上一条按键启动的目录搜索后到，于是把用户已经删掉的查询的结果盖回去——此时输入框是空的，回车会打开那个文件。修法：`updateCommands` 取一个自增号，`.then` 与 `.catch` 只在仍是最新时才写回（与本节 history 预览、搜索条那两处同一个 newest-wins 形状）。
- **命令侧**：`commands/quickOpen.ts` 的 `search()` 把"空查询早退"排在**取消块之前**，所以退格那一次按键根本不取消在跑的扫描。
- **本批新查出、issue 里原先没记的一条**：`_doSearch` 里两处取消都写成 `const promises = searcher.search(...).then(...).catch(...)`，而 `cancel` 只挂在 `node/ripgrepSearcher.ts:121` 返回的那个 promise 上——`.then()` / `.catch()` 产出的是丢了方法的普通 Promise，所以 `if (promises.cancel)` 恒假，**"超过 30 条即停"和"新按键取消旧的"两处取消一直是空操作**。修法是把裸句柄和链分开。可见后果要分清：`didMatch` 里的 `canceled` 标志仍然生效（列表停在 30 条左右），但 `rg --files` 会跑完整棵树，且**每次按键一次**。

- 回归：`test/unit/specs/command-palette-stale-results.spec.ts` 3 条（迟到的成功答案不许覆盖、迟到的失败答案不许清空、**最新一次仍须生效**的正对照）+ `test/unit/specs/quick-open-empty-cancel.spec.ts` 3 条（退格清空取消在跑的搜索、新非空查询照旧取消、">30 条"真的调到 `cancel()`）。面板那三条走真实 `<script setup>`：`test/unit/sfcScriptHarness.ts` 新增 `loadSfcSetup`，注入名单由 deps 自己推出来，不再手抄一份。
- **变异验证逐个定位**：只把"空查询早退"移回取消块之上 → 恰好第 1 条红；只把 `search.cancel()` 换成空操作 → 恰好第 3 条红；两处都没修（原始代码）→ 第 1、2 条一起红。三条各钉一个独立失效点，不是一起红一起绿的打包。
- 没做 e2e：`rg --files` 的耗时取决于真实仓库大小与 CI 机器，"300 ms 防抖 + 慢搜索 + 立刻退格"在真窗口里是靠时序撞；面板侧的写回要在 e2e 里 mock 主进程 rg 事件，超出那一层。手动复核：在含几千个文件的项目根里 `Ctrl+P` → 打一个字符 → 立刻退格清空 → 看列表是否被旧结果填上（修复前会）。

**#26 第 3 条：最近文档清单写不下去时，把一次已经成功的保存报成"保存失败"（本批已修）**。`main/menu/index.ts` 的 `addRecentDocument` 与 `clearRecentlyUsedDocuments` 都以裸 `fs.writeFileSync` 收尾，而前者是经 `menu-add-recently-used` 这条内部通道进来的，`main/menu/actions/file.ts:307` 把它发在 `writeMarkdownFile(...).then(...)` **里面**。于是 recents 文件只读（或被同名目录占了位）时：`.then` 抛出 → 派生 promise 变 rejected → 走到保存自己的 `.catch` → 渲染端收到 `mt::tab-save-failure`，**可文件早就写进磁盘了**；另存为那条更糟——`mt::set-pathname` 排在 emit 之后，永远不执行，标签还挂着旧文件名。

- 修法：把写挪到 `main/utils/recentDocuments.ts` 里，与它的读对岸（`readRecentlyUsedDocuments` 本来就 try/catch + 记日志返回 `[]`），新函数返回布尔而不是抛；`menu/index.ts` 里因此空出来的 `fs`/`ensureDirSync` 两个 import 与只写不读的 `_userDataPath` 字段一并删掉。
- 回归：`test/unit/specs/recent-documents-write.spec.ts` 4 条——正常写入并回报成功、父目录不存在时创建、**只读文件**下回报失败且不抛且旧内容原样留着、**路径是目录**下同样不抛。后两条在 Windows 上就是 `fs.chmodSync(p, 0o444)` 触发 EPERM，Linux/macOS 上是 EACCES，两边都不需要 root。
- **变异验证**：把 `catch` 改成重新抛出 → 恰好那 2 条失败路径用例红、另外 2 条绿；还原后 4/4。
- 没做 e2e：这条的判据是"一个函数在写不进去时抛不抛"，单元层就够，且 e2e 要稳定造出只读的 `userData` 文件反而更脆。手动复核（约 30 秒）：`attrib +r %APPDATA%/colamd/recently-used-documents.json`（mac/linux 用 `chmod 444`）→ 新建标签打字 → Ctrl+S 存成新文件 → 标签应当变干净（修复前会弹"保存失败"且文件名不变）。
- #26 剩下的第 2 条（缓冲存储写失败只 `console.error`，且 `updateBufferState` 无论成败都返回 `true`）与第 4 条（关闭时选"保存"失败仍把窗口关掉）各自另开一批。

**#27 第 3 条：quick-open 的查询未转义就进了 ripgrep 的 glob（本批已修）**。`commands/quickOpen.ts` 的 `_getInclusions()` 把 `*${query}` 原样交给 `main/ipc/ripgrep.ts` 的 `--iglob`，而 `[` `]` `{` `}` `?` 在 glob 里是语法。用**应用自带的那份 rg**（`node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe`，ripgrep 15.0.0）在一个同时放了 `a[1].md` 与 `a1.md` 的目录上实测：

- `--iglob '*a[1].md'` → **只命中 `a1.md`**（用户要找的那个文件反而找不到）；`--iglob '*b{1}.md'` → 只命中 `b1.md`；`--iglob '*c?.md'` → 命中 `cX.md`（`?` 当单字符通配）。
- `--iglob '*a{.md'` / `'*a[.md'` / `'*}.md'` → **rg 退出码 2**（`error parsing glob`），走 `finishIfError` → 面板清空。issue 里"畸形 `{` 会退出 2"这句**成立**，但要补一句边界：`*a{2,}.md` 是**合法**的（rg 认这个重复量词，退出码 1=无匹配），所以不是"见到 `{` 就报错"。

- 修法：每个元字符换成**单元素字符类**（`[` → `[[]`、`]` → `[]]`、`{` → `[{]`、`}` → `[}]`、`?` → `[?]`），实测这些形式在 rg 15.0.0 上精确命中字面名且不误伤；`*` 保持通配（与同一命令里标签那一支的语义一致，PR #24）。**为什么不用最常见的 `\` 转义**：`prepareGlobs`（`src/main/ipc/ripgrep.ts:142`）会把模式里每个 `path.sep` 改写成 `/`，Windows 上那正好是反斜杠——转义会被它吃掉。这也是当初必须先量一次的原因：不看 `prepareGlobs`，`\[` 看起来是标准答案。
- 回归：`test/unit/specs/quick-open-glob-inclusions.spec.ts` 4 条——普通查询逐字不变（守住常用路径没被改坏）、五个元字符各成一类、"查询自带扩展名"那一支同样转义、`*` 仍是通配。修前 2 failed / 2 passed，修后 4/4。
- 没做 e2e：真窗口里要走到磁盘这一支，需要 quick-open 的 `_folderState.projectTree` 真被填上（现有 e2e 只覆盖标签那一支）；而"这些 glob 在 rg 上确实按字面匹配"这条已经用**同一个二进制**量过并把命令写在上面，可复现。手动复核：在一个含 `a[1].md` 与 `a1.md` 的目录里 `Ctrl+P` 输 `a[1]` → 修复前列表是空的或只有 `a1.md`。
- #27 剩下的：第 2 条（导出目的地用拼接不做 URL 编码，名字含 `#`/`%20` 的图片在导出 HTML/PDF 里失效）单独一批；三条"需要测量"的仍等复现结论。

**#26 第 2 条：崩溃恢复缓冲写失败被当成写成功上报（本批已修）**。`main/editorBufferStore/index.ts` 的 `writeBufferStoreFile` 用 `.catch(console.error)` 把失败吞成 **resolved**，`updateBufferState` 又是 fire-and-forget 并且**无论成败都 `return true`**。渲染端 `store/bufferedState.ts` 的签名闸门把这件事放大了一层：它在**发出 invoke 之前**就把 `lastSentSignature` 记成这次快照的签名，于是失败之后签名已经"用掉"——状态不变就再也不发，**一次写失败之后没有任何重试路径**，崩溃缓冲悄悄停在上一份快照。

- 修法三处一起，缺一处都不自洽：`writeBufferStoreFile` 回报布尔（队列链仍挂一个不 reject 的派生 promise，避免一次失败毒化同一文件后面的写）；`updateBufferState` 改 `async` 并 `return` 那个结果——它是 `ipcMain.handle` 的处理器，返回 promise 只决定渲染端 invoke 何时结算，**不会把 fsync 放回主进程同步路径**（M1.4 的约束仍成立，注释已改写清楚）；渲染端只在拿到非 `false` 时提交签名，失败就留给下一次重试。
- 回归：`buffer-store-durable.spec.ts` 加 4 条（成功回报 `true`、目标被目录占位时回报 `false` 而不是"像成功了"、**失败之后同一文件仍能写进去**、invoke 处理器的返回值等于写入结果）；新增 `buffered-state-signature-gate.spec.ts` 2 条（写失败后仍会再发、写成功后未变状态照旧被闸门跳过）。
- **变异验证**：把 `.then(() => true, () => false)` 换回原来的 `.catch(console.error)` → 主进程那 4 条全红、既有 3 条耐久性用例绿；把渲染端改回"发出前先记签名" → 恰好"失败后仍再发"那条红、正对照绿。第一版两条一起红，暴露出**用例之间共享模块状态**，已改成每条各自 `vi.resetModules()` 重新取模块——就是 §14.1 那条教训在单测里的版本。
- 没做 e2e：这条要的是"磁盘写不进去时返回值诚实"，单元层用目录占位文件就能确定性触发；真窗口里制造同样的失败要改 `userData` 权限，比被测代码更脆。
- #26 第 4 条（关闭时选"保存"失败仍把窗口关掉）在 PR #41，合入后本 issue 四条全部闭环。

**#26 第 4 条：关闭时选"保存"，只要有一个标签没写成功，窗口照样被销毁（本批已修）**。`main/menu/actions/file.ts` 的 `mt::close-window-confirm` 是 `Promise.all(...).then(() => ipcMain.emit('window-close-by-id', win.id))`，而 `handleResponseForSave` **从不 reject**——用户在保存对话框上点取消、或者写盘失败，它都是 **resolve 一个空值**（成功时才 resolve 标签 id）。于是那条 `.then` 无条件关窗，下面那个"要关还是要留着"的 `.catch` **在这条路径上根本不可达**。同一文件里的 `mt::save-and-close-tabs` 早就写对了：它按返回的 id 过滤，只关真正保存成功的标签。

- 修法：把这条策略抽成可测的谓词 `everyTabSaved(results, unsavedFiles)`（`main/utils/index.ts`），处理器的 `.then` 只在**每个**标签都回报了 id 时才关窗；否则把没写成的文件名交给一个抽出来的 `askBeforeClosingWithUnsaved(win, detail)`——就是原来那段"关闭 / 保持打开"的对话框，现在两条路（部分未保存、真异常）共用它。
- 回归：`test/unit/specs/close-requires-saved-tabs.spec.ts` 5 条（全部回报 id 才放行、一个取消就拦、一个写失败就拦、结果数少于请求数也拦、空请求视为无事可等）。
- **要说清的限度**：谓词有单测，**处理器本身没有自动化回归**。`file.ts` 的 import 面（pandoc、imageExport、filesystem、commands、i18n、windows…）在单测里要全部 mock 才碰得到那条 `typedOn`，成本高于收益；主进程 handler 级的测试脚手架是仓库现有的缺口，记在 #34 的"诊断面"里。手动复核（约 30 秒）：新标签打字 → Ctrl+W 关窗 → 选"保存" → 在另存为对话框点**取消** → 修复前窗口直接消失且内容未落盘，修复后弹"保存失败/保持打开"。
- 措辞上的一处取舍：取消对话框这种情况现在也复用既有的 `dialog.saveFailure` 文案（detail 里列出没写成的文件名）。新建一个 i18n 键要动 11 份语言文件，属产品文案决定，不在稳定期的健壮性批里顺手做。
- #26 四条到此全部有批（1=#29、2=#40、3=#38、4=本批）。

## 16. 已关闭的功能候选与重启条件（2026-09-29 重评估）

评估结论：七项全部不做——各项代价都落在刚建好的安全边界或架构稳定性上，而收益属于低频或无证据场景。重启条件（成立时单独立项，其余不预支）：

| 候选                                                                           | 重启条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 大纲拖拽重排                                                                   | 写长文档时重组章节的痛点真实出现（需动 muya 块移动语义并保住撤销栈）                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 文件树虚拟化                                                                   | 实测大目录渲染卡顿（当前自定义递归树，先测基线）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 文件夹搜索面板                                                                 | 自己开始想念跨文件搜索（V1 曾有意下线，恢复是产品决策）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 浮动格式工具栏对齐                                                             | 拿到 Typora 1.14 可对照的具体形态差异清单                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 多根工作区                                                                     | 出现同时挂载多个根目录的真实需求（需重设计 pathScope 授权模型）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 插件系统                                                                       | 引擎发版后出现真实的第三方扩展需求                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 协同编辑                                                                       | 决定把产品转向服务型应用（OT 底座保留，已为撤销系统服务）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AI 辅助写作                                                                    | 你做出明确的产品方向决策（目标用户、交互形态、密钥与隐私边界）并单独立项                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 远期生态：`colamd://` URL 协议、外部编辑器集成、PicList 图床上传器、TextBundle | **2026-09-29 从已退役的 `OPTIMIZATION_ROADMAP` §8.1 捞回**——退役那次只处置了 §8 的 7 条候选，这一条当时仍是未开工状态，之后活文档里 grep `colamd://` / `PicList` / `TextBundle` 零命中。重启条件：出现真实的外部唤起或图床需求。注意 `colamd://open?path=…` 本质是给应用一个任意本地路径的读入口，属安全边界变更，动工前要先过 `pathScope` 的授权口径（见 §6），不能当普通功能做                                                                                                                                                                   |
| 标题样式偏好（ATX / Setext）                                                   | **已于 2026-09-29 删除整条死链**：偏好页那行本来就 `:disable="true"`（渲染出来但点不动），全仓无任何消费者；引擎里唯一读 `headingStyle` 的是 turndown 的 heading 规则（`utils/turndownService/index.ts:188`），而生产路径 `clipboard/paste.ts:747` 只传 `{ bulletListMarker }`，所以它永远取 `DEFAULT_TURNDOWN_CONFIG` 的 `'atx'`；`IMuyaOptions` 里也没有这个键。重启条件：引擎先把它做成真正可配置的选项，**并先定清语义**——只管粘贴/导入时的 HTML→Markdown，还是连编辑器里新建的标题也用 setext（后者会动块的序列化形态，不是接一行映射就完事） |
