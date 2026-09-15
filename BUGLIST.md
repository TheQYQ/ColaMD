# ColaMD Bug 清单（全量源码审计 · 2026-09-15 · 全部已修复）

> 审计范围：origin/develop @ eb3de9d（0.1.3）。
> 方法：主线全量静态验证（muya 222 文件 1501 用例 + desktop 61 文件 862 用例 + typecheck×2 + knip + lint）+ IPC 全量对账（117 handler / 58 renderer 发送 / 57 main 推送）+ muya 事件总线对齐（22 emit / 10 on）+ XSS/泄漏/execFile 专项 grep。
> 说明：原计划的 4 路 subagent 审计因 LLM 服务故障全部失败（含重派），本清单由主线接管完成。全部结论有文件:行号证据。

---

## 🔴 实锤 Bug（✅ 已全部修复，见各项状态）

### BUG-1 · `mt::window-initialized` 信号发往虚空（死信号）
- **位置**：`packages/desktop/src/renderer/src/store/editor.ts:1034`（发送方）
- **现象**：renderer 收到 `mt::bootstrap-editor` 回执后 send `mt::window-initialized`，但 **main 进程没有任何 `ipcMain.on('mt::window-initialized')`**。`git log -S` 证明 main 侧从未有过监听者。
- **影响**：如果原设计是 main 等这个信号做"窗口就绪"后续动作（如启动恢复、菜单启用），该逻辑从未生效；至少这是一段死代码 + 误导性 API 面。
- **修复方向**：二选一——删掉这行 send 和 `ipc.ts:238` 的通道类型声明；或补上 main 侧 handler 执行原本预期的就绪逻辑。
- **严重度**：低危（无运行时错误），但是重构期最典型的断链。
- **状态**：✅ 已修复（删 send + 删通道类型声明）

### BUG-2 · `optimizeDeps.include` 引用不存在的 `pako`（死配置）
- **位置**：`packages/desktop/electron.vite.config.ts:88`（`include: ['pako', 'pathe']`）
- **现象**：`pako` 不在 lockfile、不在任何 package.json、源码零 import。e2e 注释（plantuml.spec.ts:8）证实它已被新实现替代。
- **影响**：vite 预优化一个不存在的包——当前能容忍（启动不崩），但 pnpm/vite 版本升级后可能直接报错。
- **修复方向**：从 include 数组删掉 `'pako'`（`pathe` 有真实使用，保留）。
- **严重度**：低危。
- **状态**：✅ 已修复（include 仅剩 pathe）

### BUG-3 · sideBar 设置页语言轮询定时器永不清理
- **位置**：`packages/desktop/src/renderer/src/prefComponents/sideBar/config.ts:260`
- **现象**：`setInterval(..., 1000)` 每秒轮询 i18n 语言变化，作为"备份机制"，但返回的 timer 没有保存、没有对应 clearInterval（全文件 0 处）。该设置页每次挂载都会新增一个常驻 1Hz 定时器。
- **影响**：打开过设置页的会话里定时器持续累积（内存 + 无谓唤醒）；轮询回调里若 DOM 已卸载还有操作已销毁节点的风险。
- **修复方向**：保存 timer id 到模块级/组件级变量；在 `onUnmounted`（或重复初始化入口）里 clearInterval；或者更优——用 vue-i18n 的 `locale` watch 替代轮询。
- **严重度**：低危（资源泄漏，慢速累积）。
- **状态**：✅ 已修复（CachedTranslator.pollTimer 槽 + 重入清理）

## 🟡 工程噪音（✅ 已修复：eslint.config.js no-void allowAsStatement + vue 块关 core no-unused-vars）

### NOISE-1 · ESLint 2 个 error（会让 `pnpm lint` exit 1）
- **`no-void`** @ `windowManager.ts:487`：neostandard 预设开启了 core `no-void`，但主进程里有大量有意的 `void (async() => {...})()` fire-and-forget 写法。**已修**：`eslint.config.js` 加 `'no-void': ['error', { allowAsStatement: true }]`（本工作树已改，待提交）。
- **`no-unused-vars` 误报 `Tabs`** @ `editorWithTabs/index.vue:33`：`<script setup>` 导入的 `Tabs` 在 template 以 kebab 形式 `<tabs>` 使用——Vue 编译器认、core ESLint 规则不认（它只看 `<script>` 作用域）。**已修**：eslint.config.js 的 vue 文件块关闭 core `no-unused-vars`（vue/no-unused-components 负责真正的组件死码检测）。
- **验证**：两处修复后 `pnpm exec eslint <三个文件>` 0 error 0 新 warning。

## 🟢 确认无恙（排查过、没问题）

| 检查项 | 结论 |
| --- | --- |
| IPC 通道对齐（117 handler / 58 send / 57 push） | 除 BUG-1 外**全对齐**。B 组（main push 无 renderer 监听）0 断链；A 组另 2 个疑似（response-file-move-to / view-layout-changed）是多行 `ipcMain.on(` 写法，handler 都在（file.ts:643、menu/index.ts:497） |
| 通知 XSS 面 | `notification/index.ts:68` 用 `innerHTML` 渲染 payload，但 title/message 先经 **DOMPurify sanitize**（EXPORT_DOMPURIFY_CONFIG，禁 data-attr、URI 白名单），防护到位 |
| 主题 innerHTML 批量赋值 | 全部是**内置主题常量**（patchTheme(内置 css 字符串)），无外部输入 |
| execFile/spawn 参数源 | pandoc（utils/pandoc.ts）参数来自菜单白名单 `PANDOC_EXPORT_TYPES` + 本地文件路径；ripgrep spawn 的 rgPath 来自受控解析；uploader execFile 参数受控。无 renderer 可控字符串拼接进 shell |
| watcher 生命周期 | windowManager 的 watch/unwatch 配对完整（含 tree filter 重扫描路径 493-495 行） |
| renderer setInterval | 另一处（image uploader/index.vue:656）有对应清理逻辑，仅 BUG-3 一处泄漏 |
| muya eventCenter | 22 emit / 10 on：`muya-link-tools` 等 7 个 emit 无消费——但它们是**历史/可选 UI 工具通道**（link-tools、format-picker、table-picker 等在 Typora 化 UI 重构中移除了消费端），emit 端留着不影响运行；列为技术债而非 bug |
| 静态验证 | muya `tsc --noEmit` 0 错；desktop `vue-tsc` 0 错；knip 0 错；muya 1501 用例 + desktop 862 用例全绿 |
| 契约测试 | getStateContract C1–C6 齐全（工作计划里“C6 缺”的表述已过时）；lazyMarkdownPipeline 有专门 spec（lazy-markdown-pipeline.spec.ts + lazy-edit-tier.spec.ts） |

## 🟋 建议关注（非 bug，后续优化）

1. **muya 死事件通道**：`muya-format-picker`、`muya-footnote-tool`、`muya-table-picker`、`muya-float-button`、`muya-float`、`muya-front-menu`、`muya-table-bar` 七个 emit 无任何消费者——Typora 化 UI 移除了旧工具浮层。建议下个清理批次把 emit 点一起摘掉，减小 API 面。
2. **IPC 通道类型表**（`shared/types/ipc.ts`）与实际 handler 基本同步，但 `mt::window-initialized` 若按 BUG-1 删除需同步删类型声明。

---

## 修复优先级与建议顺序

1. **NOISE-1**（已完成，提交 `eslint.config.js` 即可让 CI Lint 恢复绿）
2. **BUG-3**（定时器泄漏——10 行改动）
3. **BUG-2**（删 `'pako'`——1 行改动）
4. **BUG-1**（window-initialized——先确认设计意图再删或补）
5. 🟋 死事件通道清理（独立批次）
