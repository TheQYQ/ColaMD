# ColaMD 项目说明文档

> 面向新贡献者的整体说明：项目定位、技术栈、仓库结构、运行时架构、模块地图、功能到代码的落点、构建与测试体系，以及当前代码与既有文档不一致之处。
>
> 内容全部以当前工作区代码为准（分支 `develop`，`9449f8f`，2026-09-19）。路径与行为如与本文冲突，以代码为准并请回修本文。

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

pnpm workspace 声明了 **三个** 包（`pnpm-workspace.yaml:2-8`，`CLAUDE.md:43` 只写了 `packages/*`，遗漏后两条）：

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
    │   └── test/{unit,e2e}   61 个单测 spec + 63 个 E2E spec
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

| 目录                 | 职责                                                                                                                                                                                        | 关键文件                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `app/`               | `App` 控制器：ready/second-instance、开窗、路径打开、约 15 个 IPC；`Accessor` DI；`WindowManager`（505 行）窗口注册与 `findBestWindowToOpenIn`                                              | `app/index.ts`(894)、`app/accessor.ts`、`app/windowManager.ts` |
| `cli/`               | argv 解析；dev 模式强制 userData 目录为 `colamd-dev`                                                                                                                                        | `cli/index.ts:13-16`                                           |
| `commands/`          | 主进程侧命令注册（多数命令在渲染端）                                                                                                                                                        | `commands/index.ts:66`                                         |
| `contextMenu/`       | 编辑区**原生**右键菜单，仅在 `isInsideEditor(params)` 时构建；拼写建议必须走 `context-menu` 事件（Electron#28684）                                                                          | `contextMenu/editor/index.ts:59,123`                           |
| `dataCenter/`        | 图片/截图目录与图片缓存清单（`electron-store`），含旧 uploader 值迁移                                                                                                                       | `dataCenter/index.ts:58-62`                                    |
| `editorBufferStore/` | **未保存标签内容的磁盘副本**，用于崩溃/会话恢复；放在主进程是因为 `App.ready()` 要在任何窗口存在之前枚举它们；写入 `write-file-atomic` + fsync + 每文件 promise 队列                        | `editorBufferStore/index.ts:174-190,225`                       |
| `filesystem/`        | 原子写、Markdown 读取与编码探测、每窗口 chokidar watcher                                                                                                                                    | `filesystem/watcher.ts`(513)                                   |
| `ipc/`               | 沙箱安全 handler 层，一域一文件，由 `ipc/index.ts:14-27` 统一注册                                                                                                                           | `ipc/{fs,menu,shell,ripgrep,window,i18n,fonts,…}.ts`           |
| `keyboard/`          | `native-keymap` 键盘布局监听 + 加速器→命令派发；用户 `keybindings.json`                                                                                                                     | `keyboard/index.ts:87`、`keyboard/shortcutHandler.ts`(276)     |
| `menu/`              | **两套并存**：`AppMenu` 为每个窗口构建原生 `Menu`（`:443-451`，`:552` 自称 HACKY）；无边框窗口另在渲染端渲染菜单条，需要原生弹出时用 `mt::menu::popup` 传 JSON 模板、`mt::menu::click` 回流 | `menu/index.ts`、`menu/{actions,templates}/`                   |
| `preferences/`       | **只存不窗**：`electron-store` + schema + 迁移 + 同步广播。设置窗口在 `windows/setting.ts`                                                                                                  | `preferences/index.ts:48-52,135`                               |
| `security/`          | `pathScope`：写/删/移动类操作的根目录白名单，`assertPathInScope` 走 realpath；读通道刻意不设限                                                                                              | `security/pathScope.ts:28-42`                                  |
| `spellchecker/`      | `session.*` 薄封装 + 5 个 `mt::spellchecker-*`；macOS 用系统拼写检查                                                                                                                        | `spellchecker/index.ts:46`                                     |
| `utils/`             | 内部事件封装、pandoc、离屏打印窗导出图片、图片路径自动补全、生成 GitHub issue                                                                                                               | `utils/{internalIpc,imageExport,pandoc}.ts`                    |
| `versionHistory/`    | 按文件快照存储 `{userData}/version-history/{sha1(path)}.json`，上限 50 条并去重                                                                                                             | `versionHistory/index.ts:73-89`                                |
| `windows/`           | `base.ts` 定义 `WindowType`/`WindowLifecycle` 并用 URL query 把窗口类型传给渲染端；`editor.ts`(694) 编辑器窗                                                                                | `windows/{base,editor,setting,utils}.ts`                       |

## 6. 跨进程边界

### 6.1 IPC 契约

`packages/desktop/src/shared/types/ipc.ts`（368 行）是单一事实来源，分四张表：`IpcInvokeChannels` 41、`IpcSendChannels` 82、`IpcSyncChannels` 2、`IpcMainEventChannels` 69。实测主进程注册 **41 个 `ipcMain.handle` + 64 个 `ipcMain.on`**，反向 `webContents.send` 约 94 处。

- 命名：`mt::` 是主流但不彻底（handle 40/41、on 58/63）。例外包括 `update-buffer-state`、`app-create-editor-window`、`menu-clear-recently-used`、`settings::change-tab`、`language-changed`，以及约 22 个用 `ipcMain.emit` 派发的 **进程内通道**（`broadcast-preferences-changed`、`window-close-by-id`、`watcher-watch-file`…）。
- `mt::` 内部层级也不统一：`mt::fs::read-file`（双冒号）vs `mt::fs-trash-item` vs `mt::version-history:save`。
- 类型强度是 **单向** 的：preload 侧泛型以 `keyof` 约束通道名（真安全）；主进程 `ipcMain.handle('mt::fs::write-file', …)` 与契约 **没有类型关联**，且契约自身承认载荷是 `unknown[]`/`unknown`（`ipc.ts:10-12`）。改载荷结构不会被编译发现。

### 6.2 preload 与沙箱（当前真实状态）

`src/preload/index.ts:297-308` 暴露 11 个全局，约 80 个成员：`electron`（`ipcRenderer` 6 个函数、`shell` 3、`clipboard` 3、`webFrame` 1、`webUtils` 1、`windowControl` 9、`dialog` 4、`process`/`paths`/`isUpdatable`）、`process`（shim 7 键）、`rgPath`、`fileUtils` 14、`path` 12（`pathe` 支撑）、`commandExists`、`i18nUtils`、`ripgrep` 6、`uploader`、`versionHistory`、`fonts`。启动时一次阻塞的 `ipcRenderer.sendSync('mt::boot-info')`（`:36`）。

三类窗口全部 **`contextIsolation: true` + `sandbox: true` + `nodeIntegration: false`**（`src/main/config.ts`，编辑器窗 L12/13/18，偏好窗 L40/41/44，离屏导出窗 `utils/imageExport.ts:32-34`）。开发态放宽 `webSecurity` 以便 Vite dev server 加载 `file://` 图片，生产恢复全量同源策略。`app/index.ts:133-143` 拒绝 `will-attach-webview`、`will-navigate`、`setWindowOpenHandler`。

> 渲染端全局变量的类型声明在 `src/types/global.d.ts`，新增桥接方法要同时改契约、preload、ambient 三处。

## 7. 渲染进程地图（`src/renderer`，216 文件 / 47 `.vue` + 89 `.ts`）

### 7.1 启动与路由

`src/index.html` → `src/main.ts`。`bootstrapRenderer()`（`bootstrap.ts:101`）从 URL query 解析 `wid/type/udp/theme/cff/cfs/hsb/tbs`，注册全局错误处理（含一处 CodeMirror 竞态抑制 `:65`），构造 `RendererPaths`；随后 `createApp(Main)` 装 Element Plus（locale 硬编码 `en`）、Vue Router、Pinia、vue-i18n（`main.ts:33-48`），并 side-effect 引入 SVG sprite 与全局样式。`Main.vue` 只有一个 `<router-view/>`。

路由只有两页（`router/index.ts`）：`/editor` → `pages/app.vue`，`/preference` → `pages/preference.vue`（子路由 `general|editor|markdown|spelling|theme|image|keybindings`）。

### 7.2 状态（Pinia）

| Store                                                                | 文件                                              | 职责                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| `editor`                                                             | `store/editor.ts`（**2347 行**，约 85 个 action） | 标签、当前文件、TOC、保存/导出/关闭/切换/自动存 —— 事实上的上帝 store |
| `preferences`                                                        | `store/preferences.ts`（348）                     | 全部用户偏好，经 `mt::set-user-preference` 同步                       |
| `project`                                                            | `store/project.ts`（394）                         | 打开的目录与文件树、新建/粘贴/重命名                                  |
| `commandCenter`                                                      | `store/commandCenter.ts`                          | 命令注册表 + `executeCommand`；`:53` 接收 `mt::keybindings-response`  |
| `layout` / `main` / `listenForMain` / `autoUpdates` / `notification` | 各自同名文件                                      | 面板可见性与宽度 / 平台与窗口激活 / IPC→bus 中继 / 自动更新 / 通知    |

同目录的非 store：`store/help.ts`（文件状态工厂）、`store/bufferedState.ts`（会话缓冲，5s debounce / 30s maxWait）、`store/treeCtrl.ts`（树变更）。

**与引擎的耦合方式**：store 从不持有编辑器实例。`editor.vue:1957-1965` 用 `markRaw` 持有 `new Muya()`，再向 `editorStore` 推 `LISTEN_FOR_CONTENT_CHANGE`/`UPDATE_TOC`/`SELECTION_CHANGE`。跨模块解耦靠 mitt bus（`src/bus/index.ts`），`listenBoth()`（`:17`）一次注册同时挂 IPC 与 bus，于是原生菜单、窗口内菜单、命令面板共用同一条动作路径；`pages/app.vue:166-217` 挂载时注册约 30 个 `LISTEN_FOR_*`。

### 7.3 界面骨架

`pages/app.vue:2-45` 组合出 Typora 式外壳：

- 标题栏 `components/titleBar/index.vue`(362) —— 当前形态是 36px 面包屑标题栏（提交 `2987c99`）
- 菜单条 `components/menuBar/index.vue`(214) + `MenuList.vue`，模板来自 `menu/menus.ts`(724)，仅在 `titleBarStyle === 'custom' && !isOsx` 时渲染
- 侧边栏 `components/sideBar/index.vue`(204)，**只有 `files` 与 `toc` 两个 tab**（`sideBar/help.ts:13-22`）
- 编辑区 `components/editorWithTabs/index.vue`（含 `editor-search v-if="hasCurrentFile"` 的文档内查找条）
- 状态栏 `components/statusBar/index.vue`（左：源码模式开关；右：字数统计）
- 浮层：未保存对话框、命令面板、关于、导出设置、重命名、导入

最大的几个文件：`store/editor.ts` 2347、`components/editorWithTabs/editor.vue` 2321、`prefComponents/image/components/uploader/index.vue` 1193、`commands/index.ts` 766、`menu/menus.ts` 724、`prefComponents/theme/index.vue` 689、`util/docx/document.ts` 648、`sourceCode.vue` 628。改动这些文件请预期高冲突。

### 7.4 两个编辑面

`editorWithTabs/index.vue` 始终挂载 `<editor>`（Muya），`v-if="sourceCode"` 时并挂 `<source-code>`（CodeMirror 5，封装在 `codeMirror/index.ts`）。模式是 **全局偏好，不是每标签属性**；光标交接靠 `muyaIndexCursor` 与 `editor.vue:157` 的 `preSourceModeSelection`。两者共享同一份 `markdown` 与 bus 上的搜索事件，并用 `if (sourceCode.value) return` 互斥（如 `editor.vue:1198`）。

## 8. Muya 引擎（`packages/muya`，`@muyajs/core 0.2.0`）

引擎自带全套工具链（ESLint/antfu、stylelint、madge、vitest），根 ESLint 明确忽略 `packages/muya/**`。架构要点（完整版在 `packages/muya/CLAUDE.md`）：

- `new Muya(el, options)` 替换目标元素为 `contenteditable` div，构造 `EventCenter`/`Editor`/`Ui`/`I18n`；`muya.init()` 里 `Editor.init()` 调 `registerBlocks()` 并创建根 `ScrollPage`。**新增块类型必须在 `src/block/index.ts::registerBlocks()` 注册，否则 `loadBlock` 返回 undefined。**
- UI 插件通过静态 `Muya.use(Plugin, options)` 全局注册、按 `pluginName` 存进 `muya._uiPlugins`；`examples/src/main.ts` 是权威装配样例。
- `Editor`（`src/editor/index.ts`）持有 `JSONState`/`InlineRenderer`/`Selection`/`Search`/`Clipboard`/`History`/`ScrollPage`，把 `click/input/keydown/keyup/composition*` 经 RxJS 合并后路由给当前活动块。`Editor.updateContents()` 手写 `ot-json1` 的 pick/drop walk，使块树与 JSON 状态同步。
- 块继承链 `TreeNode → Parent → (Content | Format)`；`Parent` 持有 `LinkedList` 子节点与 `attachments`。具体块在 `src/block/{commonMark,gfm,extra,content}`。
- Markdown 往返：`markdownToState`（`marked`）/ `stateToMarkdown` / `markdownToHtml` / `htmlToMarkdown`（`turndown` + gfm 插件）。引用式链接定义 **不是** 一等块类型，`case 'def'` 把原始定义行塞回 paragraph 以保证往返无损。
- 撤销栈是真 OT（`invertWithDoc`/`compose`、时间与词边界合并、IME 恒等 op 防护），不是快照栈；架构上为协同编辑预留了 `transform`，但 **没有任何 transport 接上**。
- 内联渲染：自写 lexer/rules + `snabbdom` 虚拟 DOM，集成 KaTeX、Prism、Mermaid、Vega/Vega-Lite、PlantUML。
- 排版契约：`IMuyaOptions` 的 6 个选项与 `--mu-*` CSS 变量一一对应（`packages/muya/CLAUDE.md` 有完整表），运行时改动一律走 `muya.setOptions({...})`。
- 子目录规模（ts 文件）：`block` 117、`ui` 49、`inlineRenderer` 46、`state` 38、`clipboard` 35、`selection` 20、`editor` 8、`history` 6、`utils` 65。

## 9. 功能 → 代码定位表

| 功能                     | 落点                                                                                                                                                                                                                                                                                                                                                                                                            | 状态                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 命令面板 `Ctrl+Shift+P`  | `components/commandPalette/index.vue`(502)；派发链 `main/menu/actions/view.ts:42` → bus `show-command-palette`                                                                                                                                                                                                                                                                                                  | ✅                                                    |
| 快速打开 `Ctrl+P`        | `commands/quickOpen.ts` → `node/ripgrepSearcher.ts`                                                                                                                                                                                                                                                                                                                                                             | ⚠️ 见 §11.1，当前走全文模式                           |
| 文档内查找/替换          | `components/search/index.vue`(506)，`editorWithTabs/index.vue:23` 挂载                                                                                                                                                                                                                                                                                                                                          | ✅                                                    |
| 文件夹全文搜索           | 主进程管道齐备（`main/ipc/ripgrep.ts` 流式 `mt::rg::*`），`RipgrepDirectorySearcher` 可复用                                                                                                                                                                                                                                                                                                                     | ❌ 无 UI（`c6aab80` 随侧栏搜索面板下线）              |
| 目录 / TOC               | `components/sideBar/toc.vue` + `util/{tocKeys,tocNavigation,sourceModeToc}.ts`；数据来自 `muya.getTOC()`                                                                                                                                                                                                                                                                                                        | ✅                                                    |
| 版本历史                 | 主进程 `main/versionHistory/` + `store/editor.ts:1982,2007`（`SAVE_VERSION_SNAPSHOT` / `LISTEN_FOR_VERSION_RESTORE`）                                                                                                                                                                                                                                                                                           | ⚠️ 无面板，侧栏 tab 已在 `f4f4a13` 下线，监听器不可达 |
| 主题                     | CSS 在 `renderer/src/assets/themes/*.theme.css`（实测 32 个），登记于 `prefComponents/theme/config.ts`，注入 `util/theme.ts:61`，CSS 变量生成 `util/themeColor.ts`，菜单 `menu/menus.ts:203-242`                                                                                                                                                                                                                | ✅                                                    |
| 主题"市场"               | `util/themeMarket.ts`（本地 `.colamd-theme` JSON 清单校验/序列化）+ `util/themeRegistry.ts`；导入导出在 `prefComponents/theme/index.vue:67-125`                                                                                                                                                                                                                                                                 | ⚠️ 纯本地，**没有** 在线市场                          |
| 快捷键                   | 加速器在主进程 `main/keyboard/keybindings*.ts`；编辑 UI `prefComponents/keybindings/*`；渲染端镜像 `store/commandCenter.ts:53`                                                                                                                                                                                                                                                                                  | ✅                                                    |
| 专注 / 打字机 / 源码模式 | `store/preferences.ts:119-120`、类名 `editor.vue:4`、开关 `commands/index.ts:599-615`                                                                                                                                                                                                                                                                                                                           | ✅                                                    |
| 图片粘贴与清理           | `editor.vue:1045 muyaImageAction`（选项 `:1936-1943`）、`util/imageCleanup.ts` + `store/editor.ts:543-596`（延迟 5s unlink）                                                                                                                                                                                                                                                                                    | ✅                                                    |
| 导出                     | 渲染端入口 `editor.vue:1358 handleExport`；落盘分支在主进程 `main/menu/actions/file.ts`：`styledHtml`/`pdf` 走 `util/{exportHtml,pdf}.ts` + `services/printService.ts`，`docx` 走 `util/exportDocx.ts` + `util/docx/`，`epub`/`latex`/`rtf`/`opml` 走 `main/utils/pandoc.ts::exportViaPandoc`（`:206`，缺 pandoc CLI 时预检并提示），`png`/`jpeg` 走 `main/utils/imageExport.ts::exportDocumentImage`（`:213`） | ✅ 8 种，其中 4 种依赖外部 pandoc                     |
| Front matter             | `preferences.frontmatterType`、`editor.vue:665,1919`、`menu/menus.ts:480`、`commands/index.ts:377`                                                                                                                                                                                                                                                                                                              | ✅                                                    |
| 数学 / 图表              | 引擎内渲染（KaTeX/Mermaid/Vega/PlantUML）；渲染端只配主题与 `plantumlServer`（`editor.vue:621-641`、`preferences.ts:211`）                                                                                                                                                                                                                                                                                      | ✅（未见 flowchart 相关偏好）                         |
| 字数统计                 | `wordCount` 来自 `@muyajs/core`，`statusBar/index.vue` 展示词/段/字符/阅读时长                                                                                                                                                                                                                                                                                                                                  | ✅                                                    |
| 自动保存 / 会话恢复      | `store/editor.ts:1657 HANDLE_AUTO_SAVE`；`store/bufferedState.ts` + 主进程 `main/app/index.ts:290` 的 `startUpAction`                                                                                                                                                                                                                                                                                           | ⚠️ 枚举值跨进程不一致，见 §11.1-3                     |
| 拼写检查                 | `main/spellchecker/` + 5 个 `mt::spellchecker-*`                                                                                                                                                                                                                                                                                                                                                                | ✅                                                    |
| 自动更新                 | `electron-updater`，动作在 `main/menu/actions/colamd.ts`                                                                                                                                                                                                                                                                                                                                                        | ⚠️ `dev-app-update.yml` 缺失，本地无法验证更新流      |
| 国际化                   | 11 语种（`static/locales/`，各含 `.json` 与 `.min.json` 共 22 文件）。只打包 `en`，其余经 `mt::i18n::load` 惰性加载（`src/i18n/index.ts`，含在途去重与 `safeMessageCompiler`）                                                                                                                                                                                                                                  | ✅                                                    |
| 主题编辑器 UI 规范       | `docs/UI_REDESIGN_GUIDE.md`（V1，已落地于 `1f7f727`/`2987c99`/`7d3b8a5`）                                                                                                                                                                                                                                                                                                                                       | ✅                                                    |

## 10. 构建、测试与 CI

### 10.1 构建管线

`packages/desktop/electron.vite.config.ts` 产三个目标到 `out/{main,preload,renderer}`：

- main：CJS，`externalizeDeps.exclude: ['electron-store','plist']`（plist 5 是纯 ESM，不排掉会 `ERR_PACKAGE_PATH_NOT_EXPORTED`），`include: ['native-keymap']`，注入 `COLAMD_VERSION(_STRING)`
- preload：CJS，把 `pathe` 排除外链，使沙箱 preload 只需 `require('electron')`
- renderer：ESM，`define: { global: 'globalThis' }`（dragula→custom-event 读 Node `global`），`assetsInclude: ['**/*.md']`，postcss-preset-env `stage: 0` 且关掉 `logical-properties-and-values`（#4673 RTL）

别名三处一致（vite / vitest / tsconfig）：`@`→`src/renderer/src`、`common`→`src/common`、`@shared`→`src/shared`，渲染端额外把 `path` 映射到 `pathe`；只有 `tsconfig.base.json:26-31` 还声明了 `main_renderer/*`。

electron-builder（`packages/desktop/electron-builder.yml`）：`appId com.colamd.app`，`directories.output: ../../dist` 让安装器落在仓库根 `dist/`（CI 通配 `dist/*` 因此仍然有效）。产物命名 `colamd-win-${arch}-${version}-setup.${ext}`；`npmRebuild: false`（rebuild 交给 postinstall）、`electronLanguages: [en-US]`、NSIS 走 `build/windows/installer.nsh`、mac `notarize: false`、extraResources 排除非 min locale、并用 `!*.log` 防 asar 偏移损坏。**没有 `publish:` 块**，所有 build 脚本都 `--publish never`，发布只在 `release.yml` 里做。

原生模块 `ced` 与 `native-keymap` 需要 C++20 工具链（VS Build Tools），因此列为 `optionalDependencies` + 由 `scripts/postinstall.ts` 驱动 rebuild；`packages/desktop/patches/` 里两个补丁分别给 `native-keymap` 打开 stdcpp20、给 `ced` 加预编译 `.node` 兜底。

### 10.2 根脚本

| 脚本                                                   | 作用                                                                                                                                                                                    | 何时跑                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `scripts/postinstall.ts`                               | 5 步：还原 `native-keymap` 源 → 下载 Electron（npmmirror 兜底 + macOS 重解压绕过 yauzl 问题）→ `patch-package` → `electron-rebuild -f`（两者 cwd 都是 `packages/desktop`）→ 压缩 locale | `pnpm install`                  |
| `scripts/minify-locales.ts`                            | 为每个 locale 生成 `.min.json`                                                                                                                                                          | postinstall 与每个 `build:*` 前 |
| `scripts/generateThirdPartyLicense.ts`                 | 生成 `build/THIRD-PARTY-LICENSES.txt`                                                                                                                                                   | 手工                            |
| `scripts/validateLicenses.ts` + `thirdPartyChecker.ts` | 同一份数据的 CI 校验，白名单在 `thirdPartyChecker.ts:32-33`                                                                                                                             | `validate-licenses.yml`         |
| `scripts/check-md-links.py`、`colamd-logo.py`          | 未被任何脚本或工作流引用（`colamd-logo.py` 生成 `build/icons`）                                                                                                                         | 手工                            |

### 10.3 测试规模

| 套件                           | spec 文件                | 用例量级                            | 配置                                                                      |
| ------------------------------ | ------------------------ | ----------------------------------- | ------------------------------------------------------------------------- |
| desktop 单测 `test/unit/specs` | 61                       | ~383                                | `vitest.config.ts`，jsdom                                                 |
| desktop E2E `test/e2e`         | 63（+12 个 `data/*.md`） | ~444                                | `test/e2e/playwright.config.ts`，`workers: 1`，30s 超时                   |
| muya 单测 `src/**/__tests__`   | 223                      | ~1398                               | 默认配置在 `vite.config.ts`（引擎无独立 `vitest.config.ts`），`css: true` |
| muya 一致性 `test/spec`        | 4                        | ~670 CommonMark + 672 GFM + 11 往返 | `vitest.spec.config.ts`，happy-dom                                        |
| muya E2E `e2e/tests`           | 71                       | ~323                                | 独立工作区，`webServer` Vite :5174 载 `e2e/host/`                         |

一致性套件采用"只能变好"的钉死语义：`test/spec/expected-failures.json` 列了 78 个 CommonMark + 90 个 GFM 已知失败，**预期失败变成通过也会让套件失败**（`test/spec/runner.ts`），基线记录在 `test/spec/conformance.md`（CommonMark 87.7% / GFM 86.3%）。

E2E 通过 `_electron.launch` 起真应用（`test/e2e/helpers.ts:74`），会代点未保存对话框、经 `mt::handle-renderer-error` 统计渲染端错误、并用 `Menu.getApplicationMenu().getMenuItemById(id).click()` 驱动原生菜单。已知 `test.fixme`：`loose-list-toggle.spec.ts:54`、`view-modes.spec.ts:314`；`test.skip`：`paragraph-blocks.spec.ts:92,126`。

跑单条：

```bash
pnpm -C packages/desktop exec vitest run test/unit/specs/<name>.spec.ts
pnpm -C packages/desktop exec playwright test test/e2e/<name>.spec.ts
pnpm -C packages/muya exec vitest run src/<path>/<name>.spec.ts
```

### 10.4 CI 与质量门

13 个工作流（`.github/workflows/`）：

| 工作流                                         | 内容                                                                        | 触发                                          | OS                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `build.yml`                                    | postinstall + 全平台 `build:*`，上传 `dist/*`，PR 产物评论                  | PR（paths-ignore muya）/dispatch              | 5 腿矩阵：ubuntu、windows、windows-11-arm、macos-15-intel、macos-15 |
| `release.yml`                                  | 校验 `v*` 语义化标签 → 构建 → SHA256SUMS → 草稿 Release → 提升              | tag push                                      | 同上 5 腿（Linux 用 ubuntu-22.04）                                  |
| `lint.yml`                                     | `pnpm lint` + `pnpm knip` + 引擎类型构建 + `typecheck`                      | PR                                            | ubuntu                                                              |
| `test.yml`                                     | desktop 单测                                                                | PR                                            | **ubuntu + windows**                                                |
| `e2e.yml`                                      | apt 依赖 → postinstall → build → `xvfb-run test:e2e`                        | PR/dispatch                                   | ubuntu-24.04                                                        |
| `muya-{build,circular,lint,test,spec,e2e}.yml` | 引擎构建、`madge --circular`、lint+类型、单测、一致性、Playwright(chromium) | PR                                            | ubuntu                                                              |
| `validate-licenses.yml`                        | `pnpm run validate-licenses`                                                | PR + push `develop`（package.json/lock 变更） | ubuntu                                                              |
| `claude.yml`                                   | claude-code-action，仅 `github.actor == 'TheQYQ'`                           | issue/PR 评论                                 | ubuntu                                                              |

`.github/actions/setup/action.yml`：pnpm/action-setup@v4.4.0 → setup-node@v4.4.0（node 22.21.1 + 缓存）→ `pnpm install --frozen-lockfile --ignore-scripts`。**`--ignore-scripts` 意味着补丁与 rebuild 只在显式重跑 postinstall 的 `build/e2e/release` 里发生。**

代码风格：根 ESLint 9 flat（`@eslint/js` + neostandard + typescript-eslint + vue + jsonc），2 空格、无分号、单引号、`no-explicit-any: error`、`consistent-type-imports`；两处自定义规则值得记住——第 10 节（`eslint.config.js:206-239`）在 `src/renderer/**` 禁用 `Buffer`/`process`/`__dirname`/`__filename`/`require`（起因是一次静默的 SAVE*VERSION_SNAPSHOT 故障），第 7 节给测试注入 Vitest 全局。引擎侧是 antfu 配置：4 空格 + 分号、接口必须 `I` 前缀、私有成员必须 `*` 前缀、`complexity ≤ 20`、`max-lines-per-function ≤ 200`、禁 `as unknown as`。注释规范见 `.github/COMMENTING-GUIDELINES.md`。提交前 `pnpm lint && pnpm typecheck`（`.husky/pre-commit` 已跑 lint-staged）。

## 11. 已核实的问题与文档偏差

### 11.1 代码缺陷（本文写作时实测，均仍在当前 HEAD）

1. **快速打开 `Ctrl+P` 退化为全文搜索。** `commands/quickOpen.ts:3` 写的是默认导入 `import FileSearcher from '@/node/ripgrepSearcher'`，而该文件的默认导出是 `RipgrepDirectorySearcher`（`node/ripgrepSearcher.ts:129-142`，`mode: 'text'`）；真正做文件名检索的具名 `export class FileSearcher`（`:144`，`mode: 'files'`）反而无人引用。根因是清理提交 `409188a` 删掉了 `node/fileSearcher.ts` —— 那 4 行只是 `export { FileSearcher as default } from './ripgrepSearcher'` 的转发垫片，被误判为死代码。**修法：改成具名导入。**
2. **拼写检查可用性判断恒真**：`main/spellchecker/index.ts:46` 写成 `if (!win.webContents.session.isSpellCheckerEnabled)`，缺 `()`，"不可用"告警永不触发。
3. **`startUpAction` 枚举跨进程不一致**：渲染端类型是 `'restoreAll' | 'lastSession' | 'blank'`（`store/preferences.ts:10`），主进程实际比较 `'restoreAll' | 'folder' | 'openLastFolder'`（`main/app/index.ts:288-299`），`'lastState'` 靠迁移改写（`main/preferences/index.ts:49-50`）。因为字段声明为 `StartUpAction | string`，编译不报错，但 `'lastSession'` 是死值、`'folder'`/`'openLastFolder'` 未被类型覆盖。
4. **`Preference.setItem` 的同步广播放大**：`main/preferences/index.ts:135` 每次写键都同步 `ipcMain.emit('broadcast-preferences-changed')`，三个监听方（App、AppMenu、WindowManager/DataCenter）各自可能重建全部原生菜单；`setItems` 逐键循环 → N×M 次重建。
5. **无监听者的 IPC**：`main/dataCenter/index.ts:83,93` 广播 `broadcast-web-image-added/-removed`，全仓零监听且不在契约里。
6. **空实现与未兑现开关**：`main/preferences/index.ts:166-172` 的 `exportJSON`/`importJSON` 是空 `// todo`；`--safe` / `global.COLAMD_SAFE_MODE` 在 `main/app/env.ts:101` 设了但无人消费。
7. **重复实现**：最近文档读取逻辑在 `main/menu/index.ts:18-19` 与 `main/ipc/menu.ts:14-15` 各一份，含两份 `MAX_RECENTLY_USED_DOCUMENTS`。
8. **热路径同步 IPC**：`preload/index.ts:141-157` 的 `isSamePathSync` 会在 `tabs.find(...)` 内回落 `sendSync`。
9. **遗留但无害**：`main/app/index.ts:465-485` 整段注释掉的截图/快捷键捕获；`renderer/src/assets/symbolIcon/index.js`（MarkText 图标雪碧图，被 `main.ts:5` 引入却无模板引用）；`commands/descriptions.ts:169-175` 列了 3 个没有对应命令的 id；`components/titleBar/index.vue:99` 按 `.js` 引入实为 `.ts` 的文件。
10. **安全面残余**：`main/security/pathScope.ts:36-42` 记录在案——`imageFolderPath` 可由渲染端经 `mt::set-user-preference` 设置，等于被攻破的渲染进程能自行扩写可写范围。

### 11.2 README / CLAUDE.md 与代码不符

| 位置                | 说法                                                                                    | 实际                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md:215-216` | 编辑器窗口 `contextIsolation: false + nodeIntegration: true`，文件 `src/main/config.js` | **错**。`main/config.ts:12,13,18`（编辑器）与 `:40,41,44`（偏好窗）均为 isolation+sandbox+无 nodeIntegration；文件是 `.ts` 不是 `.js`。`CLAUDE.md:82-86` 的表述才是对的 |
| `CLAUDE.md:176`     | 示例单测 `test/unit/specs/markdown-basic.spec.ts`                                       | 文件已不存在，用例回移到 `packages/muya/test/spec/roundTrip.spec.ts`                                                                                                    |
| `CLAUDE.md:233`     | 举例通道 `mt::open-new-tab`、`mt::file-saved`                                           | 契约中不存在这两个通道                                                                                                                                                  |
| `CLAUDE.md:43`      | `packages: ['packages/*']`                                                              | 另有 `packages/muya/examples` 与 `packages/muya/e2e` 两个显式工作区                                                                                                     |
| `README.md:97`      | 侧栏含"文件树、全文件夹搜索、目录、版本历史"                                            | 只剩 `files` + `toc` 两个 tab；全文搜索无 UI，版本历史无面板                                                                                                            |
| `README.md:98`      | "命令面板与快速打开"                                                                    | 快速打开行为已退化（§11.1-1）                                                                                                                                           |
| `README.md:100`     | 输出 HTML / PDF / Word                                                                  | 低估了：实际支持 8 种（另含 png/jpeg 长图与 pandoc 的 epub/latex/rtf/opml），见 §9                                                                                      |

### 11.3 工具链偏差

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

1. 读本文件 §3–§6（结构与跨进程边界），再读 `CLAUDE.md` 的 Build Notes 与 Code Style。
2. `pnpm install`（会下载 Electron、打补丁、rebuild 原生模块；Windows 需 VS Build Tools 或手工放预编译 `.node`），`pnpm run dev`。
3. 跑一遍 `pnpm test` 与 `pnpm -C packages/muya test`，把 §10.3 的表格和实际输出对上。
4. 沿一条真实链路读码，看清"菜单在 main、状态在 renderer"是怎么咬合的：
   `Ctrl+S` → `main/menu/actions/file.ts` 发 `mt::editor-ask-file-save` → 渲染端 `store/editor.ts:642 LISTEN_FOR_SAVE` → `FILE_SAVE()` → 回主进程 `mt::save-tabs`（`actions/file.ts:378`）→ 原子写盘（`main/filesystem/index.ts:47-56`，write-file-atomic）→ `mt::tab-saved` 回执（`actions/file.ts:309`）。看懂一条比看十个模块有用。
5. 想动编辑区，先读 `packages/muya/CLAUDE.md` 的 Architecture 与 Appearance contract，再进 `editor.vue`。

**仓库内文档**

| 文档                                                          | 内容                                                                                                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` / `docs/i18n/README-zh_cn.md`                     | 面向用户的功能与下载说明（注意 §11.2 的偏差）                                                                                                                                                   |
| `CLAUDE.md`                                                   | 开发指南：命令、目录、构建注意（注意 §11.2 的偏差）                                                                                                                                             |
| `packages/muya/CLAUDE.md`                                     | 引擎架构、约定、构建细节                                                                                                                                                                        |
| `docs/UI_REDESIGN_GUIDE.md`                                   | V1 设计系统、布局与微交互规范（已落地）                                                                                                                                                         |
| `ColaMD_WORKPLAN.md`                                          | 工作计划与 Typora 对标进度（含 Windows 环境注意、验证命令速查）。**七个梯队的"已完成"自述须按 `OPTIMIZATION_ROADMAP.md` §7 复核结果读**：用例数是过期快照、"未提交"标注已失效、第四梯队三处失真 |
| `CODE_REVIEW_AND_ROADMAP.md`                                  | 全仓代码审查（2026-09）：量化面板、Top10 修复清单、值得肯定的设计、路线图（**基线已过时**，判定见下一行）                                                                                       |
| `docs/OPTIMIZATION_ROADMAP.md`                                | 当前基线的优化路线：实测面板、旧 Top-10 逐条复核、26 项优化清单、七梯队自述复核、分期 PR 路线                                                                                                   |
| `BUGLIST.md`                                                  | 2026-09-15 审计的实锤 bug 清单，已全部修复                                                                                                                                                      |
| `.github/CONTRIBUTING.md`、`.github/COMMENTING-GUIDELINES.md` | 贡献流程与注释规范                                                                                                                                                                              |

> `CODE_REVIEW_AND_ROADMAP.md` 生成于 2026-09-07、审查基线 `cd9ab53`，其量化面板与 Top-10 已大幅过时（此后 M1 性能专项、两轮死代码清理与侧栏重构都已合入）。逐条复核见 [`docs/OPTIMIZATION_ROADMAP.md`](OPTIMIZATION_ROADMAP.md) §2。

## 13. 代码质量体检（2026-09-19 实测）

**方法**：`node` 脚本静态扫描两包 `src`（459 个 ts/vue/js 文件、91,212 行）＋ `eslint`/`knip` 权威输出 ＋ 对每条可疑命中逐个回读代码定性。下表"结论"列区分**实锤**与**启发式误报**——本轮共有三类启发式命中经复核后不成立，一并记录以免被重复劳动。

| 维度           | 实测                                                                                                                                                                                                                                                                            | 结论                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 类型逃逸       | `as unknown as` 生产代码 64 处（main 17 / renderer 33 / muya 14）；测试里另有约 300 处                                                                                                                                                                                          | 可控。muya 的 `no-restricted-syntax` 禁令**确实被遵守**：生产仅 14 处，集中在 `block/base/treeNode.ts`(4)、`state/index.ts`(2) 等 ot-json1 ↔ TState 边界                                                                                                                       |
| 显式 any       | `: any` 29 处（muya 23、desktop 6）                                                                                                                                                                                                                                             | muya 侧 `ts/no-explicit-any: error` 生效，残留者均带 `eslint-disable-next-line` 与理由注释                                                                                                                                                                                     |
| 非空断言       | `pnpm lint` = 0 errors / **149 warnings**（144 `no-non-null-assertion` + 5 `no-unused-vars`），分布 30 个文件                                                                                                                                                                   | `main/windows/editor.ts` 独占 44 处（31%），且模式高度重复（`win!` / `this.id!` / `this.bufferStoreInfo!`）——一个机制即可收敛，见路线图 O25                                                                                                                                    |
| 多余导出       | `knip --workspace packages/desktop`：全量跑为 **48 未使用导出 + 46 未引用类型**（`develop` 重跑）                                                                                                                                                                               | 实测三分（见 O20）：**49 处仅 export 多余**（已清 `1a6098f`）、**29 处去 export 后连本文件都不引用＝真死代码**（移交 O13）、**1 处 `FileSearcher` 与 quick-open 分支冲突需排除**。首轮曾把死代码误判为"只是关键字多余"，判据已改为"去 export 后 eslint 是否立刻报 unused-vars" |
| 上帝文件       | `store/editor.ts` 2,348、`editor.vue` 2,322、`prefComponents/image/…/uploader/index.vue` 1,194；引擎 `block/base/format.ts` 1,851、`muya.ts` 1,733                                                                                                                              | 已有 O12 覆盖（桌面包）。`muya/src/config/emojis.ts` 12,983 行是数据文件，不计入                                                                                                                                                                                               |
| 超长函数       | >100 行的函数：`store/project.ts:82`(setup，313)、`editor.vue:1864`(onMounted，279)、`main/app/index.ts:247`(ready，240)、`main/ipc/ripgrep.ts:181`(158)、`util/theme.ts:61`(153)、`editor.vue:1358`(158)、`lazyMarkdownPipeline.ts:66`(144)、引擎 `blockTransforms.ts:20`(297) | 桌面包**没有** `max-lines-per-function` 规则（muya 有 ≤200 的警告线），所以这类函数不会报修；见 O21                                                                                                                                                                            |
| 重复实现       | ① Markdown 扩展名清单在 `common/filesystem/paths.ts:7-20` 与 `preload/index.ts:~112-120` 各一份；② 键位表 `keybindings{Darwin,Linux,Windows}.ts` 大段默认项相同；③ 最近文档 reader 双份（本轮 O5 已合并）                                                                       | ①有约束背景：preload 被刻意保持只依赖 `electron`+`pathe`（`electron.vite.config.ts` 把 pathe 排除外链），直接 import `common/` 会破坏该设计——但两份清单会漂移，见 O22；②属平台差异，暂不动                                                                                     |
| 击键热路径     | `editor.vue` 中 `getTOC()` / `getMarkdown()` 仅出现在 **挂载阶段**（`:1969`、`:1977`，用于播种 TOC 与 synthetic 基线）；渲染端 `deep: true` watcher **0 处**；`state/index.ts` 无 `structuredClone`                                                                             | 与 M1.2/M1.2b 的记录一致：每击键已无全文级操作。`deepClone` 仍在 45 处被调用，但克隆对象是 `emptyStates.*` 小模板与单个 `op.operation`，**不是全文档**——后续审计不要据此重开性能项                                                                                             |
| 命名           | `renderer/src/codeMirror/mltiplexMode.ts` 文件名拼错（导入方 `codeMirror/index.ts:11` 写的也是这个错名，符号本身 `multiplexMode` 正确）                                                                                                                                         | 见 O23                                                                                                                                                                                                                                                                         |
| 有意为空的分支 | `pages/app.vue:153-158`（web-link 拖拽故意放行，交给引擎处理）、`util/exportHtml.ts:225-229`                                                                                                                                                                                    | **启发式误报**：我的"空控制流"扫描命中 7 处，回读后全部是注释先行或确有实现的分支。该启发式对本仓库无效，不再使用                                                                                                                                                              |
| TODO 债        | `TODO/FIXME/HACK` 55 处（排除 vendored）；最高 `muya/block/base/format.ts` 7、`main/windows/editor.ts` 5                                                                                                                                                                        | 中等，无专项                                                                                                                                                                                                                                                                   |

**一条反向结论值得记住**：本轮 5 个"未被引用"的符号（`validateTheme`、`DANGEROUS_EXECUTABLE_EXTENSIONS`、`exportPDF`、`getContentHash`、`TOP_LEVEL_HEADINGS_SELECTOR`）经 ripgrep 复核**全部在本文件内被使用**，其中 `DANGEROUS_EXECUTABLE_EXTENSIONS`、`validateTheme` 还都是安全校验路径。任何"零引用即删"的结论必须先做这一步——`409188a` 删掉四行 re-export 垫片弄坏 `Ctrl+P` 是同一个坑（见 §11.1-1）。
