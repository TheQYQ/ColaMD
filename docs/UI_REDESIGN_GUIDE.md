# ColaMD 界面重构与现代化设计指南

> 版本 V1 · 2026-09-16 · 适用 base：develop @ 0.1.3
> 定位：**Refinement 模式**——保留现有布局骨架（侧栏 / Tab / 编辑区 / 状态栏），系统性重做视觉语言与组件细节。
> 设计基调一句话：给写作者和开发者的 Markdown 编辑器，用「冷静的中性灰 + 单一低饱和靛蓝强调色」的语言，把界面做成一张安静的书桌。

---

## 〇、现状问题 → 对策总览

| 现状问题（截图所见） | 根因 | 本指南对策 |
| --- | --- | --- |
| 侧栏浅灰 vs 编辑区纯白，对比生硬 | 两块区域色温不一致、缺过渡层 | 统一冷灰色阶（§1.1），侧栏与编辑区仅差 2-3 个灰阶档位 |
| 亮绿色「打开文件夹」按钮突兀 | 高饱和品牌色 + 大面积实心块 | 降级为幽灵/次级按钮，强调色收归全局单一靛蓝（§1.1、§3.2） |
| 顶部原生菜单栏杂乱 | Electron 默认菜单条占一整行 | 自绘标题栏收编菜单（§3.1） |
| Tab 像十年前的网页 | 经典梯形/方角 Tab + 全宽底边框 | 分离式圆角 Tab + 未保存圆点（§3.4） |
| 层级扁平 | 全局都是同一档 13-14px 黑字 | 三档字阶 + 三档文本色 + 三级阴影（§1.2、§1.3） |
| 缺乏呼吸感 | 侧栏/正文 padding 不足、无内容宽度限制 | 8px 网格 + 正文 800px 居中（§2） |

---

## 一、设计系统（Design Tokens）重定义

### 1.1 色彩体系

原则：**中性灰只用一个色温**（本方案选冷灰，微蓝调）；**全局唯一强调色**；正文背景永远不是纯白，文字永远不是纯黑。

#### 亮色主题（默认）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--bg-app` | `#F5F6F8` | 应用底色：侧栏、Tab 条、状态栏背景 |
| `--bg-editor` | `#FCFCFC` | 编辑区画布（与 app 底仅差 2 档，过渡不生硬） |
| `--bg-elevated` | `#FFFFFF` | 浮层：菜单、弹窗、下拉（永远配 shadow-md） |
| `--bg-hover` | `rgba(15, 18, 25, 0.04)` | 所有列表行/按钮的悬停态 |
| `--bg-active` | `rgba(15, 18, 25, 0.07)` | 按下态 |
| `--bg-selected` | `rgba(91, 103, 199, 0.10)` | 选中态（文件树/Tab，accent 的 10% 透明度） |
| `--text-primary` | `#1F2328` | 标题、正文、文件名 |
| `--text-secondary` | `#59636E` | 侧栏分区标题、次级按钮文字、字数统计 |
| `--text-tertiary` | `#8B949E` | placeholder、禁用态、状态栏图标 |
| `--border-subtle` | `rgba(15, 18, 25, 0.06)` | 默认分割线（多数场景建议直接用留白替代） |
| `--border-strong` | `#DDE1E6` | 输入框描边、可交互边框 |
| `--accent` | `#5B67C7` | 唯一强调色：选中态、主按钮、焦点环、链接 |
| `--accent-hover` | `#4C58B5` | 强调色悬停 |
| `--accent-subtle` | `rgba(91, 103, 199, 0.08)` | 强调色底色（选中背景、焦点环 40% 版本） |
| `--danger` | `#C4402F` | 删除、关闭失败（仅语义错误，不做装饰） |

> 强调色选型说明：`#5B67C7` 是低饱和靛蓝（饱和度约 47%），参照 Linear `#5E6AD2` 与 Polaris `#5C6AC4` 的成熟区间，与冷灰中性色同温。备选：墨绿 `#2D7D6E`（更纸感）、暖陶 `#B65C43`（更人文）——**只能选一个**，全应用锁定。

#### 暗色主题（同步定义，不做半吊子暗色）

| Token | 值 |
| --- | --- |
| `--bg-app` | `#191A1E` |
| `--bg-editor` | `#212227` |
| `--bg-elevated` | `#26282E` |
| `--bg-hover` | `rgba(255, 255, 255, 0.06)` |
| `--bg-selected` | `rgba(125, 136, 230, 0.16)` |
| `--text-primary` | `#E6E8EB` |
| `--text-secondary` | `#9DA3AD` |
| `--text-tertiary` | `#6B7280` |
| `--border-subtle` | `rgba(255, 255, 255, 0.08)` |
| `--border-strong` | `#3A3D45` |
| `--accent` | `#8791DE`（暗色下提亮保持对比度） |

### 1.2 排版规范

#### 字体栈（零加载成本优先）

```css
/* UI + 正文：系统栈（Win11 Segoe UI Variable / macOS SF Pro 自动匹配） */
--font-ui: system-ui, -apple-system, 'Segoe UI Variable Text', 'Segoe UI',
           'PingFang SC', 'Microsoft YaHei UI', sans-serif;

/* 代码：写作工具的等宽字体三连 */
--font-mono: 'JetBrains Mono', 'Cascadia Code', 'SF Mono', Consolas, monospace;
```

> 说明：Electron 桌面应用用系统栈是**正解**——原生质感、零 FOUT、中文渲染由系统调优。若未来需要跨 OS 完全一致的品牌感，再自托管 Inter Variable（你提的可选项），但不要用 `<link>` 引 Google Fonts。

#### 字阶（4px 网格派生）

| 层级 | 字号/行高 | 字重 | 颜色 Token | 用在哪 |
| --- | --- | --- | --- | --- |
| `caption` | 11px / 16px | 400 | `--text-tertiary` | 状态栏、时间戳 |
| `label` | 12px / 18px | 500 | `--text-secondary` | 侧栏文件树、分区标题（分区标题额外 +0.5px letter-spacing） |
| `body-ui` | 13px / 20px | 450* | `--text-primary` | 菜单、按钮、输入框、右键菜单 |
| `prose` | 16px / 1.7 | 400 | `--text-primary` | 编辑器正文 |
| `prose-h3` | 18px / 1.5 | 600 | — | 正文 H3 |
| `prose-h2` | 22px / 1.4 | 650 | — | 正文 H2 |
| `prose-h1` | 28px / 1.3 | 700 | — | 正文 H1 |

\* 若系统栈不支持 450，用 400 + `--text-secondary` 补偿层级。

#### 关键规则

- 侧栏文件树用 12px/500——**这是和旧版拉开差距最立竿见影的一档**（旧版 14px 太重）
- 正文字号默认 16px，用户可在设置 14/16/18 三档调节；行高锁定 1.7（写作舒适区 1.6–1.8 的中点）
- 代码块 13px / 1.6 / `--font-mono`

### 1.3 圆角与阴影

#### 圆角（全局锁定一套体系）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--radius-sm` | 4px | 标签、字数统计小徽标、行内代码标记 |
| `--radius-md` | 6px | **按钮、输入框、文件树行、Tab**（工作马） |
| `--radius-lg` | 10px | 弹出菜单、模态框、设置卡片 |

> 一致性锁：交互元素一律 6px，浮层一律 10px。不允许按钮 6px + 卡片 12px + 弹窗 4px 的混搭。

#### 阴影（色相随背景，禁纯黑）

| 层级 | 值 | 用途 |
| --- | --- | --- |
| `shadow-sm` | `0 1px 2px rgba(18, 20, 26, 0.06)` | 悬停的列表行、active Tab |
| `shadow-md` | `0 4px 16px rgba(18, 20, 26, 0.10)` | 下拉菜单、popover（必须同时带 1px `--border-subtle` 描边） |
| `shadow-lg` | `0 12px 32px rgba(18, 20, 26, 0.16)` | 模态框、命令面板 |

> 分割优先级：**留白 > shadow-sm > 1px border**。能用 `gap` 解决就不要画线；侧栏与编辑区之间建议直接靠色差区分（更 Notion），最多加 1px `--border-subtle`。

---

## 二、布局与空间（Layout & Spacing）

### 2.1 全局网格

- **基础单位 4px**，间距只用倍数：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 64`
- 三大区域固定高度：标题栏 40px · Tab 条 36px · 状态栏 26px（均比现在略收紧）
- 侧栏默认宽 260px，可折叠至 48px 图标栏；编辑区占余下全部空间

### 2.2 各区域 Padding（呼吸感的来源）

| 区域 | 具体值 | 现状对比 |
| --- | --- | --- |
| 侧栏整体 | 左右 padding **12px**，分区间距 16px，分区内行间距 2px | 现在约 8px，太贴边 |
| 侧栏顶部（搜索/segmented 上方） | 12px 顶 padding + 12px 底 margin | — |
| 文件树行高 | **28px**（12px 字号 + 上下各 8px） | 更松 |
| 编辑区正文 | `max-width: 800px; margin: 0 auto;`（16px 字号下约 50 字符/行，写作最优区间 45–75ch） | **新增内容宽度限制——单项收益最大** |
| 正文上下留白 | 顶部 48px、底部 30vh（滚到底文字不贴底） | 现在几乎为 0 |
| 段落间距 | 0.8em；标题上间距 1.6em / 下 0.6em（H1 上加 2em） | — |
| 状态栏 | 高 26px，左右 padding 12px，元素间距 16px | — |

### 2.3 呼吸感三原则

1. **留白代替分割线**：侧栏「文件 / 大纲 / 搜索」分区之间用 20px 空白，不画线
2. **内容聚拢、边缘放大**：正文列宽收窄到 800px，两侧自然多出的空间就是呼吸感，不要试图填满
3. **一屏一个焦点**：编辑区打开时，视野里只应有一件事——文字。侧栏图标、状态栏全部降到 tertiary 色

---

## 三、核心组件微观重构

### 3.1 顶部菜单与标题栏

**方案：自绘标题栏，菜单降级为「按需出现」**

- `titleBarStyle: hidden` + Windows `titleBarOverlay`，去掉整行原生菜单栏
- 标题栏布局（40px 高，`--bg-app` 底色）：
  - 左：App 图标(16px) + 8px + **文件路径面包屑**（12px secondary，点击弹历史）
  - 中：Tab 条（见 §3.4）
  - 右：窗口控制三键（titleBarOverlay 原生渲染，颜色 token 化）
- 菜单归属：**Alt 键按需浮现**原生菜单（Windows 习惯保留）+ 右上角「⋯」溢出菜单收纳低频项（导出/偏好设置）。高频操作全部转键盘快捷键——写作工具的菜单本就不该被鼠标用

### 3.2 「打开文件夹」按钮重塑

分场景两个形态，**都放弃大面积高饱和实心**：

**A. 侧栏头部（常驻）→ 幽灵图标按钮**

```
默认：36×28px，图标 16px --text-secondary，背景透明
悬停：背景 --bg-hover，图标 --text-primary        transition 120ms ease-out
按下：背景 --bg-active                             （无位移，桌面密度不做 scale）
聚焦：2px --accent 40% 外环，offset 1px
禁用：图标 --text-tertiary，无悬停
```

**B. 空状态页（无文件打开时的编辑区中央）→ 次级填充按钮 + 主 CTA 变体**

```
次级：背景 --bg-elevated，1px --border-strong，文字 13px/500 --text-primary，
      radius 6px，padding 8px 16px
悬停：背景 --bg-hover，边框 --text-tertiary
按下：背景 --bg-active

主 CTA 变体（仅空状态允许一处强调）：背景 --accent，文字 #FFFFFF，
  悬停 --accent-hover，按下 --accent-hover + 内阴影 0 1px 2px rgba(0,0,0,.2)
```

> 绿色大按钮的替身是 B 的主 CTA 变体：靛蓝实心**只出现在空状态引导这一个地方**，日常界面里强调色只以 10% 透明度底色出现。

### 3.3 左侧导航「文件 / 目录 / 搜索」

**方案：顶部 Segmented Control（分段控件）**

```
容器：32px 高，背景 --bg-hover，radius 6px（整体一个圆角胶囊），padding 2px
分段：等宽三段，13px/450
  默认段：透明背景，--text-secondary
  激活段：背景 --bg-elevated，--text-primary，radius 4px，shadow-sm
  悬停（未激活）：--text-primary
切换动画：激活底块用绝对定位滑块，translateX 200ms cubic-bezier(0.2, 0, 0, 1)
```

> 备选：Notion 式图标竖排 rail（48px 宽图标列）。但 ColaMD 只有 3 个视图，segmented 的「可见性 > 折叠性」更优；等视图超过 4 个再换 rail。

### 3.4 Tab 条

**方案：分离式圆角 Tab（Notion / Arc 风格），废梯形**

```
Tab 条：36px 高，背景 --bg-app，与编辑区之间无分割线
单个 Tab：
  高 28px（上下留 4px），padding 0 10px，radius 6px，最大宽 200px（ellipsis 截断）
  未激活：文字 --text-secondary，图标 14px --text-tertiary
  悬停：背景 --bg-hover
  激活：背景 --bg-editor（与画布同色，「融入」内容区），文字 --text-primary，shadow-sm
未保存标记：关闭按钮位置显示 6px 圆点 --text-secondary；悬停 Tab 时圆点变 × 按钮
关闭按钮：仅悬停该 Tab 时出现，14px，hover 背景 --bg-active
溢出：横向滚动 + 两端 8px 渐隐遮罩
```

### 3.5 文件列表项（文件树）

```
行：28px 高，radius 6px，padding 0 8px，图标 16px + 8px 间距 + 12px/500 文字
默认：文字 --text-primary（当前打开文件）/ --text-secondary（其余）
悬停：背景 --bg-hover
选中（当前打开）：背景 --bg-selected + 文字 --text-primary（不用左侧高亮条——
  色块本身已是当前最干净的表达，高亮条是传统文件管理器语言）
拖拽悬停（作为放置目标）：1.5px --accent 内描边
重命名态：行内输入框，1px --accent，radius 4px
```

### 3.6 编辑区

```
列宽：max-width 800px 居中（§2.2）
正文：16px / 1.7 / --text-primary；段间距 0.8em
标题：H1 28/700、H2 22/650、H3 18/600，上间距拉开到 1.6em 制造节奏
行内代码：--font-mono 13px，背景 --bg-hover，radius 4px，padding 1px 5px
引用块：3px 左竖线 rgba(--accent, 0.4) + padding-left 14px，背景透明（不要灰底块）
分割线：1px --border-subtle，上下 24px
Placeholder（空文档）：--text-tertiary，功能句文案「开始输入，Markdown 语法可用」，
  首行居中上移 30vh（Typora 式）
块级悬停装饰：仅悬停段落时左侧淡入拖拽手柄/段落菜单（14px，--text-tertiary），
  不给正文加背景色——保持纸面干净
```

### 3.7 状态栏

**方案：融入式极简条（不做悬浮标签）**

```
高度 26px，背景 --bg-app（与侧栏同色，与编辑区之间 1px --border-subtle 或无线）
字号 11px / --text-tertiary，图标 14px
右下：字数统计「0 字 · 0 词」，分段之间 16px 间距；悬停段升为 --text-secondary
  （可点击：点击字数 → 弹出字符/词/行/阅读时长详情 popover）
左下：大纲、代码视图切换图标，ghost 图标按钮（同 §3.2A 态矩阵）
原则：状态栏一切元素默认 tertiary，hover 才升 secondary——状态栏是仪表读数，不是导航
```

---

## 四、微交互与动效

**全局原则**：桌面工具动效只做三件事——反馈（我点到了）、过渡（东西从哪来）、层级（浮层比页面高）。没有装饰性动画；一切动效尊重 `prefers-reduced-motion`（置 0ms）。

| 场景 | 参数 | 说明 |
| --- | --- | --- |
| 颜色/背景类 hover（按钮、列表行、Tab） | `background-color 120ms ease-out` | 最常用；色变要快，不拖沓 |
| 按钮按下 | `background 80ms` + 无位移 | 桌面密度下 scale 会显得晃 |
| 浮层出现（菜单/popover/下拉） | `opacity 0→1 + translateY(-2px)→0 + scale(0.98→1)`，`160ms cubic-bezier(0.16, 1, 0.3, 1)`（ease-out-expo 系） | 消失时 `120ms ease-in`，仅 opacity |
| 命令面板（⌘K，建议新增） | 同浮层 + 内容 stagger 20ms/项 | Linear 的标志性体验 |
| Segmented 切换滑块 | `transform 200ms cubic-bezier(0.2, 0, 0, 1)` | 只动 transform，不动 width |
| 侧栏折叠/展开 | `width 240ms cubic-bezier(0.4, 0, 0.2, 1)`；编辑区重排不动画 | 宽度动画只作用于侧栏本身 |
| Tab 激活切换 | 内容区 `opacity 120ms ease-out`；Tab 背景色 120ms | 不做滑动指示器（Tab 是独立块） |
| 文件树展开/收起 | 子树 height 不动画（布局抖动大）；仅箭头 `rotate 160ms ease-out` | 折衷的干净做法 |
| 保存指示 | 未保存圆点出现 `opacity 160ms`；保存后变 ✓ `800ms` 后淡出 | 微叙事一次 |
| 焦点环 | 出现 `0ms`（即时），颜色 `--accent` 40%，`outline-offset 1px` | 键盘可达性硬要求 |

---

## 五、视觉对标分析（抄谁的什么）

### 5.1 Typora —— 抄「内容的克制」

| 可抄细节 | 落到 ColaMD |
| --- | --- |
| 正文列宽收窄 + 巨大上下留白，侧栏全隐后整屏是纸 | §3.6 的 800px 居中与 30vh 底部留白 |
| 块级元素 hover 才出现的淡装饰（手柄/菜单） | §3.6 块级悬停装饰——编辑区默认零杂讯 |
| 即时渲染无分割线：源码与预览之间没有「预览窗」概念 | 已同源（muya 即时渲染），视觉上不要加任何「编辑态外框」 |
| 空文档 placeholder 居中上移 | §3.6 placeholder 样式 |

### 5.2 Obsidian —— 抄「结构与灰阶」

| 可抄细节 | 落到 ColaMD |
| --- | --- |
| 图标 rail + 可折叠面板的双层侧栏（后续视图变多时的演进路径） | §3.3 备选方案 |
| 暗色主题的多档灰阶（不是纯黑一锅烩，5 档灰阶分层） | §1.1 暗色 token 的 5 档体系 |
| Tab 的「激活即融入内容区」处理与未保存圆点 | §3.4 |
| 设置弹窗的左右分区 + 搜索（收编原生设置页） | 下一轮设置重构参考 |

### 5.3 Linear —— 抄「纪律」

| 可抄细节 | 落到 ColaMD |
| --- | --- |
| 键盘优先：⌘K 命令面板吃掉 80% 的菜单操作 | §3.1 菜单收编的最终归宿 + §四 命令面板动效 |
| 色彩纪律：中性灰做整个世界，强调色只给「选中/主行动」 | §1.1 accent 使用范围铁律 |
| 列表 hover/selected 的低饱和处理（4–7% 黑透明度，从不实心色块） | §3.5 文件树全部状态 |
| 用留白和字重分层，几乎不用分割线 | §1.3 分割优先级 |

> 补充 Bear：它的价值在**默认排版即成品的写作感**（行距、段距、标题节奏），ColaMD 正文排版参数（§1.2 prose 行）直接对齐 Bear 的阅读体感即可。

---

## 六、实施清单（按收益/成本排序）

| 优先级 | 改动 | 涉及文件（现仓库） | 预估 |
| --- | --- | --- | --- |
| P0 | 色板 token 落地（亮/暗两套 CSS 变量） | 新增 `src/renderer/src/assets/tokens.css`，替换各组件硬编码色 | 0.5 天 |
| P0 | 正文 800px 居中 + 行高 1.7 | muya 编辑器容器样式（editor.vue 容器层） | 2 小时 |
| P0 | 打开文件夹按钮去绿（幽灵/次级化） | sideBar 相关组件 + 空状态组件 | 2 小时 |
| P1 | 侧栏字号 12px/500 + 行高 28px + 留白重排 | sideBar 组件族 | 0.5 天 |
| P1 | 分离式圆角 Tab + 未保存圆点 | `editorWithTabs/tabs.vue` | 1 天 |
| P1 | 状态栏 11px/tertiary 化 + 可点击字数 | 状态栏组件 | 0.5 天 |
| P2 | 自绘标题栏 + 菜单收编（titleBarOverlay） | 主进程窗口配置 + 新标题栏组件 | 2–3 天 |
| P2 | Segmented 导航 + 命令面板（⌘K） | sideBar 头部 + 新组件 | 2–3 天 |

**验收基线**：改完后并排截图对比旧版，检查——① 界面里是否还有任何一处饱和度 >80% 的色块；② 灰阶是否都在同一色温；③ 正文行是否 45–75ch；④ 键盘 Tab 遍历全应用焦点环可见；⑤ 暗色主题逐屏截图无一处漏改。
