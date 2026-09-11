# `tab.markdown` 读取方审计（M1.2b 前置）

> 目的：M1.2b 把每击键的 `getMarkdownLive()` 全文序列化（1MB ≈ 59ms）改为"脏标记 + flush-on-read"。
> 前提是**每一个**读取 `tab.markdown` / 活动引擎 markdown 的路径在读取前保证内容是最新的。
> 漏挂一个 flush 钩子 = 存盘丢数据。本文档是 M1.2b 实施时的核对清单。
>
> 引擎事实（`packages/muya/src/state/index.ts`）：操作经 `requestAnimationFrame` 延迟 apply，
> 任何 `getMarkdown()` / `getMarkdownLive()` / `getState()` 都只反映**已 flush** 的状态，
> 未 flush 的 pending op 不在序列化结果里。因此"读最新内容"的统一原语是：
> **`bus.emit('flush-active-editor')`（即 `editor.flush()`）→ 立即 `getMarkdownLive()`**。
> store 已有 `flushActiveEditor()` action（#3803 引入），保存流已在用。

## 1. 写路径（`tab.markdown` 的唯一写入点）

- `LISTEN_FOR_CONTENT_CHANGE`（`store/editor.ts` ~L1491）：`tab.markdown = markdown`。
  critical 层载荷来自 editor.vue `json-change` 回调的 `getMarkdownLive()`（M1.2b 要去掉的就是这一步），
  派生层（`markdown: null`）不写 markdown。
- 载入/切 tab：`file-changed` → editor.vue `setContent` 路径写入新文档基线。

## 2. 读路径逐个核对（M1.2b 必须逐一覆盖）

| # | 位置 | 用途 | 当前是否先 flush | M1.2b 处理 |
|---|---|---|---|---|
| R1 | `FILE_SAVE`（~L555） | 手动保存 | ✅ `flushActiveEditor()` | 无需改 |
| R2 | `FILE_SAVE_AS`（~L584） | 另存为 | ✅ | 无需改 |
| R3 | `MOVE_FILE_TO`（~L769） | 移动到新文件夹（新文件首存） | ✅ | 无需改 |
| R4 | `RESPONSE_FOR_RENAME`（~L812） | 未命名文件改名前保存 | ✅ | 无需改 |
| R5 | `ASK_FOR_SAVE_ALL`（~L730） | 全部保存/关闭：`isSaved && markdown 非空` 过滤 + 组装保存载荷 | ❌ **无 flush** | 开头补一次 `flushActiveEditor()`（只有活动 tab 会 stale） |
| R6 | `HANDLE_AUTO_SAVE` 定时器回调（~L1546） | 自动保存写盘 | ⚠️ markdown 是**排定时器时**捕获的实参 | 定时器回调改为：若 id = 活动 tab → flush 后重读 `tab.markdown`；否则用捕获值 |
| R7 | 外部文件变更比对（~L1755） | `newMarkdown === tab.markdown` 判"内容无变化"（#1861） | ❌ 活动 tab 可能 stale → 误报变更弹窗 | 比对前：活动 tab flush 后重读；非活动 tab markdown 本就是静态的，可直接比 |
| R8 | 崩溃缓冲 `createBufferedTabState`（~L2153，`sendBufferedState`） | 崩溃恢复缓冲写 localStorage | ❌ 任意触发点（通知/内容变更等）都序列化全部 tabs | 活动 tab 若脏：flush 后重读再入缓冲；或在 send 前统一 flush 一次 |
| R9 | `SAVE_VERSION_SNAPSHOT`（~L1864，有 `markdownOverride`） | 版本快照（Manual/Auto/Session End/Pre-restore） | 调用方各异 | 逐调用方核：Manual ✅（跟 R1/R2）；Auto 跟 R6；**`FORCE_CLOSE_TAB` 的 'Session End'（~L1057）无 flush**；Pre-restore 用传入 markdown ✅ |
| R10 | `FORCE_CLOSE_TAB` / `CLOSE_TABS` 后切换到邻 tab 的 `file-changed`（~L1066/L1156） | 用 `fileState.markdown` 恢复邻 tab | 邻 tab 是非活动 tab，markdown 静态 | 无需改；但**切走的活动 tab 本身**在 `setContent` 前已由引擎 `flush()` 兜底（#2938，`state/index.ts` flush 注释），路径成立 |
| R11 | 导出（editor.vue ~L1297 `getMarkdown()`；~L1345 pdf/print） | 导出全文 | ❌ 未 flush（现状已有小概率丢最后一击键） | 导出前 `flushActiveEditor()`（顺手修掉既有隐患） |
| R12 | 源码模式切换（editor.vue watch sourceCode ~L800） | 取 `getCursorOffset()` | ⚠️ 仅取光标不取内容；但源码模式挂载后读的 markdown 来自 tab | 切换前补 flush（与 R10 同一兜底，核对后可能无需新增） |
| R13 | `getOptionsFromState` 一带（R8 构造） | 崩溃缓冲/自动保存选项 | — | 只读 options，不读 markdown；随 R8 覆盖 |
| R14 | 非活动 tab 的 `tab.markdown` 所有读取 | — | — | 非活动 tab 无活引擎，markdown 天然静态，**任何 flush-on-read 方案不得触碰** |

## 3. dirty 语义（Phase G — G6，不可退化）

- 现状：每击键 `makeSyntheticHistory(id, markdown)` 对全文做 FNV-1a 64bit hash
  （`syntheticHistory.ts`，1MB ≈ 数 ms，次要成本），以"内容 → 单调 id"保证
  `干净 ⟺ 内容 == 已保存内容`，undo 回到已保存内容必须判干净。
- 可行折中（WORKPLAN §6 既定）：
  - **确定态**：正常新编辑（非 undo/redo）→ 直接 `isSaved = false`，不序列化、不 hash；
  - **不确定态**：仅 undo/redo 后才惰性序列化 + hash（此时必须知道"内容是否回到已保存版本"）。
  - 引擎 `json-change` 需要暴露"本次变更是否来自 undo/redo"（`source`/op 路径已有信息，核对 muya 侧 emit）。
- 保存时更新 `lastSavedHistoryId` 的逻辑要与新 id 分配时机对齐：保存发生在 flush-on-read 之后，
  此时内容已序列化，可顺路给该内容分配/记录 synthetic id，与现语义等价。

## 4. 实施切分建议（每步可独立验证）

1. **PR-a（本审计）**：文档入库。
2. **PR-b 补漏**：R5 / R6 / R7 / R8 / R9(FORCE_CLOSE_TAB) / R11 先补 flush —— 这是**现状就缺**的防御，
   与懒序列化解耦，先行落地可独立回归（不改变每击键行为）。
3. **PR-c 懒序列化**：json-change 去掉 `getMarkdownLive()`，脏标记 + undo/redo 惰性 hash，
   `flush-on-read` 桥（store 侧 `ensureFreshMarkdown(id)`：flush → 序列化 → 走既有
   `LISTEN_FOR_CONTENT_CHANGE` critical 路径更新 tab + synthetic history）。
   bench 目标：1MB 击键管线从 2.7ms 进一步趋近于纯 op 成本；回归网：`getStateContract`、
   `flushPendingOps`、PG15 脏净 e2e、804 desktop 单测。
