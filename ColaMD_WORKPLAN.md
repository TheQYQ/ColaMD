# ColaMD 工作计划与进度

> 整理日期：2026-09-09  
> 仓库：`D:\pythonCCode\VibeCoding_Self\ColaMD`  
> 用途：对齐 Typora 的性能与导出能力，并跟踪本地未提交改动

---

## 0. 一句话目标

先把 **大文件性能（M1）** 和 **Word 导出（M4）** 补齐，再做 **图片引用清理**；同时收尾已改完但未提交的 markdown 乱码修复。

---

## 1. 当前工作区状态（未提交）

| 路径                                                                | 类型     | 说明                                                      | 建议                          |
| ------------------------------------------------------------------- | -------- | --------------------------------------------------------- | ----------------------------- |
| `packages/muya/package.json`                                        | 已修改   | 乱码修复：`exports` 改为条件导出（types→lib，import→src） | **应尽快 commit**（单独一笔） |
| `packages/muya/src/state/__tests__/fixtures/keystrokeDocs.ts`       | 新增草稿 | M1.0 文档 fixture 生成器                                  | PR-1 用；可保留               |
| `packages/muya/src/state/__tests__/keystrokePipeline.bench.spec.ts` | 新增草稿 | M1.0 击键管线微基准                                       | PR-1 用；**尚未跑通**         |
| `packages/desktop/scripts/`                                         | 未跟踪   | 临时验证脚本目录                                          | **可删除**                    |

最近提交：`d1a0894`（依赖修复）。工作区领先 origin/main 1 个 commit（同上）。

### 1.1 乱码修复（已完成，待提交）

**根因**：`173180d` 把 `@muyajs/core` 的 `exports` 指到过期的 `lib/` 构建产物，Vite 加载了旧打包文件，markdown 解析失效。

**修复**（`packages/muya/package.json`）：

```json
"exports": {
  ".": {
    "types": "./lib/types/index.d.ts",
    "import": "./src/index.ts",
    "default": "./src/index.ts"
  },
  "./*": {
    "types": "./lib/types/index.d.ts",
    "import": "./src/*",
    "default": "./src/*"
  }
}
```

- Vite/运行时走源码；`vue-tsc` 走预构建 `.d.ts`
- `publishConfig` 仍指向 `lib/`，发布不受影响
- 已验证：markdown 解析正常、`markdownToState` 32 测通过、desktop 804 单测通过、`vue-tsc` 通过

**建议 commit 信息**：

```
fix(muya): point exports at TS source so Vite loads fresh engine

Stale lib/ bundle broke markdown parsing in dev. Keep lib types for
vue-tsc and publishConfig for npm.
```

### 1.2 原生模块 `ced`（临时修复，未入库）

- 现象：启动报 `Could not locate the bindings file`（`ced.node`）
- 临时处理：把 `bin/win32-x64-146/ced.node` 复制到 `build/Release/`
- **下次 `pnpm install` 会丢**；长期应装 VS C++ 工具链后 `pnpm run rebuild-native`
- 注意：之前 `pnpm install` 的 postinstall 因无 VS 编译器失败过

---

## 2. Typora 对标结论（2026-09-13 复核，基准：Typora 1.14 / 官网 + 1.9→1.14 更新日志）

### 已具备（对齐或领先 Typora）

- WYSIWYG 编辑（Muya）+ 源码模式（CodeMirror）、打字机 / 专注模式
- PDF（含书签目录）/ HTML / DOCX 导出 + 打印；Pandoc 导入 13 格式
- 图片：粘贴 / 拖放 / 复制到 `./assets` / PicGo 上传 / 缩放 / 悬浮预览 / 无引用清理
- 数学（KaTeX + mhchem、GitLab ```math 块）、5 种图表引擎（Mermaid / Vega / PlantUML / Flowchart / Sequence，多于 Typora 的 3 种）
- 表格全套 UI（拖拽移动行列、行列菜单、对齐、棋盘插入）、emoji、上下标、front matter（YAML/TOML/JSON）
- 标签页 + 多窗口 + 会话恢复（Typora 无标签页）、命令面板（Typora 无）、版本历史侧栏
- 33 内置主题 + `.colamd-theme` 自定义主题包 + 跟随系统深浅色 + 自定义 CSS + 导出主题（academic/liber）
- 文件树 / TOC / 全局搜索（ripgrep）/ 历史侧栏，11 语言 i18n，拼写检查，自动更新
- 旧表 P0 性能、P1 DOCX 导出、P2 图片清理、界面 Typora 化（UI.1–UI.5）均已完成

### 主要差距（长期计划，逐项开工后勾选）

**Phase 1 — 语法快赢包**（每项 ≤1 天）

- [x] **P1.1 脚注默认开启 ✅（schema + static 默认值翻转，老用户已存值不受影响）**：Typora 默认开；Muya `config/index.ts` `footnote:false`，翻转桌面 schema 默认值
- [x] **P1.2 LaTeX 数学分隔符可配置 ✅（行内 (..)，Muya 词法/渲染/导出/CM 源码高亮 + 偏好开关；块级 [..] 挪 Phase 2）**：`\(...\)` / `\[...\]`（Typora 1.11）；Muya math 扩展目前只认 `$`/`$$`
- [x] **P1.3 源码模式查找替换 ✅（CM searchcursor 后端，共用搜索条 UI）**：现有搜索 UI 仅 WYSIWYG 可用；同一面板路由到 CodeMirror
- [x] **P1.4 选中文字粘贴 URL 自动变链接 ✅（括号转义/百分号编码，「粘贴为纯文本」不受影响）**：Typora smart paste；Muya `clipboard/paste.ts` 无此分支
- [x] **P1.5 大纲跟随滚动高亮当前标题 ✅（WYSIWYG 滚动定位 + 源码光标定位，TOC 树 is-current 高亮）**：`toc.vue` 目前只支持点击跳转
- [x] **P1.6 状态栏阅读时长 ✅（第 4 种循环模式，words/200）**：Typora 字数含 reading minutes；statusBar 加第 4 种循环模式
- [x] **P1.7 模式切换保留滚动位置 ✅（进源码按光标行定位，回 WYSIWYG 滚动到恢复的光标处）**（Typora 1.13）：切源码模式目前重置 scrollTop

**Phase 2 — 语法扩展包**（涉及 Muya 新块/内联类型，约 4–6 天）

- [x] **P2.1 GitHub Alerts ✅**：`> [!NOTE]`/`[!TIP]`/`[!IMPORTANT]`/`[!WARNING]`/`[!CAUTION]`（Typora 1.10；选中段落 → 段落菜单转 Alert）
- [x] **P2.2 定义列表 ✅** `term` / `: def`
- [x] **P2.3 行内注释 ✅** `%%comment%%`（Typora 有，默认关）
- [x] **P2.4 文档内 `[toc]` 目录块 ✅**
- [x] **P2.5 文内锚点跳转 ✅（核实为已有能力，无需开发）**：`[text](#heading)` 点击跳转（Muya headingCopyLink 仅复制链接）

**Phase 3 — 导出能力补全**（约 3–5 天）

- [x] **P3.1 Pandoc 多格式导出 ✅**：EPUB / LaTeX / RTF / OPML，复用 `main/utils/pandoc.ts` 反向管线；EPUB 带大纲层级选项（Typora 1.9）
- [x] **P3.2 导出为图片 ✅**：整页长图 PNG/JPEG（隐藏窗口全高渲染 + `capturePage`）
- [x] **P3.3 PDF 导出主题/暗色 ✅（核实为已有能力）**：确认导出主题接线覆盖 PDF 路径，支持暗色 + 页面背景（Typora 1.10）

**Phase 4 — 可选打磨（按需启动）**

- [ ] 侧边栏文件显示配置：隐藏文件 / 非 Markdown 文件 / 自定义过滤（Typora 1.14）
- [ ] 文件树键盘导航（Typora 1.14；先核实现状）
- [ ] Markdown 设置改动后生效提示（Typora 1.13 reload prompt 形态）
- [ ] 公式自动编号（KaTeX 渲染层）
- [ ] 首次启动欢迎文档
- [ ] 侧边栏 overlay 浮动模式（Typora 1.4+）
- [ ] 浮动格式工具栏对齐 Typora 1.14 形态（已有选中浮动条，低优先）
- [ ] 大纲拖拽重排（Typora 也没有，超集功能）
- [ ] 远期生态：`colamd://` URL 协议 / VSCode 扩展（对应「Open in Typora」）、PicList 上传器；TextBundle 观察

### 明确不做 / 维持既有决策

- MathJax v4（Typora 1.13 已换）：维持暂缓，KaTeX 已达标，换引擎与性能目标冲突
- 标题折叠、分屏预览：Typora 原生也没有，不做
- macOS 26 Tahoe 适配：随 Electron 升级自然获得
- 插件系统 / 协作 / AI：在 `CODE_REVIEW_AND_ROADMAP.md` L 梯队，不重复立项

---

## 3. 总路线（三梯队）

### 第一梯队：性能专项 M1

| 编号 | 任务                                                 | 状态                                                                                 |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| M1.0 | 击键延迟基线（fixture + microbench + baseline 文档） | ✅ 已合并（PR-1 #1, a79ff86）                                                        |
| M1.1 | 消灭热路径 `getState()` 全文深拷贝                   | ✅ 已合并（审计 PR #2 + PR-3 #3, 90eb73a；每键 4→0 次克隆，edit+flush 1MB p50 −14%） |
| M1.2 | 击键路径去全文序列化（脏标记改 op 级）               | ✅ 已合并（PR-4 #19, 8a471b1；flush prevDoc 克隆清零 + getTOC/wordCount 移入防抖；edit+flush 1MB p50 50.8→2.7ms、p95 56.4→4.7ms；**验收线达成**） |
| M1.3 | 大文档 setContent 超线性修复（剖析证明瓶颈在解析管线而非渲染；渲染分片暂不需要） | ✅ PR #27：1MB 5004→28.2ms，线性化 |
| M1.4 | 会话持久化减负（buffer store）                       | ✅ PR #32：1s 防抖 → 5s+30s maxWait 节流；O(tabs) 签名门控跳过无变化写盘；主进程 fsync 写改异步链式（顺序保证） |

**总验收**：1MB 文档击键派生管线 P95 < 16ms —— ✅ **edit+flush 档已达成**（P95 4.7ms，PR #19，余量 3.4×）；现有单测全绿（muya 1468 + desktop 804）；Phase G / PG15 脏净语义未回归（契约测试 C1–C6 锁定）。剩余差距在 M1.2b（每击键 getMarkdown 序列化 + 全文 hash，见 §6）与 M1.3（setContent 1MB ≈ 8.5s）。

### 第二梯队：DOCX 导出 M4

| 编号 | 任务                           | 状态 |
| ---- | ------------------------------ | ---- |
| M4.1 | 菜单 / IPC / `ExportType` 接线 | ✅ PR #29（菜单 Export > Word、'docx' 进 ExportType、IPC 携带二进制 bytes、主进程保存对话框 + 写盘） |
| M4.2 | HTML → DOCX 转换实现           | ✅ PR #29（零新依赖：渲染进程 DOMParser 遍历 styled HTML → WordprocessingML，自写 STORE-only ZIP 封包；支持标题导航/列表/表格/引用/代码块/超链接/内联样式/data-URI 图片嵌入） |
| M4.3 | 样式、locale、测试             | ✅ PR #29（11 语言菜单项 + Heading1-6 样式与 outlineLvl + 11 个单测：ZIP 结构/OOXML part/映射/媒体嵌入） |

### 第三梯队：图片引用清理

| 编号  | 任务                                  | 状态 |
| ----- | ------------------------------------- | ---- |
| IMG.1 | 引擎 `deleteImage` 发 `image-deleted` | ✅ PR #31（所有删除路径共用单一 emit 点，payload 带 as-written src） |
| IMG.2 | 桌面：无引用才删 + 路径域 + 偏好      | ✅ PR #31（5s 防抖给撤销留窗口；路径域=文档目录或全局图片目录子树；`deleteUnreferencedImages` 默认关；设置页开关） |
| IMG.3 | 单测 / e2e                            | ✅ PR #31（引擎 emit 契约测试 + 桌面纯逻辑测试：路径域/引用判定/undo 语义） |

### 第四梯队：界面 Typora 化（UI）

> 2026-09-12 立项。目标：MarkText 工具型界面 → Typora 式极简界面（顶部标题栏+菜单栏、无多余 chrome、底部状态栏、设置全收进菜单）。macOS 保持原生菜单不变；不删标签页系统（默认隐藏）；侧边栏彻底重构（去 45px 图标条+设置齿轮，改为文字 tab 单面板）。

| 编号  | 任务                                                                 | 状态 |
| ----- | -------------------------------------------------------------------- | ---- |
| UI.1  | 顶部结构重组：标题栏精简（文件名居左）+ 自绘菜单栏行（7 个顶级项）   | ✅ titleBar 重构（去面包屑/字数胶囊/汉堡按钮）；`components/menuBar`；`--menuBarHeight` 变量联动 sourceCode 高度 |
| UI.2  | 自绘下拉菜单：`renderer/src/menu/schema` + MenuList 递归组件          | ✅ 7 菜单全量项；勾选/禁用/子菜单/快捷键右对齐（commandCenter 快捷键 + FALLBACK_HINTS）；动作走命令中心/bus/IPC；新增 `mt::menu::get-recent-documents`/`open-path`/`native-clipboard` 通道；渲染层补 `edit.cut/copy/paste` 命令 |
| UI.3  | 底部状态栏：左（侧栏/源码切换图标）右（「N 词」字数，三模式点击切换） | ✅ 字数自标题栏迁移，e2e `editor-input.spec.ts` 同步状态栏选择器与「N 词」格式；`--statusBarHeight` 联动 |
| UI.3b | 侧边栏彻底重构：去图标条+齿轮，Typora 式 tab 单面板（复用 4 面板）    | ✅ `sideBar/help.ts` 图标条目→tab 条目；点击当前 tab=关闭侧栏；layout store 移除 45px 语义；zh 包补全 `sideBar.history` 段翻译 |
| UI.4  | 视觉走查与主题适配（亮色 + 暗色主题）                                 | ✅ 修复：scoped `title-no-drag` 不生效致菜单项被拖拽区吞点击；checkbox type 硬编码；选区状态 null 回退默认；菜单栏/状态栏暗色主题背景；主题分组文案去装饰破折号。亮色+Dracula 实机走查通过 |
| UI.5  | 收尾：偏好设置入口/快捷键确认、单测+typecheck+e2e、本计划更新         | ✅ typecheck + 853 单测全绿；`文件 > 偏好设置 Ctrl+,` 可用 |

**关键实现注记**（后续维护必读）：
- 菜单状态镜像：`store/editor.ts` 的 `SELECTION_CHANGE`/`SELECTION_FORMATS` 在推送原生菜单状态的同时落本地（`selectionMenuState`/`selectionFormatState`），HTML 菜单按 `main/menu/actions/paragraph.ts` 的 `updateSelectionMenus` 同规则解析勾选/禁用；两套菜单（mac 原生 / Win-Linux 自绘）动作语义保持一致。
- `-webkit-app-region` 陷阱：scoped class（如 titleBar 的 `title-no-drag`）对其他组件无效，跨组件的 no-drag 必须在组件内显式声明，否则元素仍处于 drag 区、点击被系统吞掉。
- 编辑菜单剪贴板项走主进程 `webContents.cut/copy/paste`（与原生菜单一致），不走 `document.execCommand`。

### 第五梯队：Typora 对标 Phase 1 快赢包（2026-09-13 完成，未提交）

> 明细见 §2 Phase 1 checklist。零新依赖。

| 编号 | 内容 | 落点 |
| ---- | ---- | ---- |
| P1.1 | 脚注默认开启 | `preferences/schema.json` + `static/preference.json`（`footnote: true`，老用户已存值不受影响） |
| P1.2 | 行内 LaTeX 数学分隔符 `\(...\)`（偏好开关，默认关） | Muya：`inlineRenderer/rules.ts` 新增 `inline_math_latex`（token 复用 `inline_math`，marker=`\(`）；`lexer.ts` `tryBacklash` 让位 + `tryChunks` 接线；`renderer/inlineMath.ts` marker 长度自适应（顺带修 `$$` 行内 dataset 偏移）；`marked/extensions/math.ts` + `lexBlock`/`getHighlightHtml`/`markdownToHtml` 贯通 `latexDelimiters`；桌面：schema/static/store 类型 + `editor.vue` options+watch + Markdown 设置页 + 11 语言文案；源码高亮：`markdownMathMode.ts` 注册 `markdown-math-latex` 双模式，`sourceCode.vue` 按偏好选模式。块级 `\[...\]` 涉及 math-block 状态/块 UI，挪 Phase 2 |
| P1.3 | 源码模式查找替换 | `codeMirror/index.ts` 引入 searchcursor 插件；`sourceCode.vue` 新增 `searchValue`/`replaceValue`/`find-action` 后端（结果经同一 `editorStore.SEARCH` 通道喂给共用搜索条）；`editor.vue` 三个 WYSIWYG 处理器加 `sourceCode` 守卫；搜索条挂载条件 `!sourceCode` → `currentFile` |
| P1.4 | 选中文字粘贴 URL 自动变链接 | `muya/clipboard/paste.ts`：smart-paste 分支（选择非空 + 单一 URL + 非「粘贴为纯文本」）；目的地括号 %28/%29、链接文本 `[]` 转义 |
| P1.5 | 大纲跟随高亮 | `util/sourceModeToc.ts` 新增 `findActiveHeadingIndex`；`editor.vue` 滚动 → DOM 标题序 → `listToc[i].slug`，rAF 节流，emit `toc-active-changed`；`sourceCode.vue` 光标行同映射；`toc.vue` el-tree `setCurrentKey` + `is-current` 样式 + scrollIntoView |
| P1.6 | 状态栏阅读时长 | `statusBar/index.vue` 第 4 循环模式（`ceil(words/200) min`）；11 语言 `menu.counter.readingTime` |
| P1.7 | 模式切换保留滚动位置 | 进源码：按 `muyaIndexCursor.focus.line` 定位容器 scrollTop（替代回 0）；回 WYSIWYG：`handleFileChange` handoff 分支 `nextTick(scrollToCursor + updateActiveTocEntry)` |

**验证**：muya 1482 单测全绿（新增 `inlineMathLatexDelimiters.spec.ts` 5 例 + `pasteUrlOverSelection.spec.ts` 5 例）；desktop 849 单测全绿；`vue-tsc` 两包通过。遗留：`applyPaste` 复杂度 warning 23→27（原本已超 20 阈值）；e2e（Playwright）未跑。

### 第六梯队：Typora 对标 Phase 2 语法扩展包（2026-09-13 完成，未提交）

> 明细见 §2 Phase 2 checklist。零新依赖；新增 6 个 muya 块/扩展文件 + 3 个测试文件。

| 编号 | 内容 | 落点 |
| ---- | ---- | ---- |
| P2.1 | GitHub Alerts：`> [!NOTE]`/`[!TIP]`/`[!IMPORTANT]`/`[!WARNING]`/`[!CAUTION]` | `blockQuote/alert.ts` 纯函数（marker 识别 + DOM 类同步）；`BlockQuote.create` 播种 + `ParagraphContent.update` 每次渲染同步 `mu-alert mu-alert-{type}`；`blockSyntax.css` GitHub 配色（`color-mix` 背景着色 + ::before 图标）。标记文本保持可见可编辑；段落菜单「转 Alert」入口留待后续 |
| P2.2 | 定义列表 `Term` / `: def`（`definitionList` 偏好，默认关） | 新块家族 `block/extra/defList/{index,defTerm,defDesc}`（dl/dt/dd 三块，平面结构无 item 层）；marked 块级扩展 `extensions/defList.ts`（行扫描词法 + `<dl>` 渲染）；`markdownToState`/`stateToMarkdown` 往返（`: ` 前缀仅在序列化时重写）；`ILexOption`/`MUYA_DEFAULT_OPTIONS`/`IMuyaOptions`/`PARSE_AFFECTING_OPTIONS` + 桌面 schema/static/store/editor.vue/设置页/11 语言 |
| P2.3 | 行内注释 `%%comment%%`（`inlineComment` 偏好，默认关） | `inlineRenderer`：`inline_comment` 规则 + `tryInlineComment` 处理器（与 superSubScript 同模式）+ `renderer/inlineComment.ts`（暗淡斜体 span，标记隐藏可编辑）；marked 扩展（导出/剪贴板 → `<!--…-->` HTML 注释）；选项全链路贯通 |
| P2.4 | 文档内 `[toc]` 目录块 | 新块家族 `block/extra/toc/{index,tocContainer,tocPreview}`（复用 math 块的 figure/container/preview + `mu-active` 显隐契约）；`markdownToState` paragraph 分支拦截 `^\[toc\]$` → toc-block；`stateToMarkdown` 原样回写；preview 渲染标题列表（json-change rAF 节流 + 签名门控），点击条目跳转 + 光标落位；`LANG_HASH` 补 `toc-block: ''`；muya 12 语言补「空目录」文案 |
| P2.5 | 文内锚点跳转 | **核实为已有能力**：`format-click`（Ctrl+点击）/ LinkTools 跳转图标 → `FORMAT_LINK_CLICK` → `listToc` githubSlug 匹配 → `scroll-to-header`。无需开发 |

**验证**：muya 1501 单测全绿（新增 `alert.spec.ts` 6 例 + `defList.spec.ts` 5 例 + `tocBlock.spec.ts` 3 例 + `inlineComment.spec.ts` 5 例）；desktop 849 单测全绿；`vue-tsc` 两包 0 错误。遗留：alert 的段落菜单转换入口、def-list 的 Enter 续行行为按默认块逻辑（可后续打磨）；e2e 未跑。

### 第七梯队：Typora 对标 Phase 3 导出能力补全（2026-09-13 完成，未提交）

> 明细见 §2 Phase 3 checklist。零新依赖（复用 pandoc CLI 与 Electron 原生能力）。

| 编号 | 内容 | 落点 |
| ---- | ---- | ---- |
| P3.1 | Pandoc 导出 EPUB / LaTeX / RTF / OPML | `main/utils/pandoc.ts` 新增 `exportViaPandoc()`：临时 md → `pandoc -f markdown -t <fmt> -o <out>`（二进制格式走 `-o`，不经 stdout 字符串）；EPUB 带 `--metadata title`；主进程 `handleResponseForExport` 分支 + 对话前 `pandoc.exists()` 预检（缺 pandoc 提示，不弹保存框）；`ExportType`/`EXTENSION_HASN`/过滤器 + 菜单（原生与自绘两套）+ 11 语言；store `EXPORT` payload 增 `markdown` 字段。EPUB 大纲层级（`--epub-chapter-level`）暂走 pandoc 默认值，需要时在导出参数里加 |
| P3.2 | 导出为整页长图 PNG/JPEG | `main/utils/imageExport.ts` `exportDocumentImage()`：offscreen 隐藏窗口加载导出 HTML → `document.fonts.ready` → 量取 scrollWidth/Height（钳制 32767 上限）→ `setContentSize` → `capturePage` → toPNG/toJPEG；`EXTENSION_HASN` 补 png/jpeg（MarkText 遗留类型终于落地）；菜单「图片 (PNG)」；renderer 用 `printOptimization: false` 的 styled HTML 保留主题观感 |
| P3.3 | PDF 导出主题/暗色 | **核实为已有能力**：`getCssForOptions`（academic/liber 内联 + 自定义磁盘主题）→ `exportStyledHTML(extraCss)` → `printer.renderMarkdown` → `printToPDF(printBackground: true)`，主题/页边距/页眉页脚完整进入 PDF 路径；自定义暗色导出主题即可产出暗底 PDF。无需开发 |

**验证**：desktop 855 单测全绿（新增 `pandoc-export.spec.ts` 5 例：参数组装/元数据/失败清理）；`vue-tsc` 0 错误；eslint 无 error。长图与 pandoc 真实转换需实机走查（offscreen 渲染与 pandoc CLI 安装因环境而异）。

---

## 4. 第一批可开工：M1.0 + M1.1

### PR-1：M1.0 性能基线（只测不改）

**标题**：`perf(bench): add keystroke-pipeline microbench for json-change derived work`

**范围**：

- [x] 草稿：`fixtures/keystrokeDocs.ts`（100KB / 500KB / 1MB 混合块 fixture）
- [x] 草稿：`keystrokePipeline.bench.spec.ts`（setContent / getState / getMarkdown / getTOC / edit+flush）
- [ ] 补：`packages/muya/docs/perf-baseline.md`（结果记录模板 + 首次实测）
- [ ] 补：（可选）`editor.vue` DEV 探针（`import.meta.env.DEV && __COLAMD_PERF__`）
- [ ] 跑通并确认预算门禁合理
- [ ] 全量相关测试不回归

**验收**：

- 三档尺寸可一键输出 P50/P95
- `perf-baseline.md` 有可复制格式
- 不改生产行为（或仅 DEV 探针）
- `pnpm -C packages/muya test` 相关文件通过

**建议分支**：`perf/m1-0-keystroke-bench`

---

### PR-2：M1.1.1 getState 调用方审计

**标题**：`refactor(muya): pin getState ownership contract with audit doc + mutation tests`

**交付物**：

1. `packages/muya/docs/getState-callers.md` — 全部 `jsonState.getState()` 调用方表（频率 / 是否变异 / live 是否安全）
2. 契约测试（如 `getStateContract.spec.ts`）：
   - `Muya#getState()` 返回值被外部改不影响引擎
   - `json-change` 的 `prevDoc` 在 listener 内仍是 apply 前内容
   - `ScrollPage.updateState(muya.getState())` 不因共享引用损坏文档

**关键调用方（已核实）**：

| 调用方                                                 | 位置（约）                | 击键频率       | live 安全性               |
| ------------------------------------------------------ | ------------------------- | -------------- | ------------------------- |
| `dispatch` / `_flushOperationCache` 的 `prevDoc`/`doc` | `state/index.ts`          | 每次 flush     | History 需要 apply 前快照 |
| `getMarkdown`                                          | `state/index.ts`          | 高             | 只读可 live               |
| `buildReplaceOp`                                       | `state/index.ts`          | 低             | 只读可 live               |
| `_collectReferenceDefinitions`                         | `inlineRenderer/index.ts` | **每次 patch** | 只读可 live（高 ROI）     |
| `History._change` invert                               | `history/index.ts`        | 中             | **必须快照**              |
| `ScrollPage.updateState` 路径                          | `editor/index.ts` 等      | 低             | **不可共享 live 子树**    |
| `Muya#getState` 公开 API                               | `muya.ts`                 | 中             | **继续 clone**            |

**建议分支**：`refactor/m1-1-getState-audit`

---

### PR-3：M1.1.2+1.1.3 getState 去克隆 + json-change 瘦身

**标题**：`perf(muya): stop cloning full doc on every keystroke; slim json-change payload`

**依赖**：PR-2 审计完成

**实现要点**：

1. `getState()` 返回 live `_state`；新增 `getStateClone()`
2. `json-change` 删除 apply 后的 `doc`（全仓 0 消费者）；History 保留 apply 前一次 `prevDoc` 快照
3. `InlineRenderer` / `getMarkdown` / `buildReplaceOp` 读 live
4. `Editor` → `ScrollPage.updateState` 与 `Muya#getState` 用 `getStateClone()`

**单次 flush 目标**：`deepClone` 次数 **2 → 1**

**风险回滚**：`getStateClone` 名称保留，可快速加回 clone。

**建议分支**：`perf/m1-1-getState-live`

---

### PR 合并顺序

```text
PR-1 (bench)     ──┐
                   ├──► PR-3 (perf) ──► 更新 perf-baseline.md 数字
PR-2 (audit)     ──┘
```

PR-1 与 PR-2 可并行；PR-3 必须基于 PR-2。

---

## 5. M1.1 调用方要点（写代码前必读）

| 发现                                                         | 含义                              |
| ------------------------------------------------------------ | --------------------------------- |
| 桌面 `editor.vue` 的 `json-change` 回调**不读** payload 字段 | 瘦身载荷不伤 desktop              |
| History **只读 `prevDoc`**                                   | 只需 apply 前 clone 一次          |
| **`doc` 字段无消费者**                                       | 可直接删除，立即省一半 clone      |
| `ScrollPage.updateState` 会 `create(muya, block)` 读字段     | 不能把 live 树直接塞给它          |
| `_collectReferenceDefinitions` 每次 `patch` 调 `getState()`  | 去 clone 后收益最大的只读路径之一 |

---

## 6. 建议执行顺序（含杂项）

### 立刻（今天）

1. 删除 `packages/desktop/scripts/` 临时脚本（或确认不要）
2. **单独 commit 乱码修复**（`package.json`）
3. 决定是否在本机装 VS Build Tools 并 `pnpm run rebuild-native`（消除 `ced` 临时拷贝）

### 本周（PR-1）

4. 补 `docs/perf-baseline.md`
5. 跑通 bench，记录本机基线数字
6. （可选）`editor.vue` DEV 探针
7. 开分支 → commit → 自测 → 你本地开 PR

### 下一批（PR-2 → PR-3）

8. 审计文档 + 契约测试
9. live `getState` + 瘦身 `json-change`
10. 重跑 bench，把前后对比写回 baseline

### 再往后

11. M1.2 脏标记去全文 hash / 去每击键 `getMarkdown`
12. M4 DOCX 导出（可与 M1 后半并行）
13. 图片引用清理
14. M1.3 渲染分片

### M1.2b 懒序列化管线（M1.2 遗余，审计先行）

PR #19 后每击键仍同步执行 `getMarkdownLive()` 全文序列化（1MB ≈ 59ms）+ synthetic history FNV 全文 hash。彻底去除需把 `tab.markdown` 改为按需派生（脏标记 + flush-on-read），已核实的读取方（漏挂一个 flush 钩子 = 存盘丢数据，必须逐个覆盖）：

- `editor.ts` L734 关闭未保存提示的非空检查；L1752 外部文件变更比对；L2153 崩溃缓冲持久化
- 保存流（手动保存 / `HANDLE_AUTO_SAVE` 定时器）/ 导出流 / 版本快照
- 约束：仅活动 tab 有活引擎，tab 切换前必须同步 flush
- dirty 语义依赖内容 hash（undo 回到已保存内容判干净，Phase G — G6），不能退化为纯布尔脏标记；可行折中：干净/脏确定态用标志位，仅 undo/redo 后的"不确定态"才惰性算 hash

**状态**：✅ 完成（2026-09-12）。
① 审计：读取方核对表 `packages/muya/docs/tabMarkdown-readers.md`（R1–R14）。
② PR #23 补漏：审计发现的 5 处现状缺失的 flush 守卫（save-all / auto-save 定时器 / 外部变更比对 / FORCE_CLOSE_TAB 快照 / CLOSE_UNSAVED_TAB + 崩溃缓冲 + 导出）先行落地。
③ PR #25 懒序列化：`lazyMarkdownPipeline` 三层管线（击键层 O(1) 脏标记；undo/redo source 'history' 即时序列化判净；120ms 停顿层 + flush-on-read 单次提交）。引擎 History undo/redo 改派 source 'history'（契约测试锁定）；store 新增 keystroke tier。bench：引擎热路径无回归（1MB edit+flush p95 4.0ms，验收线余量 4×），桌面每击键移除 ~59-67ms 全文序列化 + FNV hash。剩余大项：M1.3 setContent 超线性。

---

## 7. 明确不做 / 暂缓

| 项                         | 原因                                             |
| -------------------------- | ------------------------------------------------ |
| 换 MathJax                 | 与性能优先冲突；保留 KaTeX，复杂需求另立可选引擎 |
| 大纲拖拽重排               | 有价值但非本三优先级                             |
| 常驻格式栏                 | 纯 UX                                            |
| 每秒全标签会话快照全面重写 | 先做 M1.4 降频即可，不必一次重架构               |

---

## 8. 验证命令速查

```bash
# 乱码修复相关
pnpm -C packages/muya exec vitest run src/state/__tests__/markdownToState.spec.ts
pnpm -C packages/desktop test:unit
pnpm -C packages/desktop run typecheck

# M1.0 基准（PR-1 完成后）
pnpm -C packages/muya exec vitest run src/state/__tests__/keystrokePipeline.bench.spec.ts

# 原生模块（需 VS C++）
pnpm run rebuild-native

# 开发
pnpm run dev
```

---

## 9. 环境注意（Windows 本机）

- 无 vswhere / cl.exe；`ced` / `native-keymap` 需 VS Build Tools 或手工放预编译 `.node`
- `ced` 预编译路径：`node_modules/.pnpm/ced@2.0.0/node_modules/ced/bin/win32-x64-146/ced.node`
- Electron 42 → ABI `node-v146-win32-x64`

---

## 10. 状态图例

| 图例 | 含义             |
| ---- | ---------------- |
| ✅   | 已完成并验证     |
| 🟡   | 进行中 / 草稿    |
| 📋   | 仅有描述，未开工 |
| ❌   | 阻塞或不推荐     |

---

## 附录 A：PR-3 测试计划（预写）

- [ ] `pnpm -C packages/muya test`
- [ ] `pnpm -C packages/desktop test:unit`
- [ ] 手动：1MB 文档输入、undo/redo、源码模式切换、中文 IME
- [ ] 新增：`jsonChangePayload` / `getStateContract` / `scrollPageRebuild`

## 附录 B：相关既有测试（回归网）

- `packages/muya/src/history/**`（undo + `json-change`）
- `packages/muya/src/state/__tests__/flushPendingOps.spec.ts`
- `packages/muya/src/history/__tests__/identityOpJsonChange.spec.ts`
- `packages/muya/src/state/__tests__/parity*.spec.ts`
- `packages/desktop/test/unit/specs/exportHtml.spec.ts`
- 源码模式 / PG14 / PG15 相关 e2e

---

_本文档是工作计划，不是设计终稿。PR-3 动手前以 PR-2 审计文档为准。_
