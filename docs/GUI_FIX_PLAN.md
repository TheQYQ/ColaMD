# ColaMD GUI 修复计划

> **批次进度**：常规批次 11/11 · 专项 4/4（SC-1…SC-4 代码均已合入 develop：SC-1 #131、SC-2 #134、SC-4 #135、SC-3 #136；**SC-3 的 NVDA 手测仍待维护者**，清单见 `docs/NVDA_MANUAL_CHECKLIST.md`；2026-11-01 建档；进度行随每批合入更新）。
> 本文档是 GUI 修复工作的**唯一进度真值**；性能与门禁的数字基线仍以 `PROJECT_GUIDE.md` §14 为准。

## 0. 文档信息与生命周期

- **审查基线**：commit `1c738b2`（main，2026-11-01）。四维度并行深审（性能 / 用户体验 / 设计一致性 / 可访问性），共识别 **58 项问题**；其中高严重度结论（脏标记不显示、缺失 `--` 前缀的非法 CSS、`tab.blocks` 无人消费、空库快速打开抛错、`viewportMargin: Infinity`）已逐个回读源码抽查验证。
- **行号口径**：本文所有 `文件:行号` 为基线 commit 快照，实施时以符号搜索定位为准，行号漂移不构成偏差。
- **生命周期**：对齐项目先例（`docs/OPTIMIZATION_ROADMAP.md` 于全部闭环后退役删除）。全部批次与专项闭环后，有效结论（根因教训、新门禁、新基线）迁入 `PROJECT_GUIDE.md` §14/§11，然后删除本文档，历史在 git 可考。
- **写作约束**：本文档被 `scripts/check-md-links.py` 扫描（CI lint.yml 内），相对链接必须真实存在；不在任何位置使用图片语法或 `href=`/`src=` 字面量形状。

---

## 1. 问题总表

状态取值：`待修` → `进行中`（分支开出）→ `已修复(PR#)`（合入 develop）→ `已关闭`（评估后不做，须写理由）。

### 1.1 性能（PERF，15 项）

| ID      | 严重性 | 问题                                                                                                    | 关键位置                                                                                                                 | 批次 | 状态             |
| ------- | ------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---- | ---------------- |
| PERF-01 | 高     | 渲染端 6.8MB 单体主包：全量 Element Plus + 全静态路由 + 无 manualChunks；设置窗口也解析执行编辑器全家桶 | `renderer/src/main.ts:8-9`、`router/index.ts:5-13`、`electron.vite.config.ts:62-113`、`src/main/windows/base.ts:121-124` | B5   | 已修复 (PR #114) |
| PERF-02 | 高     | 源码模式每次 cursorActivity 做两次全文 `getValue()` + 一遍全文 wordCount，每键 O(N)                     | `editorWithTabs/sourceCode.vue:312-331, 67-99, 292-317`                                                                  | B3   | 已修复 (PR #112) |
| PERF-03 | 高     | 每次光标移动发 2 条 IPC，主进程全量重写两份原生菜单的全部 item                                          | `store/selectionState.ts:47-81`、`src/main/menu/index.ts:448-477`、`menu/actions/paragraph.ts:220-277`                   | B3   | 已修复 (PR #112) |
| PERF-04 | 高     | 大文档无虚拟化：`updateState` 全量重建 DOM；源码模式 `viewportMargin: Infinity` 关掉 CM5 虚拟化         | `muya/src/block/scrollPage/index.ts:51-105`、`sourceCode.vue:519`                                                        | SB   | 待修             |
| PERF-05 | 中     | 56 个主题/代码高亮 CSS 以 `?inline` 全量打进主包，运行时一次只用一份                                    | `util/themeColor.ts:1-60`、`util/theme.ts:67-104`                                                                        | B6   | 已修复 (PR #115) |
| PERF-06 | 中     | 启动时偏好镜像逐个触发全文档 force 重建（每个含全文档 structuredClone + DOM 重建）                      | `useEngineOptionSync.ts:111-145`、`muya/src/muya.ts:338-384`                                                             | B6   | 已修复 (PR #115) |
| PERF-07 | 中     | 打字暂停档 `blocks: engine.getState()` 全文档深拷贝后无人消费（唯一"消费者"写 undefined）               | `lazyMarkdownPipeline.ts:118`、`store/contentEvents.ts:103,132`、`sourceCode.vue:507`                                    | B3   | 已修复 (PR #112) |
| PERF-08 | 中     | WYSIWYG 每键对所在段落做约 5 次完整 inline tokenize                                                     | `muya/src/block/base/format.ts:610-700, 265-335`                                                                         | B7   | 已修复 (PR #116) |
| PERF-09 | 中     | 每次 `patch()` 对整棵文档树递归重建引用定义 labels                                                      | `muya/src/inlineRenderer/index.ts:70-117`                                                                                | B7   | 已修复 (PR #116) |
| PERF-10 | 中     | 搜索跳转把所有匹配块各重渲染两遍（高亮集合大的常见词一次跳转数百次 innerHTML 替换）                     | `muya/src/search/index.ts:32-64, 126-148`                                                                                | B7   | 已修复 (PR #116) |
| PERF-11 | 低-中  | TOC 跟随滚动每帧对全部标题做 `getBoundingClientRect` + 选择器全扫                                       | `useEditorScroll.ts:40-64`                                                                                               | B6   | 已修复 (PR #115) |
| PERF-12 | 低-中  | muya UI 4 处常驻 document 级 mousemove + `elementsFromPoint` 命中测试                                   | `muya/src/ui/paragraphFrontButton/index.ts:114-153` 等 4 处                                                              | B7   | 已修复 (PR #116) |
| PERF-13 | 低     | `transition: all` 反模式 7 处                                                                           | `titleBar/index.vue:285-287`、`rename/index.vue:123`、`uploader/index.vue:887-991` 等                                    | B6   | 已修复 (PR #115) |
| PERF-14 | 低     | `dispatch` 内无条件 `JSON.stringify(op)`，粘贴大内容时白付 MB 级序列化                                  | `muya/src/state/index.ts:203`                                                                                            | B7   | 已修复 (PR #116) |
| PERF-15 | 低     | inline 渲染输出用 reduce + spread 构造数组，O(n²) 拷贝                                                  | `muya/src/inlineRenderer/renderer/index.ts:174-183`                                                                      | B7   | 已修复 (PR #116) |

### 1.2 用户体验（UX，21 项）

| ID    | 严重性 | 问题                                                                                               | 关键位置                                                                                                      | 批次                 | 状态             |
| ----- | ------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------- |
| UX-01 | 高     | 活动标签页永不显示未保存圆点（active 规则把它设为透明）；`document.title` 也无脏标记               | `tabs.vue:366-374`、`titleBar/index.vue:161-176`                                                              | B1                   | 已修复 (PR #110) |
| UX-02 | 高     | 点击编辑器任意位置即关闭搜索栏并清空查询词（高频流程被打断、丢输入）                               | `search/index.vue:280-295`                                                                                    | B2                   | 已修复 (PR #111) |
| UX-03 | 高     | 未保存对话框不说几个/哪些文件、无 Enter、无初始焦点与焦点陷阱（主进程传的 files.length 被丢弃）    | `unsavedDialog/index.vue:73-95`、`src/main/menu/actions/file.ts:378`                                          | B1                   | 已修复 (PR #110) |
| UX-04 | 高     | 快捷键改完不点保存关窗即静默丢失（isDirty 无消费者）；冲突检测不排除自身、提示不指明占用命令       | `prefComponents/keybindings/KeybindingConfigurator.ts:91-143, 178-185`                                        | B10                  | 已修复 (PR #119) |
| UX-05 | 中     | Ctrl+P 快速打开在空库（无文件夹无标签）时抛错静默失败，面板不出现                                  | `commands/quickOpen.ts:122-127`、`commandPalette/index.vue:151-157`                                           | B1                   | 已修复 (PR #110) |
| UX-06 | 中     | 搜索三开关（大小写/整词/正则）不持久，重启即回默认                                                 | `search/index.vue:156-158`                                                                                    | B2                   | 已修复 (PR #111) |
| UX-07 | 中     | 侧栏删除文件/文件夹零确认、零成功反馈（与关脏标签的三重确认形成反差）                              | `store/sidebarContextMenu.ts:38-43`、`sideBar/tree.vue:258-261`                                               | B10                  | 已修复 (PR #119) |
| UX-08 | 中     | 无标签页空状态只有"新建文件"，无打开文件/文件夹入口、无最近列表（组件名叫 recent 却不显示 recent） | `components/recent/index.vue:2-14`、`pages/app.vue:27`                                                        | B10                  | 已修复 (PR #119) |
| UX-09 | 中     | 自绘菜单栏下拉项键盘不可达（无上下箭头/Enter/hover 同步）                                          | `menuBar/MenuList.vue:11-24`、`menuBar/index.vue:137-149`                                                     | SC                   | 已修复 (PR #131) |
| UX-10 | 中     | 重命名双标准：弹窗版全名可改扩展名、光标在末尾；侧栏版预选词干、锁定扩展名                         | `rename/index.vue:48-56` 与 `sideBar/treeFile.vue:81-99`                                                      | B10                  | 已修复 (PR #119) |
| UX-11 | 中     | 导出无进度反馈、成功零反馈，大文档导出期间用户会重复点击                                           | `editorWithTabs/editor.vue:918-1080`、`exportSettings/index.vue:296-303`                                      | B10                  | 已修复 (PR #119) |
| UX-12 | 中     | 搜索框 Enter 只能向下（无 Shift+Enter 向上）、替换框 Enter 无语义、监听挂在 keyup 手感飘           | `search/index.vue:309-313, 90-95, 29`                                                                         | B2                   | 已修复 (PR #111) |
| UX-13 | 中     | 硬编码英文约 15 处用户可见串（placeholder、toast、通知标题、命令后缀等）                           | `sideBar/tree.vue:45`、`statusBar/index.vue:74`、`store/autoUpdates.ts:10-33`、`commands/index.ts:629-636` 等 | B4                   | 已修复 (PR #113) |
| UX-14 | 中     | 状态栏统计口径点击循环无提示，tooltip 恒为"字数"                                                   | `statusBar/index.vue:30, 60-82`                                                                               | B4                   | 已修复 (PR #113) |
| UX-15 | 低     | 窗口缩放无屏上百分比反馈，何时回到 100% 全靠猜                                                     | `src/main/windows/utils.ts:6-27`                                                                              | B10                  | 已修复 (PR #119) |
| UX-16 | 低     | 缺"全部保存"菜单入口（命令面板已有 ASK_FOR_SAVE_ALL，只差菜单项）                                  | `store/editor.ts:406`、`menu/menus.ts`                                                                        | B10                  | 已修复 (PR #119) |
| UX-17 | 低     | 全部替换后无"N 处"结果反馈                                                                         | `search/index.vue:370-380`                                                                                    | B10                  | 已修复 (PR #119) |
| UX-18 | 低     | TOC 面板无标题时完全空白（同侧栏 history 面板有完整三态空提示，标准不一）                          | `sideBar/toc.vue:6-21`                                                                                        | B4                   | 已修复 (PR #113) |
| UX-19 | 低     | 命令面板无空态、过滤只匹配当前语言、鼠标 hover 不同步高亮                                          | `commandPalette/index.vue:29-58, 296-303, 41-46`                                                              | B4                   | 已修复 (PR #113) |
| UX-20 | 低     | document 级 Esc 监听不判断搜索栏开关状态，任何 Esc 都走一次清空路径                                | `search/index.vue:274-278`                                                                                    | B2                   | 已修复 (PR #111) |
| UX-21 | 低     | 标签溢出无滚动提示；"+"新建按钮默认全透明；死类 .always-visible、死样式 li:focus-visible           | `tabs.vue:276-296, 375-390, 387, 318-321`                                                                     | B4（tabindex 归 B8） | 已修复 (PR #113) |

### 1.3 设计一致性（DS，10 项）

| ID    | 严重性 | 问题                                                                                                                                  | 关键位置                                                                                                                               | 批次                    | 状态             |
| ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------- |
| DS-01 | 高     | 32 份主题文件 97% 结构重复，每份携带 `!important` 组件补丁（已实际覆盖组件层 token 化成果）；4 个主题缺 side-bar 补丁造成跨主题不一致 | `assets/themes/*.theme.css`（如 `dark.theme.css:149-214`）与 `sideBar/index.vue:146`                                                   | SA                      | 待修             |
| DS-02 | 高     | 6 个未定义 CSS 变量被引用：`--editorColor20` 三条边框静默失效（连 fallback 都没有）；`--success/--warning` 四个永远走硬编码 fallback  | `prefComponents/image/components/uploader/index.vue:852-860, 998-1049, 1083, 1137, 1160`                                               | B1                      | 已修复 (PR #110) |
| DS-03 | 高     | 遮罩四种黑无一用 `--maskColor`（0 引用）；亮色边框 6 套灰并存；暗主题边框用黑透明极性写反                                             | `editor.vue:1750`、`key-input-dialog.vue:248`、`unsavedDialog/index.vue:104`、`sideBar/index.vue:131`、`assets/styles/index.css:31-96` | B9                      | 已修复 (PR #118) |
| DS-04 | 中-高  | 新语义 token 层采用率仅约 16%（53 次 vs 旧 camelCase 282 次）；`--font-ui` 定义了却没挂到 body，基础 UI 字体栈缺失                    | `assets/styles/index.css:441-473, 139-155`                                                                                             | B10                     | 已修复 (PR #119) |
| DS-05 | 中     | 真 bug：`color: var(sideBarTitleColor)` 缺 `--` 前缀，声明非法，标题悬停变色从未生效                                                  | `titleBar/index.vue:332`                                                                                                               | B1                      | 已修复 (PR #110) |
| DS-06 | 中     | 圆角 3px/5px 体系外 15 处与 token 混搭；裸 px 字号 89 处（13/14 混用）；等宽字体四套栈；行高 11 种取值                                | `tabs.vue:299`、`unsavedDialog:111`、`rename:76`、`search:498` 等                                                                      | B10                     | 已修复 (PR #119) |
| DS-07 | 中     | z-index 无文档化阶梯（10000 弹层带内靠 DOM 顺序）；image-viewer 存在同类同名死规则；unsavedDialog 独占 12000 无注释                   | `assets/styles/index.css:432-434`、`editor.vue:1743-1753`、`unsavedDialog:103`                                                         | B10                     | 已修复 (PR #119) |
| DS-08 | 中     | 图标四套来源混用：iconfont 填充风（1024 网格）与描边风（24 网格）并排，尺寸六种写法                                                   | `assets/symbolIcon/`、`components/icons/LinkIcon.vue`、模板内联 svg                                                                    | SA 顺带定标准           | 待修             |
| DS-09 | 低     | 主题预览色板与主题文件双份维护（90 处 hex 手工同步，新主题易漏配）                                                                    | `prefComponents/theme/index.vue:325-402`                                                                                               | SA 顺带                 | 待修             |
| DS-10 | 低     | 布局 token（--editorAreaWidth 等）约 35 处重复定义；muya 默认主题色仍是指南点名清除的绿色；实现与设计指南骨架参数漂移未记档           | `assets/styles/index.css:3-7`、各 theme 文件 90 行附近、`muya/src/assets/styles/index.css:3`                                           | SA（变量）/ B10（记档） | 待修             |

### 1.4 可访问性（A11Y，12 项）

统计基线：48 个 SFC 中 `aria-*` 共 7 处、`role=` 1 处、`tabindex` 2 处；`@click` 82 处中约 55 处绑在非 button/a 元素上。

| ID      | 严重性 | 问题                                                                                                                        | 关键位置                                                                                               | 批次                      | 状态                               |
| ------- | ------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------- | ---------------------------------- |
| A11Y-01 | 高     | 约 55 处可点击 div/span/li/el-icon 对键盘用户完全不可达（标题栏窗口控制三键、标签页、状态栏两控件、搜索三开关、通知按钮等） | `titleBar/index.vue:43-88`、`tabs.vue:11-40`、`statusBar/index.vue:4-35`、`notifications.vue:13-31` 等 | B8                        | 已修复 (PR #117)                   |
| A11Y-02 | 高     | 对比度系统性不达标（实测）：34 主题中 31 个主按钮白字 FAIL（最差 1.38:1）；状态栏文字 2.84:1；通知白字 2.39:1               | `assets/styles/index.css:105-109`、`dark.theme.css:45-46`、34 个 theme 文件                            | B9                        | 已修复 (PR #118)                   |
| A11Y-03 | 高     | 未保存对话框无焦点陷阱、无初始焦点、关闭不归还焦点——数据丢失决策对话框 Tab 可游走出遮罩                                     | `unsavedDialog/index.vue:62-95`                                                                        | B1（与 UX-03 同文件同批） | 已修复 (PR #110)                   |
| A11Y-04 | 高     | 自绘菜单栏零 menu 语义：无 menubar/menuitem role、勾选态只是字符加 class、禁用态无 aria-disabled                            | `menuBar/index.vue:6-15`、`MenuList.vue:11-24`                                                         | SC                        | 已修复 (PR #131)                   |
| A11Y-05 | 中     | 全应用零 aria-live/role=status：搜索结果计数、文件级通知条、加载态对屏幕阅读器静默                                          | `search/index.vue:32-34`、`notifications.vue`、`loading/index.vue`                                     | B8                        | 已修复 (PR #117)                   |
| A11Y-06 | 中     | 文件树无 tree/treeitem 语义，展开/选中态只在 data-\* 与 class 里（键盘导航已实现但 AT 感知不到）                            | `tree.vue:27-75`、`treeFolder.vue:11-14`、`treeFile.vue:142-154`                                       | SC                        | 已修复 (PR #134)                   |
| A11Y-07 | 中     | 全局 `:focus { outline: none }` 补偿面太窄；图标按钮只靠 title 命名；LinkIcon 可点击却硬编码 aria-hidden                    | `assets/styles/index.css:135-137, 476-482`、`LinkIcon.vue:12`                                          | B8                        | 已修复 (PR #117)                   |
| A11Y-08 | 中     | 命令面板结果列表无 listbox/option 语义，上下键选择对 SR 不可见                                                              | `commandPalette/index.vue:29-58`                                                                       | B8                        | 已修复 (PR #117)                   |
| A11Y-09 | 中     | muya 图片加载失败/空图用自定义属性承载文案（SR 读不到）；失败分支 img 无 alt；三个 hover 图标无标签                         | `muya/src/inlineRenderer/renderer/image.ts:89-90, 200-229`                                             | B7                        | 已修复 (PR #116)                   |
| A11Y-10 | 低-中  | html 标签无 lang 且 10 语言切换不更新 documentElement.lang                                                                  | `renderer/index.html:5`、`i18n/index.ts:73-108`                                                        | B8                        | 已修复 (PR #117)                   |
| A11Y-11 | 低     | 未显式启用 Chromium 无障碍树，contenteditable 富编辑器退化风险无实测记录                                                    | `src/main/index.ts`                                                                                    | SC                        | 已修复 (PR #136，播报待 NVDA 手测) |
| A11Y-12 | 低     | 侧栏宽度拖拽无键盘等价物；无 color-scheme 声明；无"跟随系统深浅色"                                                          | `sideBar/index.vue:30-33`                                                                              | SC                        | 已修复 (PR #135)                   |

### 1.5 严重性分级口径

- **高**：数据丢失/损坏风险、功能实际失效（含静默失效的真 bug）、系统性合规失败（对比度、键盘可达大面积缺失）、或支配冷启动/大文档体验的主瓶颈。
- **中**：高频流程的明显摩擦、可量化的性能税、局部一致性与合规缺口。
- **低**：打磨项、卫生项、低频路径。

---

## 2. 根本原因分析

58 项问题不是 58 个独立失误，归为 8 个根因簇。每簇给出"在计划中如何被消解"——修复批次之外，更重要的是堵住再生路径。

**RC1 表现层与数据层脱节**（UX-01、UX-08）
脏状态在 store 里实时存在（`tab.isSaved` 实时翻转），但消费它的表现层有两个出口都没接：CSS 把 active 标签的圆点设为透明，`document.title` 的 watch 只看文件名。单点数据多出口展示时，缺少"脏状态渲染规则只有一份"的约定。
_消解_：B1 修两处出口并补 `document.title` 同步测试——该测试就是约定守卫。

**RC2 高频事件缺变化检测闸门**（PERF-02、PERF-03、PERF-07、PERF-11）
`selection-change` 与 `cursorActivity` 这类每键/每 tick 触发的事件，直接驱动全量下游（两条 IPC + 原生菜单全量重写、两次全文序列化、全文档深拷贝），中间没有"变了吗"的判断层。WYSIWYG 主链路已有三档管线治理过同类问题，但这些旁路没跟上。
_消解_：B3 在两处热路径加浅比较缓存/diff 闸；B7 把 muya 侧 tokenize 合并为一次。教训沉淀：新接高频事件必须先问"下游是 O(1) 还是 O(文档)"。

**RC3 构建配置停留在脚手架默认值**（PERF-01）
全量 Element Plus、全静态路由、无 manualChunks 都是项目早期的默认形态，未随功能增长收紧；设置窗口与编辑器窗口共用入口放大了代价。
_消解_：B5 一次性治理，并把 bundle 体积记入 §14 基线面板，形成可回归的数字。

**RC4 主题体系按"复制文件"生长**（DS-01、DS-04、DS-09、DS-10）
33 套主题以整文件复制扩展，通用补丁靠每文件 `!important`；token 层引入后旧体系未迁移（采用率 16%），形成"新 token 被旧补丁覆盖"的僵局。
_消解_：SA 专项收口；在此之前 B9 的色值修改只动 `:root` 变量不动补丁结构，避免在坏结构上加盖。

**RC5 颜色决策无对比度校验环节**（A11Y-02、DS-03）
色值靠手工挑选，没有任何工具门。34 个主题逐一手调不现实，也不可持续。
_消解_：B9 落地 `scripts/check-theme-contrast.py` 接进 CI（对齐 check-md-links 的纯 python 模式），之后新增主题/改色自动受检。

**RC6 同类操作两次实现，未对齐正确版**（UX-06、UX-07、UX-10、A11Y-03）
重命名、删除确认、搜索开关持久化都存在"两个入口两套规则"，且正确版（侧栏内联重命名、exportSettings 的持久化模式）已存在却没被复制到另一处。
_消解_：各批次明确"以哪个实现为基准对齐"；B10 收尾后在本表复核无残留双标准。

**RC7 键盘可达与 ARIA 从未列为验收项**（A11Y-01 至 A11Y-08）
`@click` 直绑 div 是默认写法，48 个 SFC 仅 7 处 aria；没有验收清单，就没有缺口感。
_消解_：B8 先把"可点击即可达"落成批量修复；SC 补全语义；此后 PR 模板加一条自检项（改动含可点击元素时必须键盘可达 + 有名）。

**RC8 半途功能无清理机制**（PERF-07、UX-04、UX-21、DS-07、DS-05）
`tab.blocks` 有接线无读方、`isDirty` 有注释无消费者、`.always-visible` 死类、`:focus-visible` 死样式、缺 `--` 的非法声明——knip 只查 export 不查"有写入无读取"，CSS 声明非法更是零工具可红。
_消解_：逐项清理；DS-05 一类真 bug 靠"改样式必须人工过一遍该文件全部 var() 引用"的 review 习惯兜底；RC8 形状记入 review 清单。

---

## 3. 批次划分与修复步骤

流程铁律：**一批一分支一 PR，目标 `develop`**。每批独立可合并、独立可回滚；批内问题互为同文件/同机制才归并。

### 3.0 批次总览

- [x] **B0** 计划落地（0.5h）— 已合入 develop（PR #109，merge `8a51be9`）
- [x] **B1** 真 bug + 数据安全（4-5h）— 已合入 develop（PR #110）
- [x] **B2** 搜索高频打断（3-4h）— 已合入 develop（PR #111）
- [x] **B3** 性能快赢 · 桌面侧（4-5h）— 已合入 develop（PR #112）
- [x] **B4** i18n + 状态栏 + 空态（3-4h）— 已合入 develop（PR #113）
- [x] **B5** 构建优化（6-8h）— 已合入 develop（PR #114）
- [x] **B6** 性能中量 · 桌面侧（3-4h）— 已合入 develop（PR #115）
- [x] **B7** 性能中量 · muya 侧（4-5h，触引擎）— 已合入 develop（PR #116）
- [x] **B8** 可访问性 · 键盘可达 + 焦点（6-8h）— 已合入 develop（PR #117）
- [x] **B9** 对比度 + 门禁脚本（4-6h）— 已合入 develop（PR #118）
- [x] **B10** UX 收尾 + token 归并（5-6h）— 已合入 develop（PR #119）
- [ ] **SA** 专项：主题文件瘦身（2-3 天）
- [ ] **SC** 专项：ARIA 全套语义（3-4 天）
- [ ] **SB** 专项：muya 大文档虚拟化（1 周以上）

### 3.1 B0 计划落地

- 问题：无（本批即本文档）。
- 步骤：创建本文档；`PROJECT_GUIDE.md` §12 文档索引表登记一行。
- 门禁：`check-md-links.py` 过；CI 为纯文档形状。
- 工时：0.5h。

### 3.2 B1 真 bug + 数据安全

- 问题：UX-01、UX-03、UX-05、A11Y-03、DS-02、DS-05。
- 步骤：
  1. **UX-01** `tabs.vue` 删除 `li.active` 分支里对 `.unsaved-dot` 的 `opacity: 0`（约 370-372 行三行 CSS）；改为"未保存时圆点替换关闭图标、hover 才显示关闭"或直接常显圆点，二选一在实现时定。`titleBar/index.vue` 的 `document.title` watch 加 `isSaved` 依赖，未保存时前缀 `● `，并补 `immediate: true`。
  2. **DS-05** `titleBar/index.vue:332` 补 `--` 前缀。
  3. **DS-02** `index.css` token 层正式定义 `--successColor/--successBgColor/--warningColor/--warningBgColor`（取值与现有 fallback 协调并过对比度），`--editorColor70/--editorColor20` 按既有 alpha 梯度算法补定义；`uploader/index.vue` 删除全部 fallback 写法，改引用定义后的变量。
  4. **UX-05** `quickOpen.ts` 空库分支不再 throw，返回空子命令集；`commandPalette/index.vue` 增加空态行（打开文件夹引导文案），`run()` 的 catch 仅保留对真实异常的 log。
  5. **UX-03 + A11Y-03** `unsavedDialog` 接收 payload：主进程 `file.ts:378` 改传文件名数组（数量由长度得出）；渲染端显示"有 N 个文件未保存"+ 文件名列表（超 5 条截断计数）；打开时记录 `document.activeElement`、autofocus"保存"键；Enter=保存；Tab 循环限制在三键内；关闭归还焦点。文案走 i18n（全 locale 补 key）。
- 测试与门禁：新增 `titlebar-document-title.spec.ts`（sfcScriptHarness 驱动 titleBar setup 断言脏标记前缀）与 `unsaved-dialog.spec.ts`（payload 渲染 + Enter/焦点行为）；扩展 `quick-open-empty-cancel.spec.ts`。**红线**：titleBar 与 unsavedDialog 若走 sfcScriptHarness 装载，SFC 新增 import 必须同步对应 spec 的手写依赖清单。
- 风险与回滚：脏点常显属视觉变化，PR 截图留档；全部改动限 4 个组件 + token 文件，单 commit 可 revert。
- 工时：4-5h。

### 3.3 B2 搜索高频打断

- 问题：UX-02、UX-06、UX-12、UX-20。
- 步骤：
  1. **UX-02** `search/index.vue` 拆分 `emptySearch` 为"关闭栏"与"清词"两个动作；`docClick` 不再关栏清词，只收起高亮；关闭仅由 Esc/关闭按钮触发，且关闭不清 `searchValue`（重开保留）。
  2. **UX-06** 三开关照 `exportSettings/index.vue:337-370` 的 localStorage 模式持久化（key 前缀与现有惯例一致）。
  3. **UX-12** Enter=下一个、Shift+Enter=上一个；替换框 Enter=替换当前并跳下一个（复用引擎单次替换 API）；监听从 keyup 移到 keydown。
  4. **UX-20** `docKeyup` 开头加 `if (!showSearch.value) return` 守卫。
- 测试与门禁：扩展 `search-prefill.spec.ts`（外点不清词、重开回填）；e2e `find-replace.spec.ts` 按 AGENTS.md 抖动纪律先跑**不含改动的对照**再定性。
- 工时：3-4h。

### 3.4 B3 性能快赢 · 桌面侧（不触 muya）

- 问题：PERF-02、PERF-03、PERF-07。
- 步骤：
  1. **PERF-02** `sourceCode.vue`：cursorActivity 只提交光标（O(1)）；markdown 提交挂 CodeMirror `change` 事件 + debounce；`findActiveHeadingIndex` 复用同一次 `getValue()` 返回值；TOC 行索引仅在 change 后重算。**红线**：该 SFC 被 `source-code-image-action.spec.ts` 剥 import 注入依赖，新增 import 必须同步清单。
  2. **PERF-03** 渲染端 `selectionState.ts` 缓存上次 menuState/formatState，浅比较相同则不发送；主进程 `paragraph.ts` 的 `updateSelectionMenus` 先 diff 再赋值（只写变化的 item）。两道闸都上。
  3. **PERF-07** 删除 `blocks` 字段：按 AGENTS.md"删零引用先查动态引用"纪律，先 grep `tab.blocks`/payload 消费（含 e2e 与 bus），再删 `lazyMarkdownPipeline.ts:118`、`contentEvents.ts:103,132`、`IFileState` 声明与 `sourceCode.vue:507` 的写入。
- 测试与门禁：扩展 `application-menu-state.spec.ts` 与 `selection-menus.spec.ts`（新增"状态无变化 → 零 IPC / 零赋值"断言）；`lazy-markdown-*` specs 同步 payload 形状。
- 工时：4-5h。

### 3.5 B4 i18n + 状态栏 + 空态

- 问题：UX-13、UX-14、UX-18、UX-19、UX-21。
- 步骤：
  1. **UX-13** 15 处硬编码串补 key，`static/locales` 全部语言文件同步补齐（zh-CN/zh-TW 人工翻译，其余语言先给英文并确认降级路径）。
  2. **UX-14** 状态栏统计控件 tooltip 动态化（"点击切换统计口径"），阅读时长单位走 i18n。
  3. **UX-18** `toc.vue` 补"此文档没有标题"空态，对齐 history 面板三态。
  4. **UX-19** 命令面板补空态行；过滤字段并入英文基名（双语召回）；hover 同步 `selectedCommandIndex`。
  5. **UX-21** 删除 `.always-visible` 死类；新建按钮默认 `opacity: 0.6` 常显；标签条右缘加渐隐提示。
- 工时：3-4h。

### 3.6 B5 构建优化

- 问题：PERF-01。
- 步骤：
  1. 路由懒加载：`preference.vue` 与 7 个偏好子页、`app.vue` 改动态 import——设置窗口从此不解析编辑器代码。
  2. Element Plus 按需引入（unplugin-vue-components + ElementPlusResolver，devDependency）。
  3. `manualChunks` 拆分 element-plus / vue 系 / `@muyajs/core` / codemirror；codemirror 改为进入源码模式时动态加载。
  4. 构建后记录 bundle 体积到 `PROJECT_GUIDE.md` §14（基线：JS 6.80MB / CSS 0.71MB）。
- 测试与门禁：`pnpm build` 0；e2e 全量对照跑（入口变化影响首帧路径，按抖动纪律先对照）；`validate-licenses` 工作流会因锁文件变动自动起。
- 风险：Element Plus 按需引入可能丢组件样式——保留其全局 CSS 或用 resolver 的样式导入选项，实施时验证 el-dialog/el-select 样式完整。
- 工时：6-8h。

### 3.7 B6 性能中量 · 桌面侧

- 问题：PERF-05、PERF-06、PERF-11、PERF-13。
- 步骤：
  1. **PERF-05** `themeColor.ts` 的 56 个 `?inline` 静态 import 改异步 getter，`BUILT_IN_THEME_CSS` 值改为惰性加载，`addThemeStyle` 异步化（主题切换是用户操作，可接受一次异步）。
  2. **PERF-06** `useEngineOptionSync` 加初始化标志：启动首轮回填直接写引擎 options 不触发 force render，此后变更保持现有 force 镜像。
  3. **PERF-11** TOC 跟随改为缓存标题 offsetTop（TOC 更新时失效）或 IntersectionObserver。
  4. **PERF-13** `transition: all` 收敛为具体属性。
- 测试与门禁：`theme-style-injection.spec.ts` 同步异步化；`engine-option-mirror.spec.ts` 断言首回填零 force render。
- 工时：3-4h。

### 3.8 B7 性能中量 · muya 侧（触引擎：CI 全套 + muya 门）

- 问题：PERF-08、PERF-09、PERF-10、PERF-12、PERF-14、PERF-15、A11Y-09。
- 步骤：
  1. **先更新 `packages/muya/docs/perf-baseline.md`**（AGENTS.md 硬规矩：性能类改动先建基线）。
  2. **PERF-08** `format.ts` inputHandler tokenize 一次并把结果传给三个纯读函数。**红线**：complexity 37 / max-lines-per-function 173 阈值绑在具体函数上，重构只许变小。
  3. **PERF-09** labels 缓存到 jsonState 层，op 触及段落文本时置脏。
  4. **PERF-10** 搜索跳转只更新旧/新活动块的高亮。
  5. **PERF-12** 四个 UI 插件的 mousemove 改为指针在编辑区内才挂载。
  6. **PERF-14/15** 日志级别守卫；reduce+spread 改 push。
  7. **A11Y-09** 失败/空图包裹元素给 `role="img"` 与可读 label；hover 图标补 aria-hidden 或 label。
- 测试与门禁：扩展 `muya/src/search/__tests__/search.spec.ts`；本机 `pnpm -C packages/muya lint`（9 warnings/0 errors 不回退）与 `test:spec`（CommonMark 88.0% / GFM 86.6% 不回退）；perf-baseline 前后对比记档。
- 工时：4-5h。

### 3.9 B8 可访问性 · 键盘可达 + 焦点

- 问题：A11Y-01、A11Y-05、A11Y-07、A11Y-08、A11Y-10，UX-21 的 tabindex 部分。
- 步骤：
  1. **A11Y-01** 可点击元素键盘化：标题栏窗口控制三键与偏好窗同型按钮改 `<button>`；标签页 li 加 tabindex + role=tab + Enter/Space/Delete；状态栏两控件、搜索三开关（补 `aria-pressed`）、通知"确定/关闭"、新建按钮、keybindings 页无 href 的 a 改 button。
  2. **A11Y-07** `:focus { outline: none }` 收窄为 `:focus:not(:focus-visible)`；补偿选择器扩展到树行/标签页/status-btn；`LinkIcon.vue` 去掉硬编码 aria-hidden，改由消费点传 aria-label 并可聚焦。
  3. **A11Y-05** 搜索计数容器 `aria-live="polite"`；通知条按级别 `role="alert"/"status"`；loading 组件 `role="status"` + label。
  4. **A11Y-08** 命令面板输入框 combobox 语义 + 列表 listbox/option + `aria-activedescendant`。
  5. **A11Y-10** `index.html` 加 lang，`setLanguage` 同步 `documentElement.lang`。
- 测试与门禁：新增 keyboard-reachability 扫描类单测（可选，静态扫描 @click 非 button 元素清单防回潮）；e2e 冒烟一轮。
- 工时：6-8h。

### 3.10 B9 对比度 + 门禁脚本

- 问题：A11Y-02、DS-03。
- 步骤：
  1. **A11Y-02** 变量级替换（不动组件结构）：通知色带 `#B25E00 / #D93B3B / #6B6D76`、亮色三级 `#66707B`、状态栏/侧栏三级 `#59636E`、暗色主按钮压暗至白字可达标（如 `#4C56B8`）；32 个主题文件的 `--buttonPrimaryBgColor` 用脚本按亮度计算批量生成 diff，人工过一遍。
  2. **DS-03** 遮罩收敛两档 token（对话框档 / 全屏查看器档），四处硬编码改引用；边框收敛 `--border-subtle/strong` 两档，暗主题 `--floatBorderColor` 改白系 color-mix 派生。
  3. 新增 `scripts/check-theme-contrast.py`：解析全部 theme css 的 `:root` 变量，对固定色对（主按钮、侧栏文字、正文）算对比度，低于阈值报错；接进 lint.yml（对齐 check-md-links 的挂法，纯 python 零依赖）。
- 测试与门禁：e2e `themes.spec.ts` + 33 主题视觉抽查（截图留档作 SA 的基线）；新门禁绿灯。
- 工时：4-6h。

### 3.11 B10 UX 收尾 + token 归并

- 问题：UX-04、UX-07、UX-08、UX-10、UX-11、UX-15、UX-16、UX-17、DS-04、DS-06、DS-07。
- 步骤：
  1. **UX-04** 快捷键：关窗时消费 `isDirty` 弹确认（保留显式保存模型，改动最小；"改为即时保存"作为备选在 PR 里定夺）；`_isDuplicate` 加 excludeId 排除自身；冲突 toast 带被占用命令名。
  2. **UX-10** `rename/index.vue` 对齐侧栏版：预选词干、扩展名锁定展示。
  3. **UX-07** 侧栏删除加确认对话框（偏好可关）+ 成功 toast。
  4. **UX-08** 空状态补"打开文件/打开文件夹"按钮 + 最近文档前 5 条（主进程已有 get-recent-documents 通道）。
  5. **UX-11** 导出期间 loading 遮罩 + 完成成功 toast。
  6. **UX-15/16/17** 缩放百分比在状态栏短暂显示；File 菜单加"全部保存"接既有 ASK_FOR_SAVE_ALL；全部替换后 toast 报 N 处（若引擎不返回计数则取替换前匹配数，必要时该子项挪 B7）。
  7. **DS-04** `body { font-family: var(--font-ui) }` 一行；旧 token 列淘汰清单（只记档不迁移）。
  8. **DS-06** 机械归并：圆角 3→4、5→6；字号 14 并入 13；等宽字体统一 `--font-mono`；import 页 70px 行高改 flex 居中。
  9. **DS-07** z-index 阶梯注释化（float 10000 / modal 11000 / toast 12000），删 index.css 死规则。
- 工时：5-6h。

### 3.12 专项 SA 主题文件瘦身

- **边界**：只动 `assets/themes/*.theme.css` 与补丁上收 `index.css`；不改任何色值视觉（B9 已定色）。32 份文件瘦身为纯 `:root` 色值表；titlebar/side-bar/editor-tabs/code-block/kebab 别名五类补丁上收为一份，用 `body.dark` + `var()` 表达；`!important` 清零；补齐 4 个缺 side-bar 补丁的主题；顺带 **DS-09**（themeColor.ts 导出主题 meta 供预览色板消费）与 **DS-10** 的变量部分、**DS-08** 的图标标准定档。
- **前置**：B9 合入且 e2e themes 稳定一周；33 主题截图基线（B9 留档）。
- **验收**：截图基线逐主题对照零视觉差异；桌面四门全绿。
- **工时**：2-3 天。

### 3.13 专项 SC ARIA 全套语义

**2026-11-02 分解**：原文把 SC 当成一个专项，实际是四件可独立交付的东西，按本仓"一批一分支一 PR"就是四个 PR；且验收里的人工屏幕阅读器部分无法由自动化替代。故拆为 SC-1…SC-4 各走一批，顺序按下表的依赖与价值排。另有一项从 SC 里摘出：A11Y-12 的"跟随系统深浅色"不是 ARIA，而是带偏好项、IPC 与主题切换的产品功能，混进来会破坏 SC-4 的"零视觉变化"验收，另立一批。

| 子批     | 内容                                                                                  | 状态                                                  |
| -------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **SC-1** | menuBar 语义 + 键盘导航（A11Y-04 / UX-09）                                            | **已修复 (PR #131)**                                  |
| **SC-2** | 文件树 tree/treeitem/aria-expanded/aria-level/aria-current（A11Y-06）                 | **已修复 (PR #134)**                                  |
| **SC-4** | 侧栏拖拽条 `role="separator"` + 键盘步进、`color-scheme` 声明（A11Y-12 的 ARIA 部分） | **已修复 (PR #135)**                                  |
| **SC-3** | 显式启用 Chromium 无障碍树（A11Y-11）                                                 | **已修复代码与 AX 断言 (PR #136)，NVDA 手测待维护者** |

- **边界**：见上表；SC-1 只动 `components/menuBar/*` 与新增的 `menuFocus.ts`，不碰主进程菜单（macOS 用原生菜单，本就不渲染这条栏）。
- **前置**：B8 合入（键盘可达基线已在）——已满足。
- **验收**：NVDA 手测编辑器/侧栏/菜单/对话框可读可操作，记录进 PROJECT_GUIDE §14 或 §11。**这条需要人的手**：自动化能断言的是 AX 树里的 role/name/state 结构，不是播报质量。约定的分工是——代码与结构断言由 agent 做完并入库，同时交一份逐步的 NVDA 实测清单（每个场景"应该听到什么"写清），由维护者跑一轮后把结果回写 §14。因此 SC-3 排最后，不挡前三批。逐场景清单见 [NVDA_MANUAL_CHECKLIST.md](./NVDA_MANUAL_CHECKLIST.md)。
- **SC-1 的实现记录（2026-11-02）**：审查时发现计划对 A11Y-04 的描述偏轻——写的是"下拉项键盘不可达"，实情是**整个窗口内菜单栏只能靠鼠标打开**（顶层项是无 tabindex 的 div，B8 未触碰 menuBar）。交付内容：`role="menubar"` + roving tabindex（整条栏在 Tab 序列占一格）、顶层 Enter/Space/↓ 打开并把焦点送进下拉、↓/↑ 行走（越过 separator、回绕、全 separator 时返回 -1 而非死循环）、Home/End、Enter 触发行、Esc 关闭并把焦点还给顶层项、栏未打开时 ←/→ 移动停靠位、→ 进入子菜单 / ← 收起一级、带子项的行声明 `aria-haspopup`/`aria-expanded`、禁用行 `aria-disabled`（此前对 AT 完全不存在）、勾选态由 `aria-checked` 播报而 `✓` 字符转 `aria-hidden`。两处与批准设计的偏离已记在提交信息里：禁用行改为**可聚焦不可触发**（WAI-ARIA 口径，原设计要跳过），以及 document 捕获阶段的"←/→ 切顶层"加了"焦点不在下拉内"的守卫（否则 ArrowRight 会切菜单而不是展开子菜单）。该组件此前**没有任何 e2e 覆盖**，本批补 8 条。
- **工时**：原估 3-4 天；分解后 SC-1 已占约 1 天，余三批合计 1.5-2 天 + 一次人工屏幕阅读器实测。

### 3.14 专项 SB muya 大文档虚拟化

- **边界**：`ScrollPage.updateState`/`create` 的 keyed 差量复用；视口外顶层块占位高度 + 延迟建树；undo 的 rebuild 限定在 op 覆盖的顶层块；桌面侧 `sourceCode.vue` 恢复 CodeMirror 自滚动（`viewportMargin` 有限值）与滚动位置映射。
- **前置**：`packages/muya/docs/perf-baseline.md` 建立大文档（数千段）基线数字；B7 已合入。
- **验收**：perf-baseline 前后对比达标；`test:spec` 符合率不回退；e2e 全量对照。
- **工时**：1 周以上，独立一批一 PR，必要时拆两批（引擎 / 桌面源码模式）。

---

## 4. 优先级排序

排序依据：数据安全 > 真 bug > 高频打断 > 系统性性能 > 无障碍合规 > 视觉一致 > 大动面重构。

| 优先级 | 批次                         | 理由                                                                          |
| ------ | ---------------------------- | ----------------------------------------------------------------------------- |
| P0     | B0 → B1 → B2                 | 数据安全信号（脏标记、未保存对话框）与两个已验证真 bug；B2 是最高频的交互打断 |
| P1     | B3 → B5                      | 系统性性能主瓶颈：每键 O(N) 与 IPC 风暴；包体积支配冷启动                     |
| P2     | B4 → B6 → B7 → B8 → B9 → B10 | i18n 观感、中量性能税、无障碍合规、对比度门禁、UX 收尾                        |
| P3     | SA → SC → SB                 | 大动面专项：依赖前置批次与稳定窗口，各独立立项                                |

---

## 5. 预计实施时间

工时合计：常规批次约 43.5-56.5h（取中约 50h），加 30% 门禁重跑 / e2e 对照 / 返工缓冲 ≈ 65h；专项合计约 80-120h。按全职 30h/周投影：

| 周次   | 计划批次               | 工时       | 缓冲用途                |
| ------ | ---------------------- | ---------- | ----------------------- |
| 周 1   | B0、B1、B2、B3         | 12-15.5h   | e2e 对照跑、PR 门禁往返 |
| 周 2   | B4、B5、B6             | 12-16h     | B5 的 e2e 全量对照      |
| 周 3   | B7、B8                 | 10.5-13.5h | muya CI 全套往返        |
| 周 4   | B9、B10 + 阶段复盘     | 9-12h      | 33 主题视觉抽查         |
| 周 5-6 | SA（含截图基线对照）   | 16-24h     | —                       |
| 周 6-7 | SC（含 NVDA 实测）     | 24-32h     | —                       |
| 周 7-9 | SB（含 perf 前后对比） | 40-64h     | 可与 SC 尾部并行        |

**结论**：常规批次（P0-P2）约 4 个日历周完成；全部含专项约 7-9 周。若容量变化，按 §4 优先级顺序整批顺延，不打散批次。

---

## 6. 资源分配

- **人力**：单人维护者串行执行；每批自查 + 全量门禁 + 必要时 e2e 对照，无外部依赖。
- **CI 分钟预算**（按 AGENTS.md 实测形状估算）：
  - B0 纯文档：约 8.4 min/合并。
  - 桌面批次（B1-B6、B8-B10）：每 PR 约 15-25 min（lint + test ubuntu/windows + coverage，PR 侧另有 e2e/打包腿）。
  - 触 muya 批次（B7、SB；SC 若动引擎）：每 PR 约 25-40 min（全套 10 腿）。
  - 全程估 **250-400 CI 分钟**。
- **依赖变更**：仅 B5 新增 unplugin-vue-components（devDependency，锁文件变动会触发 validate-licenses）；B9 的 python 脚本零新依赖。无运行时依赖变更。
- **测试资产**：新增/扩展约 8 个 spec（titlebar-document-title、unsaved-dialog、quick-open-empty-state 扩展、search 行为扩展、application-menu-state/selection-menus 零变化断言、theme-style-injection 异步化、muya search 扩展、keybinding-save-dirty 扩展）。门禁数字基线 **135 文件 / 1315 通过 + 1 跳过**，逐批在 §14 记档。
- **工具/技能**：B9 对比度脚本（python）；SA 截图基线（Playwright 或手工）；SC 需 NVDA（或等效 SR）手测。

---

## 7. 跟踪机制

1. **状态流转**：§1 总表状态列与 §3.0 批次复选框是唯一进度真值。开分支 → 问题标 `进行中`；合入 develop → 标 `已修复(PR#)` 并勾选复选框；评估后不做 → 标 `已关闭` 并写理由（对齐 §16 功能候选的处置惯例）。
2. **命名约定**：分支 `fix/gui-b1-title-dirty-marker` 式命名；PR 标题前缀 `[GUI-B1]`；单批多问题在同一 PR 内用 commit 粒度区分。
3. **每批合并后动作清单**：① 更新本文档状态列与复选框；② 更新 `PROJECT_GUIDE.md` §14 基线面板（测试数、bundle 体积等被本批改变的数字）；③ 若产生新门禁/新基线，同步 AGENTS.md 门禁表；④ 复核本批是否引入新的 RC8 形状（死代码/无消费者）。
4. **门禁报数纪律**：每批报退出码，并报**没跑的那一门**（AGENTS.md 动手前必读第 4 条）；触 muya 批次必须报 muya lint 与 test:spec 数字。
5. **退役条件**：§3.0 全部复选框勾完且专项闭环 → 有效结论迁 §14/§11 → 本文档删除，对齐 OPTIMIZATION_ROADMAP 先例。

---

## 8. 全局验收标准

**每批门禁（桌面形状）**：`pnpm check` 0 errors（93 warnings 零净增）、`pnpm test:unit` 全绿（新数字记档）、`pnpm build` 0、`pnpm knip:full` 0。

**每批门禁（触 muya 形状，B7/SB）**：以上全部 + `pnpm -C packages/muya lint`（9 warnings/0 errors）+ `test:spec`（CommonMark 88.0% / GFM 86.6% 不回退）+ perf-baseline 记档。

**红线清单（每批自查）**：

- 形状阈值 `complexity 37` / `max-lines-per-function 173` 只减不增；
- 不用 `--no-verify` 绕门禁；
- 改 titleBar/search/sourceCode/commandPalette/menuBar 的 SFC 时，同步 sfcScriptHarness 依赖清单；
- 删"零引用"代码前先查动态引用（bus/e2e/运行时字符串）；
- `git fetch` 走 remote，`--prune` 后再 reset。

**总验收（全部批次完成后）**：

- 渲染端首包 ≤ 4MB（B5 后实测，记 §14）；
- `check-theme-contrast.py` 门禁绿灯（B9 后常驻）；
- §1 总表中**高**严重度 58 项里的全部条目闭环（修复或已关闭并说明）；
- 源码模式大文档键入不再随文档大小线性劣化（B3 + SB 前后对比）。

---

## 9. 参考文档

- [PROJECT_GUIDE.md](./PROJECT_GUIDE.md) — 结构、模块地图、§14 实测基线面板（本计划的数字锚点）。
- [UI_REDESIGN_GUIDE.md](./UI_REDESIGN_GUIDE.md) — V1 设计系统规范（DS 维度的验收基准；其骨架参数与实现的已知漂移在 B10 记档）。
- [../packages/muya/docs/perf-baseline.md](../packages/muya/docs/perf-baseline.md) — 性能数字唯一来源（B7/SB 的前置与验收载体）。
- [../AGENTS.md](../AGENTS.md) — 门禁基线、四条必读规矩与一批一分支一 PR 流程。
