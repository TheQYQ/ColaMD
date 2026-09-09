# getState() 调用方审计（M1.1.1）

> 依据：`ColaMD_WORKPLAN.md` PR-2。本文档盘点 `JSONState.getState()`（全文档深拷贝）的全部生产调用方，逐点标注频率、变异行为与 live 共享安全性，作为 PR-3（getState 去克隆 + json-change 瘦身）的改造依据与回归网。
>
> 审计基线：`main` @ 601d5c3（2026-09-09）。行号以该提交为准。

## 0. 核心机制事实

| 事实                                                                          | 位置                                           | 证据                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| 全文档克隆唯一入口：`JSONState.getState()` 返回 `deepClone(this._state)`      | `state/index.ts:222-224`                       | `deepClone` = `structuredClone`（`utils/index.ts:142-144`）                    |
| 块级 `getState()`（Parent 及各块 override）不经 deepClone，是重新组装的小对象 | 例 `paragraph/index.ts:38-43`、`cell.ts:74-82` | `{ name: 'paragraph', text: ... }` / `children.map(child => child.getState())` |
| 击键入队 → rAF flush → emit `json-change`                                     | `state/index.ts:245-265, 267-298`              | `_emitStateChange` / `flush` / `_flushOperationCache`                          |
| `_apply` 用 `json1.type.apply` 生成新树，不原地改旧树                         | `state/index.ts:59-66`                         | `this._state = asState(json1.type.apply(asDoc(this._state), op))`              |

因此「全文档克隆次数」只由「谁调用了 `JSONState.getState()`（或委托它的 `Muya.getState()` / `getMarkdown()`）」决定；块级 getState 与全文档克隆是两个机制。

## 1. 每次击键热路径（每键必执行）

| #   | 调用点                       | 所在函数                                                          | 时机                                                                     | 变异返回值                                                       | live 共享初判                                                                                     |
| --- | ---------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `inlineRenderer/index.ts:78` | `InlineRenderer._collectReferenceDefinitions`                     | 每次 `patch()` 首行；击键路径每键至少 1 次                               | 否。`:81-96` 纯读遍历，结果进局部 Map，无返回值引用存留          | **安全**。纯只读、无引用存留、同一同步栈内无并发变异                                              |
| 2   | `state/index.ts:281`         | `JSONState._flushOperationCache` 的 `prevDoc`                     | 每次 flush（击键后 rAF，或 `Muya.flush()`）                              | 否。作为 payload `prevDoc` emit；唯一消费者 History 只读         | **安全**。prevDoc 在 `_apply` 前取得，此时 live 树即 prevDoc；`json1.type.apply` 生成新树不改旧树 |
| 3   | `state/index.ts:284`         | `JSONState._flushOperationCache` 的 `doc`                         | 每次 flush；`_apply` 之后                                                | **零消费**。源码自证冗余：`:283` `// TODO: remove doc in future` | **安全**（无任何运行时消费者）                                                                    |
| 4   | `state/index.ts:227`         | `JSONState.getMarkdown` → `getMarkdownFromState(this.getState())` | 每次 `Muya.getMarkdown()`；desktop json-change 回调每键 1 次（见 §2 #8） | 否。`StateToMarkdown.generate` 纯读序列化                        | 安全（若接受「从 live 树序列化」语义）                                                            |

**每键合计：4 次全文档 `structuredClone`**（#1 渲染阶段 + #2/#3 flush 内 + #4 flush 后回调），另有 desktop `editor.vue:1898` 的 120ms 防抖 `getState()` ≤1 次/窗口。

击键链证据：`content.ts:584-594 setCursor` → `:589 update({anchor, focus, block})` → 各内容块 `update` override → `inlineRenderer.patch` → 调用点 #1。patch 的生产调用方：`atxHeadingContent:30`、`paragraphContent:212`、`setextHeadingContent:27`、`tableCell:50`、`thematicBreakContent:27`。

## 2. 每次 flush / dispatch（json-change 同步回调链）

| #   | 调用点                 | 所在函数                                           | 时机                                                                                                | 变异                                                            | live 初判            |
| --- | ---------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------- |
| 5   | `state/index.ts:209`   | `JSONState.dispatch` 的 `prevDoc`                  | undo/redo / rebuild / 源码回切（`Editor.updateContents`、`rebuildContents`、`Muya.replaceContent`） | 否，History 只读                                                | 同 #2 机制           |
| 6   | `state/index.ts:212`   | `JSONState.dispatch` 的 `doc`                      | 同上                                                                                                | **零消费**（`:211` TODO）                                       | 同 #3                |
| 7   | `history/index.ts:163` | `History._change` 的 `asDoc(jsonState.getState())` | 每次 undo/redo（低频）                                                                              | 否。`invertWithDoc(op, doc)` 纯函数只读；入栈的是逆 op 不是 doc | **安全**             |
| 8   | `editor.vue:1912`      | desktop `json-change` 回调                         | 每次 flush 后同步执行                                                                               | **回调签名无参**，语法上不可能读 payload；内部仅走公共 API      | 不构成 live 共享障碍 |

desktop 回调内部的衍生克隆（与 payload 无关，但同属每键成本）：

| 调用                                | 位置            | 频率                        | 性质                                               |
| ----------------------------------- | --------------- | --------------------------- | -------------------------------------------------- |
| `editor.value.getMarkdown()`        | editor.vue:1918 | 每键 1 次                   | 调用点 #4，1 次全文档克隆                          |
| `editor.value.getHistory()`         | editor.vue:1924 | 每键 1 次                   | `deepClone(op.operation)` 克隆 **op 队列**，非文档 |
| `editor.value.getTOC()`             | editor.vue:1942 | 每键 1 次（120ms 防抖消费） | 遍历 **live 树**（`getTOC.ts:38`），**无克隆**     |
| `editor.value.getState()`（blocks） | editor.vue:1898 | ≤1 次/120ms 窗口            | 1 次全文档克隆，存入 `tab.blocks`                  |

## 3. 每次 getMarkdown（低频：手动导出 / 自动保存路径）

| #   | 调用点                                       | 时机                           | 变异         | live 初判 |
| --- | -------------------------------------------- | ------------------------------ | ------------ | --------- |
| 9   | `muya.ts:369` `Muya.setOptions(forceRender)` | 修改解析类选项（低频）         | 否           | 安全      |
| 10  | `editor.vue:1297`                            | 导出（pdf/print/styledHtml）   | 否（string） | 安全      |
| 11  | `editor.vue:1485`                            | 文件加载 `setMarkdownToEditor` | 否           | 安全      |
| 12  | `editor.vue:1613`                            | tab 切换                       | 否           | 安全      |
| 13  | `editor.vue:1817`                            | editor mount seed 合成历史     | 一次         | 安全      |

`getMarkdownFromState(state)` 本身不克隆，克隆发生在调用方。另两个生产调用方：`Muya.getCursorOffset`（`muya.ts:1180`，源码模式切换，低频，不变异）；`Muya._wrapSelectedBlocksInCodeBlock`（`muya.ts:874-876`，块级小对象，低频）。

## 4. 低频 UI / 用户操作路径（块级 getState，不在全文档克隆问题域）

全部为块级 `getState()`（重组装的小对象）或其上的冗余 `deepClone`，均只读或产新对象，不持有 live 树引用：

| 分组                    | 调用点（文件:行）                                                                                                  | 时机                                    | 备注                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------- |
| Muya 结构转换           | muya.ts:853-854/863/875/891/914/944/1289/1424/1439/1478-1483/1518/1540+1550/1624+1630                              | 用户段落操作                            | 部分外层 deepClone 为二次克隆（低频）                          |
| Parent 基类             | parent.ts:83（clone）；126/202（append/insertBefore user-source → operationCache）                                 | 结构编辑                                | 触发 flush（含 §1 #2/#3）                                      |
| 段落/列表转换           | paragraphContent:409/472/508/846；format.ts:930/975                                                                | enter/backspace 转换                    | 块级                                                           |
| 表格                    | table/index.ts:88/135/314+322-323；tableDragBar:443                                                                | 表格编辑/拖拽                           | 块级                                                           |
| 剪贴板                  | copyData.ts:130/168/265/272/294/325；paste.ts:99/309                                                               | 复制/剪切/粘贴                          | `copyData.ts:265` 展开覆盖是块级 state 可安全展开的直接证据    |
| UI 菜单                 | paragraphFrontMenu:200（后续 :218/:226/:244/:339 块级 deepClone）                                                  | 菜单点击                                | 块级                                                           |
| Editor 生命周期         | editor/index.ts:280（init）/422（失败恢复）/488（rebuildContents）/497（setContent）；muya.ts:377（\_forceRender） | init/恢复/undo-redo rebuild/加载/切 tab | **5 处全文档克隆返回值直接传 `ScrollPage.updateState`**，见 §5 |
| 占位实现（调用即 warn） | scrollPage:83-87；parent.ts:73-77；taskListCheckbox:253-255；headingCopyLink:120-122                               | —                                       | 误用即暴露                                                     |

## 5. ScrollPage.updateState 与 live 树（风险注记）

`updateState`（scrollPage/index.ts:96-105）先 `empty()` 再 `state.map(... loadBlock(block.name).create(muya, block))` 全量重建；块 constructor 直接持有传入 state 的子对象引用——证据：`codeBlock/index.ts:105`（`this.meta = meta`）、`cell.ts:66`（`this.meta = meta`）、`blockQuote/index.ts:35-42`（children 递归 create）。

即：块实例**长期持有 state 子对象引用**。editor/index.ts:280/422/488/497 与 muya.ts:377 这 5 处传入克隆是当前实现的安全前提。若未来改传 live 树，块实例将与 `jsonState._state` 共享对象图——op apply 虽生成新树不原地改，但块实例持有的 meta 引用会与后续 apply 结果脱钩。**PR-3 不得把 live 树直接塞给 `ScrollPage.updateState`**（与工作计划 §5 结论一致）。

## 6. 专项确认

### (a) json-change payload 的 `doc` 字段全仓零读取 — 成立

- emit 点 2 处：`state/index.ts:214-219`（dispatch）、`:292-297`（flush）。
- 生产 listener 全仓仅 2 个：
  1. `History._listen`（history/index.ts:126-153）：解构 `({ op, source, prevDoc })`；`doc` 仅有类型标注（:136），运行时零读取；`_record(op, prevDoc)` 也只收 op 与 prevDoc。
  2. desktop `editor.value.on('json-change', () => {...})`（editor.vue:1912）：无参回调。
- 疑似点逐一排除：`state/index.ts:212/:284` 的局部 `doc` 是 producer 非 consumer；`buildReplaceOp` 的 prevState/nextState 是函数返回值字段；desktop `FileChangePayload`、`criticalPayload`、`RipgrepPayloadEnvelope` 等同名 payload 属 bus/IPC/搜索域，与编辑器事件无关；测试 listener 均无参或不读 doc。
- 旁证：`// TODO: remove doc in future`（state/index.ts:211 与 :283）。
- 另：desktop 全 src 检索 `prevDoc` 命中 0 处。

### (b) History 只读 prevDoc — 成立

- 解构只取 `{ op, source, prevDoc }`（history/index.ts:128-137）。
- 消费：`_record` 内 `json1.type.invertWithDoc(op, asDoc(doc))`（:303）纯函数读 doc 计算逆 op；结果 undoOperation（op 非 doc）入栈（:322）；时间窗合并只 compose op（:313）。对 doc 零写入、零字段读取。
- `recordRebuild`（:339-356）同样仅 `invertWithDoc`（:343）只读。
- prevDoc 仅在单次 `_record` 同步栈内使用，无跨帧持有。

### (c) 单次 flush 的全文档 structuredClone 清单 — 每键 4 次

| #   | 位置                                             | 阶段             | 每键必发     |
| --- | ------------------------------------------------ | ---------------- | ------------ |
| 1   | inlineRenderer/index.ts:78                       | flush 前（渲染） | 是           |
| 2   | state/index.ts:281（flush prevDoc，`_apply` 前） | flush 内         | 是           |
| 3   | state/index.ts:284（flush doc，`_apply` 后）     | flush 内         | 是（零消费） |
| 4   | state/index.ts:227（getMarkdown，desktop 回调）  | flush 后         | 是           |
| 5   | editor.vue:1898（blocks）                        | 120ms 防抖       | ≤1 次/窗口   |

dispatch 路径（state/index.ts:209/212）另有 2 次，但属 undo/redo/rebuild 低频路径，不在击键 rAF flush 内。

## 7. PR-3 事实切口（只列事实）

- `doc` 槽零消费 → 删除即省 1 次克隆（#3）。
- inlineRenderer 纯只读 → 改读 live 树即省 1 次（#1）。
- desktop getMarkdown 若改从 live 树序列化再省 1 次（#4；`StateToMarkdown.generate` 纯读）。
- `Muya#getState` 公开 API（muya.ts:231-233）唯一生产消费点是防抖 blocks（120ms 窗口），维持克隆语义即可。
- 以上三项全部落地后：每键 4 → 1。`getStateClone()` 命名保留，可快速加回 clone（计划 §PR-3 风险回滚）。

## 8. 契约测试

`src/state/__tests__/getStateContract.spec.ts`（随本 PR 提交）钉死以下前提，PR-3 改造时必须保持全绿：

- C1：外部变异 `getState()` 返回值不影响引擎状态（公开 API 保持克隆语义）。
- C2：listener 内 `prevDoc` 反映 apply 前内容。
- C3：从 `getState()` 克隆重建的块与后续外部变异隔离。
- C4：`getMarkdown()` 快照不受后续 live 树编辑影响。
- C5：两次 `getState()` 返回相互独立的深拷贝。

## 9. 生产代码调用点完整清单（供 PR-3 逐点核对）

全文档克隆点：state/index.ts:131（buildReplaceOp prevState，replaceContent 低频）、209/212（dispatch）、227（getMarkdown）、281/284（flush）；editor/index.ts:280/422/488/497；muya.ts:232（公开 API）/377（\_forceRender）/1180（getCursorOffset）；history/index.ts:163；inlineRenderer/index.ts:78；desktop editor.vue:1898。

块级调用点：muya.ts:853/854/863/875/1289/1424/1439/1478/1518/1540/1624；parent.ts:83/126/202；format.ts:930/975；paragraphContent:409/472/508/846；table:88/135/314+322-323；copyData.ts:130/168/265/272/294/325；paste.ts:99/309；paragraphFrontMenu:200；tableDragBar:443。

`getState` 定义点：state/index.ts:222（全文档克隆唯一入口）；muya.ts:231（委托）；parent.ts:73（warn 占位）及各块 override；warn 占位：scrollPage:83、taskListCheckbox:253、headingCopyLink:120。

---

_本文档由 M1.1.1 只读审计产出（2026-09-09），行号基于 601d5c3。PR-3 动手前如代码已前移，以本文档结构为索引重新核对行号。_
