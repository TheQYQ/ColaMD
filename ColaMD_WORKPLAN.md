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

## 2. Typora 对标结论（摘要）

### 已具备（相对 MarkText）

- PDF 书签目录
- 专注 / 打字机模式
- 完整中文本地化
- 图片复制到 `./assets`
- Mermaid / Vega / PlantUML / Flowchart 等图表
- 标题字号阶梯清晰

### 主要差距（按优先级）

| 优先级 | 项                     | 现状                                                         |
| ------ | ---------------------- | ------------------------------------------------------------ |
| P0     | 大文件性能             | 每击键全文序列化 + `getState` 深拷贝；1MB 输入延迟目标未达成 |
| P1     | Word (.docx) 导出      | 仅 HTML + PDF；roadmap M4                                    |
| P2     | 删除图片时清理磁盘文件 | 无引用检查 / unlink                                          |
| P3     | 常驻格式工具栏         | 仅有选中浮动条                                               |
| P3     | 大纲拖拽重排           | TOC 只读                                                     |
| 暂缓   | MathJax                | 现用 KaTeX；换引擎与性能目标冲突                             |

---

## 3. 总路线（三梯队）

### 第一梯队：性能专项 M1

| 编号 | 任务                                                 | 状态                                                                                 |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| M1.0 | 击键延迟基线（fixture + microbench + baseline 文档） | ✅ 已合并（PR-1 #1, a79ff86）                                                        |
| M1.1 | 消灭热路径 `getState()` 全文深拷贝                   | ✅ 已合并（审计 PR #2 + PR-3 #3, 90eb73a；每键 4→0 次克隆，edit+flush 1MB p50 −14%） |
| M1.2 | 击键路径去全文序列化（脏标记改 op 级）               | ✅ 已合并（PR-4 #19, 8a471b1；flush prevDoc 克隆清零 + getTOC/wordCount 移入防抖；edit+flush 1MB p50 50.8→2.7ms、p95 56.4→4.7ms；**验收线达成**） |
| M1.3 | 大文档渲染分片 / 懒渲染                              | 📋                                                                                   |
| M1.4 | 会话持久化减负（buffer store）                       | 📋                                                                                   |

**总验收**：1MB 文档击键派生管线 P95 < 16ms —— ✅ **edit+flush 档已达成**（P95 4.7ms，PR #19，余量 3.4×）；现有单测全绿（muya 1468 + desktop 804）；Phase G / PG15 脏净语义未回归（契约测试 C1–C6 锁定）。剩余差距在 M1.2b（每击键 getMarkdown 序列化 + 全文 hash，见 §6）与 M1.3（setContent 1MB ≈ 8.5s）。

### 第二梯队：DOCX 导出 M4

| 编号 | 任务                           | 状态 |
| ---- | ------------------------------ | ---- |
| M4.1 | 菜单 / IPC / `ExportType` 接线 | 📋   |
| M4.2 | HTML → DOCX 转换实现           | 📋   |
| M4.3 | 样式、locale、测试             | 📋   |

### 第三梯队：图片引用清理

| 编号  | 任务                                  | 状态 |
| ----- | ------------------------------------- | ---- |
| IMG.1 | 引擎 `deleteImage` 发 `image-deleted` | 📋   |
| IMG.2 | 桌面：无引用才删 + 路径域 + 偏好      | 📋   |
| IMG.3 | 单测 / e2e                            | 📋   |

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
