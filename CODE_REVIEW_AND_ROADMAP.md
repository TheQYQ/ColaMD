# ColaMD 代码审查与功能路线图

> **生成日期**：2026-09-07
> **审查基线**：commit `cd9ab53`（main）
> **审查范围**：`packages/desktop`（主进程 / preload / 渲染器）、`packages/muya`（编辑器引擎）、根工具链与 CI
> **审查方法**：三路并行深度探查（主进程 / 渲染器 / 引擎与工具链）+ 定量扫描 + 人工交叉验证关键结论（本文所有 file:line 均经过实际核对，非推断）
> **代码规模**：desktop 主进程约 10.8k LOC（79 文件）；渲染器 editor.vue 单文件 2147 行、editor store 2099 行；muya 引擎 428 个 TS 文件、213 个单元 spec

---

## 目录

1. [总览与量化面板](#1-总览与量化面板)
2. [优先修复清单（Top 10）](#2-优先修复清单top-10)
3. [高危问题](#3-高危问题)
4. [性能瓶颈](#4-性能瓶颈)
5. [代码异味](#5-代码异味)
6. [架构优化建议](#6-架构优化建议)
7. [值得肯定的设计](#7-值得肯定的设计)
8. [新增功能路线图](#8-新增功能路线图)
9. [附录：审查覆盖与限制](#9-附录审查覆盖与限制)

---

## 1. 总览与量化面板

| 维度                     | 数据                                                                   | 评价                           |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------ |
| 单元测试                 | desktop 53 spec（776 用例）+ muya 213 spec + CommonMark/GFM 一致性套件 | 测试文化良好，但**只跑 Linux** |
| E2E                      | desktop 61 个 Playwright spec + muya 106 用例                          | 覆盖面好，仅 Chromium/Linux    |
| CI 平台矩阵              | 测试/lint 仅 ubuntu；build 5 平台但**不跑任何测试**                    | 与三平台交付的产品不匹配       |
| IPC 面                   | 108 个 `ipcMain` 注册点；typed contract 195 通道；44 处 `unknown` 载荷 | 有类型契约（难得），校验不足   |
| 裸 `any`                 | desktop 渲染器仅 4 处；muya 428 文件约 10 处                           | 类型纪律优秀                   |
| `as unknown as` 双重断言 | 渲染器 32 处                                                           | 集中在 IPC/偏好边界，可根治    |
| TODO/FIXME               | 全仓 57 处                                                             | 中等                           |
| 生产依赖                 | desktop 55 个，其中 **约 19 个零引用**                                 | 安装包虚胖，见 F9              |

**总体判断**：这是一个底子相当好的 fork——类型纪律、测试分层、原子写入、监听器清理都明显优于 MarkText 原始基线。当前最薄弱的三条线是：**安全加固（2 个高危）、每击键全文档扫描的性能热点（2 个高危）、CI 平台矩阵与依赖卫生**。

---

## 2. 优先修复清单（Top 10）

| #   | 问题                                                              | 严重度 | 工作量 | 位置                                  |
| --- | ----------------------------------------------------------------- | ------ | ------ | ------------------------------------- |
| 1   | 渲染器 `webSecurity: false` 禁用同源策略，可读任意本地文件        | 高     | M      | `src/main/config.ts:19,40`            |
| 2   | `mt::fs::*` 等 IPC 通道接受任意未校验路径（读/写/删/移动/回收站） | 高     | M      | `src/main/ipc/fs.ts:41-76`            |
| 3   | 每击键全文档扫描管线（序列化+词数+哈希+TOC+AST × 5 遍）           | 高     | M      | `editor.vue:1876-1901`                |
| 4   | muya `getState()` 每击键多次 `structuredClone` 全文档             | 高     | M      | `muya/src/state/index.ts:209,222,281` |
| 5   | ~19 个零引用重型依赖打进安装包                                    | 高     | S      | `packages/desktop/package.json`       |
| 6   | `validate-licenses` CI 必挂（引用已删除的 `packages/muyajs`）     | 高     | S      | `scripts/thirdPartyChecker.ts:15`     |
| 7   | 测试/lint 仅跑 Linux，产品交付三平台                              | 高     | S      | `.github/workflows/*.yml`             |
| 8   | BigInt FNV-1a 全文档哈希每击键执行                                | 高     | S      | `syntheticHistory.ts:53-61`           |
| 9   | 会话持久化：每秒全标签 markdown 快照 + 主线程同步写盘             | 中     | M      | `editorBufferStore/index.ts:184`      |
| 10  | `shell.openExternal` IPC 通道无 URL 协议白名单                    | 中     | S      | `src/main/ipc/shell.ts:6-17`          |

---

## 3. 高危问题

### 3.1 [安全] 渲染器关闭了同源策略

**位置**：`packages/desktop/src/main/config.ts:19`（编辑器窗口）与 `:40`（设置窗口）

```ts
nodeIntegration: false,
webSecurity: false,
```

该窗口渲染的是用户提供的 Markdown（含远程图片、HTML 块、外链）。`webSecurity: false` 使任何一次渲染器被攻破（XSS）都能 `fetch('file:///...')` 跨源读取任意本地文件并外传，同时关闭了 CSP 防线。其余加固全部到位（`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、禁 `will-attach-webview`/`window.open`），这一个开关成了最短板。

**建议**：开启 `webSecurity`，本地资源改走特权自定义协议（`protocol.handle('colamd-asset', ...)`，允许范围限定在已打开目录 + 用户数据目录）；若暂时必须保留，在代码处注释说明依赖它的具体特性并建 issue 跟踪移除。

### 3.2 [安全] 文件系统 IPC 通道无路径域校验

**位置**：`src/main/ipc/fs.ts:41-76`；同类：`app/index.ts:851-853`（trashItem）、`ipc/shell.ts:18-32`（open-path/show-item）、`ipc/uploader.ts:94-96`（路径插值进 shell 字符串）

```ts
ipcMain.handle('mt::fs::empty-dir', (_e, p: string) => fs.emptyDir(p))
ipcMain.handle('mt::fs::copy', (_e, src: string, dest: string) => fs.copy(src, dest))
```

主进程把完整的读/写/删/移动/回收站/exec 能力以渲染器传入的任意字符串为键暴露出去，对已打开项目根目录零约束。渲染器一旦被注入，即可升级为任意文件破坏或数据外泄；与 3.1 组合构成完整攻击链。`uploader` 处把路径拼进 shell 命令字符串（同文件的 `cliScript` 已用 `execFile`，模式现成）。

**建议**：做一个统一入口的路径校验层 `resolveAndScope(p, allowedRoots)`：要求绝对路径、规范化后拒绝 `..` 逃逸，把所有**变更类**通道（write/output/unlink/empty-dir/move/copy/trash）限定到已打开目录集合与配置目录；`uploadByPicgo` 改 `execFile(cmd, ['u', localPath])`。

### 3.3 [安全] `shell.openExternal` 原始通道无协议白名单

**位置**：`src/main/ipc/shell.ts:6-17`。Markdown 链接路径有 `URL_REG` 校验（`menu/actions/file.ts:614-620`），但裸通道接受任意 scheme（`smb://`、`file://`、其他应用注册的自定义协议）。当前调用点都是硬编码 https，属纵深防御缺口，5 行可修。附带：该通道重复注册了两次（`.handle` :6 与 `.on` :15）。

**建议**：handler 内强制 `https?://` 白名单，其余拒绝并记日志。

---

## 4. 性能瓶颈

按对输入延迟的影响排序。前四项彼此叠加：**每一次击键**会触发 5 遍全文档处理 + 3~4 次全文档深拷贝 + 1 次 BigInt 全文哈希 + 1 次深度相等比较。

### 4.1 [高] 渲染器：每击键 5 次全文档扫描

**位置**：`components/editorWithTabs/editor.vue:1876-1901`

`json-change` 回调内一次性执行：`getMarkdown()`（全文序列化）→ `muyaWordCount(markdown)`（第二遍全文正则）→ `makeSyntheticHistory(id, markdown)`（第三遍，见 4.2）→ `getTOC()`（全树遍历）→ `getState()`（全 AST 物化，见 4.4）。

**影响**：输入延迟随文档大小线性劣化，对"以速度为卖点"的编辑器是首要热点。

**建议**：派生载荷（词数/TOC/历史）尾部防抖 100–150ms 或合并到一次 rAF；从引擎的增量 op（`{op, prevDoc, doc}`）派生而非重新序列化；把该管线移出 SFC 成为独立适配模块（顺带可测，见 5.6）。

### 4.2 [高] BigInt FNV-1a 全文哈希

**位置**：`components/editorWithTabs/syntheticHistory.ts:53-61`。每个字符一次 `BigInt` 分配 + 乘模运算，整篇文档每击键跑一遍，约为 Number 数学成本的 10 倍。

**建议**：改双 32 位 Number 车道（hi/lo，`hi * 2**32 + lo` 组合键），保留 64 位碰撞强度的设计意图（注释 42-49 行）；或只哈希变更区域。

### 4.3 [高] muya `getState()` 每击键多次 `structuredClone` 全文档

**位置**：`muya/src/state/index.ts:222`（`return deepClone(this._state)`）；每次 op flush 调用两遍（`:209,212` 与 `:281,284`）；内联重渲染的 `_collectReferenceDefinitions()` 再来一遍。加上自动保存的 `getMarkdown()`，单次击键共 3~4 次全文档 `structuredClone`。

**建议**：按约定不可变返回活数组（边界处冻结）；引用定义改为按段落文本增量缓存，或直接从 block 树收集标签而克隆 state。

### 4.4 [中] 全 AST 写入深度响应式 Pinia 状态且无人读

**位置**：`store/editor.ts:1431`（`tab.blocks = blocks`），数据源 `editor.vue:1899`。渲染器唯一消费者只把它置回 `undefined`（`sourceCode.vue:331`）。纯内存/GC 压力。

**建议**：停止存储 `blocks`；确有消费需求时 `markRaw` 并移出 Pinia。

### 4.5 [中] TOC 深比较 + el-tree 全量重建

**位置**：`store/editor.ts:1434-1436`（每击键对整个标题列表 deep-equal）→ `listToTree` → `deriveKeyedToc` → el-tree 全量重渲染。500 个标题的文档会卡。

**建议**：先比较廉价签名（`lvl:slug` 拼接）再决定深度工作；el-tree 换 `el-tree-v2`（虚拟化）。

### 4.6 [中] 会话持久化：全标签内容快照 + 主线程同步写盘

**位置**：`store/editor.ts:2026`（快照含每个 tab 的全文 `markdown`）；`main/editorBufferStore/index.ts:184`（`writeFileAtomic.sync`）；`windows/editor.ts:575-577`（恢复路径 `readFileSync` 阻塞）。活跃输入时主线程每秒一次大结构化克隆 + JSON.stringify + 同步 fsync 写，卡菜单、卡 watcher、卡全部 IPC。

**建议**：(a) 已保存标签不持久化 markdown（只留未保存内容，通常减 95% 载荷）；(b) 写入改异步 promise 版（fsync 语义保留）；(c) 恢复读取改 `fs/promises`。

### 4.7 [中] 图片路径自动补全的模块级无界缓存与 watcher 泄漏；macOS 全量轮询

**位置**：`main/utils/imagePathAutoComplement.ts:17-18`（`IMAGE_PATH` Map + `watchers` Map 永不释放，仅 window-all-closed 清理）；`filesystem/watcher.ts:207`（`isOsx → 一律 polling`）。

**建议**：补 `unwatch(directory)` 并在 `openFolder` 换根时调用；`IMAGE_PATH` 上 LRU 上限；macOS 回退 chokidar 原生 FSEvents，仅 UNC/网络路径保留轮询。

### 4.8 [低] 其他

- 主进程日志 `transports.file.sync = true`（`main/index.ts:41`）全程阻塞式追加 → 仅崩溃路径需要同步。
- ripgrep 桥每文件 2 条 IPC 消息 + stderr 无上限累积（`ipc/ripgrep.ts:292,417`）→ 批量 flush + 64KB 上限。
- preload 的 `sendSync` 大小写不敏感路径回退在热路径可阻塞渲染器（`preload/index.ts:147-153`）→ 预计算小写键缓存。
- 滚动事件每帧直写 store（`editor.vue:1905`）→ rAF 节流。

---

## 5. 代码异味

### 5.1 上帝组件/上帝仓库

| 文件                        | 行数 | 症状                                                                                                                                                             |
| --------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editorWithTabs/editor.vue` | 2147 | ~12 种职责：引擎生命周期、30 个偏好 watch 直通、图片上传业务、导出/打印管线、滚动/打字机数学、拼写、TOC 导航、合成历史、命令面板注册（含魔数 `setTimeout(100)`） |
| `store/editor.ts`           | 2099 | 71 个 action 混合：状态 + 32 处 IPC 传输注册 + 持久化 + 通知 UI                                                                                                  |
| `muya/src/muya.ts`          | 1712 | ~90 个方法，公共 API 与块变换内务混杂                                                                                                                            |
| `menu/actions/file.ts`      | 853  | save/save-as 两大段重复（见 5.3）                                                                                                                                |

**建议**：editor.vue 的 30 个偏好 watch 折叠为一个 `prefKey → optionKey` 映射的 watch；抽 `useImageInsert()` / `useExport()` / `useEngineScroll()` 模块；editor store 抽出类型化 `ipc` 注册表，store 只留状态与 mutation。

### 5.2 死代码/坏代码

- `main/dataCenter/index.ts:163`：`ipcMain.on('set-image-folder-path', (newPath) => ...)` 回调缺 `_e`，且全仓无发送方——死代码且一旦接线即坏。
- `crashReporter.start` 调用两次（`main/index.ts:54` 与 `exceptionHandler.ts:129`）。
- 注释掉的截图功能（`app/index.ts:434-454,703-709`），`mt::make-screenshot` 在 Windows/Linux 静默 no-op。
- `exportJSON()/importJSON()` 空壳（`preferences/index.ts:168-174`）。
- eslint.config.js 引用已删除的 `packages/website/**`、`packages/muyajs/**`（及为其存在的 `@babel/eslint-parser`、`eslint-plugin-html` 依赖）。

### 5.3 重复逻辑

- save vs save-as 两段 ~70 行的对话框+写入+setPathname+watcher 流程重复（`menu/actions/file.ts:161-229` vs `:343-409`），文件内 TODO 已自知。
- 语言初始化三处实现（`app/index.ts:149-220` 手写 40 项 map、`preferences/index.ts:199-229`、`menu/index.ts:460-470`）。
- ripgrep 两个搜索函数 ~90 行 spawn/cancel 管线重复。

### 5.4 其他异味

- **bus 事件魔法字符串**：~50 个事件名、四种命名风格并存（`'paragraph'` / `'TABS::close-this'` / `'SIDEBAR::new'` / `'cmd::register-command'`），`@shared/types/bus` 的类型化事件表被有意闲置 → 打错名静默失败。建议渐进迁移到已有事件表。
- **i18n 漏网**：14 处硬编码英文通知标题（`store/project.ts` 6 处、`store/autoUpdates.ts` 4 处、`editor.vue:926`、`commands/spellcheckerLanguage.ts:68`）。
- **O(n) 查找与 O(1) 索引并存**：`tabs.vue` 五处 `tabs.find`，store 内 24 处 `find`，而 `tabIdToIndex` 早已存在。建议 store 暴露 `getTabById(id)`。
- **`as unknown as` 32 处**：集中在偏好 schema（`preferences.ts:254-287` 四次 cast this）与 IPC 载荷边界。根因是 schema/载荷无类型，治本是给它们定义类型。

---

## 6. 架构优化建议

### 6.1 [高] 引擎消费走手写 `any` 类型垫片

`tsconfig.base.json` 把 `@muyajs/core` 指到 `src/types/muya-core.d.ts`——一个 `[key: string]: any` 的手写声明。428 个文件、strict 模式的引擎在唯一消费者处完全失去类型保护，API 漂移只能运行时发现。

**建议**：让 `pnpm -C packages/muya build`（CI 已有）产出 `lib/types` 作为解析目标，或 `paths` 直接指向 `packages/muya/src/index.ts` 并引入 muya 的全局类型；随后删除垫片（其头部注释已写明这是既定退出条件）。

### 6.2 [中] "内部"主进程事件骑在公共 IPC 总线上

`utils/internalIpc.ts` 的 `onInternalChannel` 直接 `ipcMain.on`——渲染器可向 `set-user-preference`、`watcher-watch-file` 等"内部"通道发送未校验载荷，且 `shared/types/ipc.ts:190-201` 还把它们声明在 `IpcSendChannels` 里向渲染器做广告。

**建议**：建独立 `mainBus`（EventEmitter 单例）承载 main↔main 事件；过渡期至少校验首参；从 `IpcSendChannels` 移除内部通道。

### 6.3 [中] `App.ready()` 在 macOS activate 时重复注册监听

`app/index.ts:123-129` 触发 `ready()`（225 行大函数），其中 `broadcast-preferences-changed` 监听无防重入（对比 `_themeListenerRegistered` 有 flag）→ 每次激活追加一份，偏好变更处理跑 N 遍。

**建议**：拆出 `_registerPreferenceBroadcast()` 并加 flag；顺手把 `ready()` 拆为 `_applyStartupTheme()` / `_registerAppEvents()` / `_createStartupWindows()`。

### 6.4 [中] 引擎插件系统是 UI 专属、全局静态、无内容级扩展点

`muya.ts:130-137` `static plugins` + `static use()`：两个编辑器实例共享同一插件集；块注册表与内联 lexer 封闭，自定义语法必须 fork `markdownToState.ts`/`lexer.ts`。

**建议**：`plugins` 进 `IMuyaOptions`（按实例注册）；定义一个最小的"自定义块 state + 渲染器 + markdown 往返序列化"扩展缝。

### 6.5 [中] OT 协同底座存在但从未运行

`History` 的 `_transform` 分支（`muya/src/history/index.ts:150`）因 `userOnly` 恒为 false 而是死代码，自带 `// TODO: need test.`。json1 逆变换、可序列化历史等底座质量很高，但协同编辑的前置测试缺失。

**建议**：先给 `userOnly: true` + `_transform` 补单测（在 op 形态漂移之前），这是路线图 C 项（协同编辑）的先决条件。

### 6.6 [低] 杂项

- `main/preferences/schema.json` 驱动设置搜索索引，label 无类型——治本可消掉偏好边界的大部分 `as unknown as`。
- 渲染器 12 个文件直接读 `window.colamd` / 写 `window.DIRNAME`（含 store 内部）→ 建议统一 env provider（Pinia plugin）。
- CSS：22 个全局 vs 29 个 scoped 块；`editor.vue:2049` 有 `/* ... existing style ... */` 占位注释残留。
- `no-non-null-assertion` 134 处 warning：可分批收敛（引入 `noUncheckedIndexedAccess` 时的主要阻力点，值得规划）。

---

## 7. 值得肯定的设计

1. **类型化 IPC 契约 + 沙箱 preload**：`shared/types/ipc.ts` 是真正的单一事实来源，改名即编译错误；preload 白名单暴露（`ENV_ALLOWLIST`），从不泄漏原始 `process.env`。
2. **有据可查的原子写入**：`filesystem/index.ts:47-56` 与 `editorBufferStore/index.ts:178-185` 用 write-file-atomic（temp+fsync+rename）并注释了防掉的断电窗口与 issue 编号。
3. **精致的文件监听工程**：`awaitWriteFinish` 只用于内容重载 watcher、云盘自触发抑制（stat 回退）、ENOSPC 用户通知、按窗口清理。
4. **真正的 OT 撤销栈**：ot-json1 invertWithDoc/compose、时间+词边界合并、可序列化历史、IME 恒等 op 防护——不是快照栈。
5. **引擎类型纪律**：strict、`no-explicit-any: error`、禁双重断言并要求审计注释；428 文件仅 ~10 处 any。
6. **分层测试策略**：213 个引擎 spec + CommonMark/GFM"只能变好"的钉失败语义 + 往返序列化 spec + 106 用例 Playwright。
7. **自愈渲染路径**：增量 walker 失败自动回退全量重建；`setContent` 取消挂起 rAF 批次防串档。
8. **渲染器监听器卫生**：editor.vue 33 对 bus.on/off、tabs/search 对称清理、引擎实例 `markRaw` 并 destroy。

---

## 8. 新增功能路线图

结合现有业务逻辑（Markdown 桌面编辑器）与技术栈substrate（OT 引擎、typed IPC、Pinia、electron-builder 三平台），按短/中/长期排列。每项标注：依赖的现有底座、工作量、价值。

### 短期（1-2 周级，多为修复性红利）

| #   | 功能/改进                         | 依据与说明                                                                                                                        | 工作量 |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| S1  | **依赖瘦身 + 安装包减重**         | 删 19 个零引用依赖（mermaid/vega/katex 等已由 muya 自持），加 knip/depcheck CI 守门                                               | S      |
| S2  | **CI 平台矩阵补全**               | 单测矩阵加 windows-latest（本仓开发机即 Windows，本次已实测 Windows 有 POSIX 假设类测试缺口）；validate-licenses 修复 muyajs 引用 | S      |
| S3  | **`pnpm build` 自带 locale 压缩** | 当前干净 checkout 直接 build 出无 locale 的安装包                                                                                 | XS     |
| S4  | **重命名/移动失败的用户通知**     | 镜像 save 路径的 `mt::tab-save-failure` 模式，消除静默状态分叉                                                                    | XS     |
| S5  | **文档版本快照**                  | buffer store 已有原子持久化 + 可序列化历史底座，扩展为"文件级时间线"面板；与自动保存天然衔接                                      | M      |

### 中期（1-2 月级）

| #   | 功能/改进                                                                   | 依据与说明                                                                                                                                          | 工作量 |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| M1  | **性能专项：千页文档不卡**                                                  | 4.1–4.5 全套（增量派生 + 去 structuredClone + TOC 虚拟化）；验收标准：1MB 文档输入延迟 < 16ms                                                       | L      |
| M2  | **安全强化包**                                                              | webSecurity + 资源协议 + fs 路径域 + openExternal 白名单（3.1–3.3）；对外分发前必做                                                                 | M      |
| M3  | **keytar → Electron safeStorage**                                           | keytar 上游已归档（仅 1 处调用）；safeStorage 是官方继任者，少一个原生编译依赖                                                                      | S      |
| M4  | **导出管线增强**：Word(DOCX)/EPUB                                           | 现有导出走 HTML/PDF 管线（`util/pdf.ts`、`exportHtml.ts`），HTML→DOCX 可复用 turndown 反向思路或 headless 转换；配合 4.x 性能修复后大文档导出才可用 | M      |
| M5  | **大仓库体验**：文件树虚拟化（el-tree-v2）+ ripgrep 结果批量推送（4.7/4.8） | 面向万级文件项目场景                                                                                                                                | M      |
| M6  | **workspace 概念**：多根工作区 + 每根独立 watcher 生命周期                  | 修复 4.7 watcher 泄漏时顺势引入目录级 unwatch，功能与修复同源                                                                                       | M      |

### 长期（季度级）

| #   | 功能/改进                         | 依据与说明                                                                                                                                              | 工作量 |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| L1  | **插件系统 v1**                   | 引擎 per-instance plugins（6.4）+ 渲染器命令面板/侧边栏扩展点；发布 `@muyajs/core` 到 npm 的前置条件                                                    | L      |
| L2  | **协同编辑（实验）**              | OT 底座已在（6.5），路径：`_transform` 测试 → 去掉 `getState()` 克隆（4.3）→ presence/WebSocket 层。评估结论：架构上顺风，工程量实打实                  | XL     |
| L3  | **AI 辅助写作**                   | 流式插入基于 muya 的 insert API 与 `json-change` 管线；-provider 抽象（OpenAI 兼容/Ollama 本地）；隐私上与 3.2 的路径域校验互补（限定可发送上下文范围） | L      |
| L4  | **引擎独立发布**                  | 修复 dev/publish exports 分歧、交付 d.ts 删垫片（6.1）、去 `window.*` 耦合、事件 API 文档化 → `@muyajs/core` 可被第三方消费，反哺社区贡献               | L      |
| L5  | **主题市场 / 自定义主题导入导出** | 现有 theme 体系（`addThemeStyle`/customCss）已支持运行时注入；缺的是打包格式与安全清单校验                                                              | M      |

**推荐节奏**：S1–S4（一周内清完，立即改善包体与 CI 可信度）→ M2 安全包（对外分发前必须）→ M1 性能专项（产品核心卖点）→ L1/L2 按需。

---

## 9. 附录：审查覆盖与限制

**覆盖**：desktop 主进程（79 文件全量走查关键路径）、渲染器（store 全量 + 组件按规模/职责抽样）、muya 引擎（架构与热点路径）、全部 12 个 CI workflow、根配置与脚本。

**限制**：

- 未做运行时 profiling——性能结论来自代码路径分析（复杂度论证）而非火焰图；M1 专项启动时应先建立基准测量。
- `packages/muya` 的 428 个文件未逐行审查，聚焦架构与热点；`examples/`、`e2e/host` 未深查。
- 依赖"零引用"结论基于 `packages/desktop/src` 的 import 扫描；动态拼接引用（极少数）可能漏报，删除前建议用 knip 复核。
- 部分行号会随后续提交漂移，以符号名（函数/常量名）为准。

**维护建议**：本报告作为 v1 基线，建议每季度或在重大重构后增量更新；Top 10 清单可直接作为 issue 池使用。
