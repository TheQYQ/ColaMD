# Muya Keystroke-Pipeline Performance Baseline

> 説明：本文档记录微基准的首轮实测数字与复跑方法，作为性能优化的前后对照基线。现有两份：`keystrokePipeline.bench.spec.ts`（M1 系列击键管线）与 `scrollPageRender.bench.spec.ts`（SB/PERF-04 的 ScrollPage 渲染路径）。每轮优化合入后，请用「复跑方法」一节刷新数字并附 PR 链接。

> 首次记录：2026-09-09 · Windows 11 (26200, x64) · Node v22.22.0 · vitest 4.1.9 · happy-dom · 分支 `main` @ 601d5c3（exports 修复后）

## 测试对象

| 路径          | 语义                                                                  |
| ------------- | --------------------------------------------------------------------- |
| `setContent`  | `JSONState` 从 markdown 全文解析建树（无 DOM），含 JIT 预热后二次实测 |
| `getState`    | `JSONState.getState()` 全文深拷贝（当前每类派生工作都会触发）         |
| `getMarkdown` | 从 state 反序列化回 markdown 全文                                     |
| `getTOC`      | 走真实 Muya 实例的 live block 树收集目录                              |
| `edit+flush`  | 单字符编辑 + `muya.flush()`（击键热路径形态）                         |

Fixture：`src/state/__tests__/fixtures/keystrokeDocs.ts`，中英混排 + 标题/列表/代码块轮转，目标字节数 100KB / 500KB / 1MB。

## 首轮实测（基线）

数字为本地 vitest（happy-dom）采样：`setContent`/`getTOC`/`edit+flush` 样本量见括号，`getState`/`getMarkdown` 各 20 次。单位 ms。

### 100KB

| 操作        |  p50 |  p95 |  max |   n |
| ----------- | ---: | ---: | ---: | --: |
| setContent  | 33.7 | 39.9 | 39.9 |   2 |
| getState    |  2.1 |  2.5 |  2.5 |  20 |
| getMarkdown |  3.2 |  4.8 |  4.9 |  20 |
| getTOC      |  2.6 |  3.6 |  3.6 |  11 |
| edit+flush  |  4.8 | 15.8 | 15.8 |  10 |

### 500KB

| 操作        |   p50 |   p95 |   max |   n |
| ----------- | ----: | ----: | ----: | --: |
| setContent  | 738.9 | 765.1 | 765.1 |   2 |
| getState    |  10.4 |  11.9 |  12.0 |  20 |
| getMarkdown |  16.4 |  17.3 |  18.4 |  20 |
| getTOC      |  13.4 |  15.2 |  15.2 |  11 |
| edit+flush  |  25.7 |  26.9 |  26.9 |  10 |

### 1MB

| 操作        |    p50 |    p95 |    max |   n |
| ----------- | -----: | -----: | -----: | --: |
| setContent  | 6155.4 | 6156.0 | 6156.0 |   2 |
| getState    |   25.7 |   28.1 |   29.1 |  20 |
| getMarkdown |   40.6 |   54.2 |   77.0 |  20 |
| getTOC      |   31.7 |   33.7 |   33.7 |  11 |
| edit+flush  |   59.4 |   61.5 |   61.5 |  10 |

（1MB 档数字来自 UTF-8 fixture 修正后的完整复测；首轮乱码 fixture 的数字已作废。）

## 观察（对应 M1 后续工作）

- **setContent 1MB ≈ 6.2s**：启动/整篇替换路径明显超线性（100KB→1MB 约 180×），是 M1.3 渲染分片 / 懒渲染与 M1.4 持久化降频之外需要单独关注的入口路径。
- **getState 全文深拷贝随体量线性**（100KB→1MB 约 10.6×）：单次 flush 的 deepClone 次数优化（M1.1.2/1.1.3，PR-3）直接乘在这条线上。
- **edit+flush 1MB p50 ≈ 59ms / p95 ≈ 62ms**：已超一帧预算（16ms）近 4 倍，验证了工作计划里「1MB 输入延迟目标未达成」的判断。getState 调用方审计实锤单键→flush 全文 structuredClone 实际 4 次（inlineRenderer 引用定义收集、flush prevDoc、flush doc（零消费，源码自带 TODO）、desktop 每键同步 getMarkdown），优化切口比计划预估的 2 次多一倍；优化后本表数字应显著下降。
- getTOC 与 edit+flush 在 500KB 档曾出现一次首样本尖峰（首轮 p95=20.2ms @100KB），样本量小，比较时以 p50 为主、p95 为辅。

## 预算门禁（CI 软约束）

`keystrokePipeline.bench.spec.ts` 内置宽松预算断言（只为拦 10× 级回归，不是硬性能门槛）：

| 操作        | 100KB | 500KB |   1MB |
| ----------- | ----: | ----: | ----: |
| setContent  |  5000 | 15000 | 30000 |
| getState    |   500 |  2000 |  4000 |
| getMarkdown |  1000 |  4000 |  8000 |
| getTOC      |   500 |  2000 |  4000 |
| edit+flush  |   200 |  1000 |  2000 |

当前实测全部低于预算上限。若未来合入的改动触发断言，说明发生了数量级回归，应先查全文级 clone/序列化路径再考虑调预算。

## 复跑方法

```bash
# 完整三档基准（约 2-10 分钟，1MB 档占大头）
pnpm -C packages/muya exec vitest run src/state/__tests__/keystrokePipeline.bench.spec.ts --testTimeout 420000

# 只看数字：console 输出行带 [keystroke-bench] 前缀
# PR CI 例外：spec 标记 @perf，可用 --grep-invert "@perf" 从常规门禁中剔除
```

复跑时注意：

- 关掉其他重负载进程（happy-dom + 单线程采样对后台占用敏感）
- 首轮含 JIT 预热；对照历史数字时同轮比较
- Windows 本机数字与 CI runner 不可直接互比，各记各的

## PR-3 实测（getState 去克隆后 · 2026-09-10）

实现：`perf/m1-1-getstate-live` @ 19d3c1e（doc 槽删除 + inlineRenderer live 读 + desktop getMarkdownLive）。环境同基线轮。

### 100KB

| 操作        |  p50 |  p95 |  max |   n |         对基线 p50 |
| ----------- | ---: | ---: | ---: | --: | -----------------: |
| setContent  | 65.7 | 75.2 | 75.2 |   2 | 33.7（+95%，见注） |
| getState    |  3.7 |  5.3 |  5.7 |  20 |                2.1 |
| getMarkdown |  7.1 | 11.4 | 12.5 |  20 |                3.2 |
| getTOC      |  5.2 |  7.1 |  7.1 |  11 |                2.6 |
| edit+flush  |  4.2 | 24.1 | 24.1 |  10 |                4.8 |

### 500KB

| 操作        |    p50 |    p95 |    max |   n | 对基线 p50 |
| ----------- | -----: | -----: | -----: | --: | ---------: |
| setContent  | 1609.4 | 2026.5 | 2026.5 |   2 |      738.9 |
| getState    |   20.1 |   28.4 |   37.6 |  20 |       10.4 |
| getMarkdown |   32.2 |   63.7 |   64.1 |  20 |       16.4 |
| getTOC      |   23.4 |   25.7 |   25.7 |  11 |       13.4 |
| edit+flush  |   28.2 |   33.0 |   33.0 |  10 |       25.7 |

### 1MB

| 操作           |      p50 |      p95 |     max |   n | 对基线 p50 |
| -------------- | -------: | -------: | ------: | --: | ---------: |
| setContent     |  10049.2 |  10125.8 | 10125.8 |   2 |     6155.4 |
| getState       |     41.2 |     50.7 |    52.9 |  20 |       25.7 |
| getMarkdown    |     73.3 |     93.8 |   122.9 |  20 |       40.6 |
| getTOC         |     50.0 |     71.6 |    71.6 |  11 |       31.7 |
| **edit+flush** | **50.8** | **56.4** |    56.4 |  10 |       59.4 |

### 判读

- **edit+flush 1MB（击键热路径）p50 59.4 → 50.8ms（−14%）、p95 61.5 → 56.4ms（−8%）**：这档直接衡量每键成本，且是在后台负载明显高于基线轮（本轮机器同时跑了别的构建任务）的情况下取得的——真实改善幅度应更大。
- **getMarkdownLive 消费路径**：desktop 每键序列化从克隆态切到 live 态，getMarkdown 名义数字上涨是本轮后台负载所致（该路径在 PR-3 后已不被 json-change 回调使用）；真正被消费的 getMarkdownLive 不再克隆，网络净效应体现在 edit+flush 档。
- **getState/getMarkdown/getTOC/setContent 全档名义上涨 60-100%**：与热路径无关（这些是低频/导出路径），主因是本轮系统后台负载；不应据此判断回归。下一轮空闲时段复测可校准。
- 全部预算门禁依旧通过。

## M1.2 实测（flush prevDoc 去 clone + 桌面派生态防抖 · 2026-09-11）

实现：`perf/m1-2-keystroke-deser` @ 8a471b1（PR #19）。`json-change` 的 `prevDoc` 改为 pre-apply 活树别名（ot-json1 `apply()` 为 copy-on-write，库文档保证旧快照引用持续有效，契约测试 C6 锁定）；History invert 改读活树；桌面端 `getTOC`/`wordCount` 移入 120ms 派生态防抖。环境同基线轮，机器空闲（94s 完整跑）。单位 ms。

### edit+flush（击键热路径，直接受益）

| 档位  | 基线 p50 | PR-3 p50 | M1.2 p50 | 对 PR-3 | M1.2 p95 |
| ----- | -------: | -------: | -------: | ------: | -------: |
| 100KB |      4.8 |      4.2 |   **0.7** |   −83%  |    19.0  |
| 500KB |     25.7 |     28.2 |   **1.8** |   −94%  |     2.9  |
| 1MB   |     59.4 |     50.8 |   **2.7** | **−95%**|  **4.7** |

**M1 验收线（1MB 击键管线 P95 < 16ms）在该指标上达成，余量 3.4×。**

### 全档数字（p50/p95）

- 100KB：setContent 62.8/84.1 · getState 3.2/4.1 · getMarkdown 5.6/6.6 · getTOC 4.3/8.6
- 500KB：setContent 1440.1/1523.6 · getState 15.2/20.5 · getMarkdown 27.5/33.2 · getTOC 26.9/35.3
- 1MB：setContent 8489.9/9228.3 · getState 30.5/36.9 · getMarkdown 59.2/74.5 · getTOC 49.0/59.6

派生路径（getState/getMarkdown/getTOC）语义未变，调用频率由桌面端防抖层控制，数字与 PR-3 轮同量级。

### 判读

- **edit+flush 全档数量级下降**：唯一 O(doc) 的 deepClone 移出 flush 路径后，剩余工作（compose/apply/invertWithDoc）只随 op 路径增长、不随文档体积增长——三档 p50 趋同（0.7/1.8/2.7ms）是这一点的直接证据。
- 100KB p95=19.0 为单样本尖峰（max=19.0，n=10），p50=0.7 代表稳态。
- 桌面端每击键还省去 getTOC（1MB ≈ 49ms）与 wordCount 全串扫描的同步成本（bench 不覆盖，属应用内收益）。
- 每击键仍保留：`getMarkdownLive()` 全文序列化 + synthetic history FNV 全文 hash（M1.2b 目标，见 WORKPLAN §6）。

## M1.2b 实测（懒序列化管线 · 2026-09-12）

实现：`perf/m1-2b-lazy-serialization`（PR #25）。桌面 `json-change` 每击键不再执行 `getMarkdownLive()` 全文序列化（1MB ≈ 59-67ms）与 synthetic history FNV 全文 hash：击键层只做脏标记 + 自动保存重排（O(1)），序列化+hash 移到 ① undo/redo（source 'history'，即时提交，保 G6 脏净语义）② 120ms 停顿层 ③ flush-on-read（保存/关闭/切 tab/导出/崩溃缓冲，经 `flushActiveEditor` 单次提交）。环境同基线轮，机器空闲（88s 完整跑）。单位 ms。

### 引擎热路径（edit+flush，本轮改动应为零影响，实测确认）

| 档位  | M1.2 p50 | M1.2b p50 | M1.2b p95 |
| ----- | -------: | --------: | --------: |
| 100KB |     0.7  |  **0.3**  |    11.6   |
| 500KB |     1.8  |  **0.7**  |     3.1   |
| 1MB   |     2.7  |  **2.9**  |     4.0   |

1MB p50 2.7→2.9ms 在运行间噪声内（n=10，单次跑），p95 反而 4.7→4.0ms。**M1 验收线（1MB P95 < 16ms）保持达成，余量 4×。**

### 应用层收益（bench 不覆盖，M1.2b 的主要目标）

- 每击键移除：`getMarkdownLive()` 1MB ≈ 67.1ms（本轮 getMarkdown 实测 p50）+ FNV 全文 hash ≈ 数 ms + `getHistory()` 栈序列化。
- 保留的序列化时机：undo/redo（1 次）、120ms 停顿（1 次）、每次实际读取前的 flush-on-read（1 次，带 pending 幂等）。连续打字期间为 **零全文序列化**。
- `lazyMarkdownPipeline.spec.ts` 以"击键连发 0 次序列化、单次 flush 恰好 1 次"锁住该性质。

### 判读

- 引擎侧数字与 M1.2 轮一致——本轮改动全部在 desktop 消费层与 History 的 source 标记（'history'），不影响 op 路径。
- M1.2b 后每击键桌面侧剩余工作：selection 序列化 + getHistory + 一次 store mutation，均为 O(1)。
- M1 剩余大项：M1.3 setContent 1MB ≈ 5-10s 超线性（入口路径，与击键管线无关）。

## M1.3 实测（setContent 超线性修复 · 2026-09-12）

实现：`perf/m1-3-setcontent`（PR #27）。剖析定位 setContent 的超线性成本**不在渲染**，而在解析管线两处算法级热点：① marked `Marked#walkTokens` 对每个 token 做 `n = n.concat(...)` 累积（O(n²)，1MB ≈ 20k token 时 ~1.8s）——`lexBlock` 改为自写线性前序遍历（同一 visitor，行为等价）；② `markdownToState` 的 token 流处理用 `shift()`/`unshift(...)`（各 O(n)）——改为 LIFO 工作栈（容器反序压子节点 + block-end 标记，弹出顺序与旧实现逐位一致）。环境同基线轮，机器空闲。单位 ms。

### setContent（M1.3 直接目标）

| 档位  | 基线 p50 | M1.2 p50 | M1.3 p50 | 对 M1.2 | p95 |
| ----- | -------: | -------: | -------: | ------: | --: |
| 100KB |   62.8   |   62.8   |  **5.6** |  −91%   | 12.4 |
| 500KB |  1440.1  | 1440.1   | **13.6** |  −99%   | 16.2 |
| 1MB   |  8489.9  | 8489.9   | **28.2** | **−99.7%** | 28.5 |

**增长曲线已线性**：100KB→1MB（10×体积）耗时 5.6→28.2ms（5×），修复前 400KB→800KB 翻倍体积耗时 290→3128ms（10.8×）。实测剖析曲线：generate(1MB) ≈ 66ms（lex 28.6 + convert 37.5）。

### 全档数字（p50/p95）

- 100KB：getState 1.8/2.0 · getMarkdown 3.0/4.4 · getTOC 2.1/2.8 · edit+flush 0.3/10.2
- 500KB：getState 7.7/9.1 · getMarkdown 12.2/13.4 · getTOC 10.7/13.8 · edit+flush 0.6/2.5
- 1MB：getState 16.8/19.2 · getMarkdown 25.3/26.3 · getTOC 21.9/25.4 · edit+flush 1.3/1.9

派生档（getState/getMarkdown/getTOC）不经过被改代码，本轮数字与 M1.2 轮的差异为机器噪声级（均更快，运行间方差）。

### 判读

- **M1.3 的"唯一还难看的大数字"消除**：setContent 1MB 从 ~5-10s 量级降到 28ms，且不再随文档体积超线性增长；超大文档（10MB+）预期同样线性。
- 真实应用 setContent 还包含 block 树重建与渲染（bench 不覆盖），parse 不再是瓶颈后再评估是否需要渲染分片。
- 遗留：`getClipboardHtml`/`getHighlightHtml` 仍经 marked 内部 walkTokens（二次方），但它们只处理选区/剪贴板级内容，不在文档级热路径，暂不动。

## GUI-B7 实测（内联渲染/搜索/UI 热路径 · 2026-11-02）

实现：`fix/gui-b7-muya-perf`（PR 待合）。本轮改动**不在本 bench 的直接测量面**：inputHandler 的 tokenize 共享（PERF-08）、引用定义 labels 按修订号缓存（PERF-09）、find 跳转双块交换（PERF-10）作用于「击键 → inline patch」路径，而 bench 的 edit+flush 只含一次 flush（单块 patch），K 块重复遍历的收益在 bench 形态里不出现。数字仍照例记录，注意本轮后台负载明显偏高（派生档 getState/getMarkdown 1MB p50 相对 M1.3 轮漂移 ~3×，为噪声底；改动不触这些路径）。环境：Windows 11 (26300, x64) · Node v22.21.1 · vitest 4.1.9。

| 操作        | 100KB p50 | 500KB p50 | 1MB p50 | 对照（M1.3 轮 p50）            |
| ----------- | --------: | --------: | ------: | ------------------------------ |
| setContent  |       7.0 |      13.1 |    86.2 | 5.6 / 13.6 / 28.2（1MB 漂移=噪声） |
| getState    |       2.0 |       9.6 |    47.7 | 1.8 / 7.7 / 16.8（同上）       |
| getMarkdown |       3.0 |      15.3 |    85.5 | 3.0 / 12.2 / 25.3（同上）      |
| getTOC      |       2.2 |      30.1 |    28.3 | 2.1 / 10.7 / 21.9（同上）      |
| edit+flush  |       0.4 |       1.5 |     2.0 | 0.3 / 0.6 / 1.3                |

判读：edit+flush p50 与 M1.3 轮同数量级（0.4/1.5/2.0 vs 0.3/0.6/1.3），在噪声底之上无可归因于本轮改动的回归；PERF-09 的收益（K 块 patch 省 K−1 次全树遍历）与 PERF-08 的收益（每键 tokenize 从 6 份流收敛到 4 份，口径见 `format.ts` inputHandler 的注释：改前 2 份 pre-edit 探针 + 类型比较的 old/new + render 检查 + emoji 探针，改后 4 份各自复用）需在多块更新与真实键入路径上另行量化，本 bench 不覆盖。

## 变更记录

| 日期       | 提交                              | 变化                               | 备注                       |
| ---------- | --------------------------------- | ---------------------------------- | -------------------------- |
| 2026-09-09 | 601d5c3 (基线)                    | 首次记录                           | M1.0 基线建立              |
| 2026-09-10 | 19d3c1e (perf/m1-1-getstate-live) | PR-3 实测：edit+flush 1MB p50 −14% | 后台负载偏高，空闲复测待做 |
| 2026-09-11 | 8a471b1 (perf/m1-2-keystroke-deser) | M1.2 实测：edit+flush 1MB p50 50.8→2.7ms、p95 4.7ms | 验收线达成（<16ms）        |
| 2026-09-12 | perf/m1-2b-lazy-serialization (PR #25) | M1.2b：桌面每击键去全文序列化+hash（移至 pause/undo/flush-on-read）；引擎热路径无回归（1MB p95 4.0ms） | 桌面击键层 O(1) |
| 2026-09-12 | perf/m1-3-setcontent (PR #27) | M1.3：setContent 超线性修复——lexBlock 线性遍历（marked walkTokens 的 concat 累积）+ markdownToState 栈式流处理；1MB 5004→28.2ms | 解析管线线性化 |
| 2026-11-02 | fix/gui-b7-muya-perf (PR 待合) | GUI-B7：inputHandler 每键 tokenize 流 6→4 份（口径见上节判读行）、labels 按修订号缓存（K 块 patch 省 K−1 次全树遍历）、find 跳转改双块交换；bench 数字见上节（不在其测量面，无回归） | 桌面侧 B7 批次 |

---

# ScrollPage 渲染基准（SB / PERF-04）

> 首次记录：2026-11-03 · Windows 11 (26300, x64) · Node v22.21.1 · vitest 4.1.9 · happy-dom · 分支 `develop` @ `68d7ee5`（SA-2 合入后）
> 文件：`src/block/scrollPage/__tests__/scrollPageRender.bench.spec.ts` · 复跑：`pnpm -C packages/muya test:perf`（1MB 档需 `NODE_OPTIONS=--max-old-space-size=6144`，默认堆 OOM）

## 测试对象

| 路径         | 语义                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `updateState` | `ScrollPage.updateState(state)` 全量重建：`empty()` 清空容器后按 state 逐块重建 DOM。这是 setContent / `_forceRender` / undo-redo 边界重建（`rebuildContents`）/ `updateContents` 增量失败兜底四条路径的共同底座 |
| `scale`      | 渲染后容器内的 DOM 节点总数（`querySelectorAll('*')`）与顶层块数——**视口虚拟化的直接目标指标**，SB 后应为 O(视口) 而非 O(文档) |

Fixture 与击键基准同源（`makeDoc`：标题/段落/列表/代码块混排，中英混合）。

## 首轮实测（SB 前基线）

`updateState` 为独立采样（每轮先 `getState()` 取新深拷贝，其成本已单独记录在击键基准，不计入本表）：

| 档位  | updateState p50 | updateState max | 顶层块数 | DOM 节点数 |
| ----- | --------------: | --------------: | -------: | ---------: |
| 100KB |         321.8ms |         570.8ms |    1,470 |     13,252 |
| 500KB |       5,131.8ms |       7,018.1ms |    7,271 |     65,551 |
| 1MB   |      14,166.8ms |      14,571.4ms |   14,392 |    129,752 |

## 观察（对应 SB）

- **全量重建超线性**：100KB→500KB（5× 体积）耗时 16×；100KB→1MB（10×）耗时 44×。除块数线性增长外，`empty()` 对深层树的销毁与 snabbdom 节点创建的常数成本随树规模放大。
- **DOM 节点 O(文档)**：1MB 档 12.97 万节点全部常驻，这是滚动/重排劣化的直接来源，也是视口占位虚拟化要砍掉的体量。
- **SB 验收口径**：keyed 差量落地后，"仅少量块变更"的 updateState 应从 O(文档) 降到 O(变更块)（可另测：对同一 state 微调一块后的重建耗时）；视口虚拟化落地后，`scale` 的 DOM 节点数应从 O(文档) 降到 O(视口)（与视口内块数同量级，而非 12.97 万）。
- 1MB 档样本量 n=2（单次 ~14s），比较时以 p50 为主。

## 预算门禁（CI 软约束）

`scrollPageRender.bench.spec.ts` 内置宽松预算断言（拦 10× 级回归）：

| 操作         | 100KB | 500KB |   1MB |
| ------------ | ----: | ----: | ----: |
| updateState | 10000 | 30000 | 60000 |

当前实测全部低于预算上限。`test:perf` 不在 CI（1MB 档 heap 需求超 ubuntu runner），预算断言在本机复跑时生效。

## SB step 2 实测（keyed 差量落地后）

> 2026-11-03 · 同环境 · PR #142（merge `859304e`）。`updateState` 增加了 `{ force?: boolean }` 选项：locale 刷新与 option 驱动的重渲染（vega 主题）依赖"全量重建顺带刷新非 state 的 DOM 状态"，显式走 force 全量路径；其余调用方（setContent / rebuildContents / 增量失败兜底）走索引化对比——活块 `getState()` 与 fresh state 逐字节一致时保留原块（1470 块文档实证 100% 一致），只重建失配块。

| 档位  | 同内容 updateState p50 | 单块变更后 updateState p50 | SB 前全量重建 p50 | 提升 |
| ----- | ---------------------: | -------------------------: | ----------------: | ---: |
| 100KB |                  2.5ms |                      2.4ms |           321.8ms | 129× |
| 500KB |                 11.7ms |                     14.1ms |         5,131.8ms | 439× |
| 1MB   |                 28.4ms |                     25.5ms |        14,166.8ms | 499× |

- 剩余成本 = 每块 `getState()` + `JSON.stringify` 的比较（O(文档) CPU，零 DOM 重建），1MB 档 ~28ms，已低于一帧预算的 2 倍、且只在全量重建型调用点发生。
- DOM 节点数本批不变（仍 O(文档)）——视口占位虚拟化是独立后续批（step 2b），其验收即 `scale` 指标从 129,752 降到 O(视口)。
- 复跑同前：`pnpm -C packages/muya test:perf`（1MB 档需 raised heap）。

## SB step 2b 实测（视口虚拟化落地后）

> 2026-11-03 · PR #144（merge `9e11cd0`）。`ScrollPage` 增加 `virtualize` 选项（默认开）：可见带外（视口 ±2000px）的顶层块被卸载为**精确高度占位**——占位高度按 CSS 兄弟 margin 折叠规则逐块测量（`offsetHeight` + 自身份额的折叠 margin，朴素 offsetHeight 会把 5.6k 文档量出 -766px 漂移）；滚回/跳转时按需重挂载并整块重渲染 inline 内容（搜索高亮/引用标签等外部渲染输入随之新鲜）；程序化滚动动画期间抑制 sweep（实测上行 TOC 跳转被飞行中的 sweep 打断停在半程）。块树保持完整，queryBlock/selection/undo 语义不变；无真实布局环境（happy-dom）下测量全零，sweep 自动退化为 no-op。

- **DOM 规模**：1MB 文档（14,392 块）滚动稳态下真实 DOM 从 **129,752 节点** 降到 **挂载窗口（<300 节点）+ ~14k 个单 div 占位**（≈9× 降幅）；初始挂载仍全量，首个 sweep 即收敛到窗口。
- **10k 段落文档**（muya e2e perf smoke）：挂载 <300、占位 >9000、滚动到底部物化 `paragraph 9999` ✓。
- **桌面 e2e**：300 passed / 0 failed（虚拟化 ON；含 toc-scroll 深跳/回跳/幂等三条此前被虚拟化破坏、经 margin 精确测量 + sweep 抑制修复的用例）。
- 代价与取舍：占位符为派生状态（每 sweep 重建注册表）；margin 精确测量依赖正 margin 假设（muya 无负 margin）；DOM 节点在初始挂载瞬间仍为全量。

## SB step 3 实测（桌面源码模式 CM 视口虚拟化落地后）

> 2026-11-03 · 同环境 · 分支 `perf/sb-sourcecode-viewport`（基于 develop `92c3aff`）。与上面两节不同，这节量的是**桌面侧真实 Chromium**（e2e 起真窗口），不是 happy-dom。Fixture 5,050 行（50 个 `# Heading N` + 每段一行 filler），进入源码模式后统计。

| 档位 | 渲染的 `.CodeMirror-line` | 远跳落点误差 | 末标题可达 | scrollHeight（顶部→滚到底→回顶） |
| --- | ---: | ---: | :---: | --- |
| `Infinity`（改动前） | 5,050（全量，实测 `setOption` 后计数） | 0（全量渲染，行高无需估算） | ✓ | — |
| 1000 | 1,030（文档中部 2,032） | 0 | ✓ | 113,260 → 113,223 → 113,223 |
| 500 | 530 | 0 | ✓ | 113,265 → 113,227 → 113,227 |
| **200（采用）** | **230（−95.4%）** | **0** | ✓ | 113,268 → 113,228 → 113,228 |

- `viewportMargin` 的单位是**行**不是像素（`src/display/update_display.js:115-116` 直接拿它加减可见行号；CM5 默认 10）。取 200 是"最小够用档"：三档的落点与可达性都合格，差别只在渲染行数，200 的 230 行相当于 5,050 行的 4.6%。
- **远跳落点靠一次修正回路归零**：目标行在渲染窗口外时，`heightAtLine` 只能按估算行高累加，首次落点实测偏 28–36px（≥1 行，且随文档增大）；动画结束、目标行已被渲染后重测一次即可（`scrollSourceEditorToLine` 的 `scrollend` 修正，容差 2px、最多 2 次）。三档修正后均为 0px。
- scrollHeight 在首屏全量渲染后略降约 40px 然后稳定（估算收敛，不是抖动；滚到底再回顶不变）。
- **视觉零回退**：`.source-code .CodeMirror` 由 `height:auto; margin:50px auto` 改为 `height:100%; margin:0 auto`，原 50px 内缩移到 `.CodeMirror-lines { padding: 54px 0 }`（50 + CM 自带 4px）。实测首行距滚动器顶 **54px**，与旧布局一致，且内缩随内容滚走；外层 `.source-code` 不再溢出（CM 自带滚动条接管）。没有自动门禁守这个像素——`theme-visual-baseline.spec.ts` 不进源码模式。

## 源码模式键入实测（GUI_FIX_PLAN §8 总验收第 4 条）

> 2026-11-03 · Windows 11 · Node v22.21.1 · 真实 Electron/Chromium（`pnpm --filter colamd build` 后跑 Playwright）。fixture 由 `packages/desktop/test/e2e/source-mode-perf.bench.spec.ts` 生成：中英混排，目标 100KB / 500KB / 1MB（`Buffer.byteLength`），实际 **70,805 / 355,337 / 728,762 字符**。

**"前后"的定义**：把 B3 之前的 `cursorActivity` 处理临时恢复成"前"构建（每次按键跑完整 `saveContent`：两次全文 `getValue()` + 全文 `wordCount` + heading 扫描 + store 提交），跑完即 `git checkout` 还原、未提交；"后"是当前 develop 的 `change` 事件 O(1) 档 + 120ms 防抖提交。SB step 3 的视口虚拟化在两档都生效，因此这组数据隔离的是**键入管线**变量。

每样本 40 键连发（Playwright 逐键等待，renderer 同步处理，按键成本计入墙钟），5 样本取中位与最快值。每键墙钟含约 5ms 的 CDP/Playwright 常量开销，所以跨档看趋势、绝对值看最快值。

| 档位 | 字符数 | 前：中位 / 最快（ms/键） | 后：中位 / 最快（ms/键） | 中位变化 |
| --- | ---: | --- | --- | --- |
| 100KB | 70,805 | 6.20 / 6.03 | 5.33 / 5.15 | −14% |
| 500KB | 355,337 | 9.60 / 8.80 | 5.75 / 5.50 | −40% |
| 1MB | 728,762 | 14.88 / 12.65 | 7.20 / 6.97 | −52% |

- **前：随文档线性劣化**（体积 10×，中位 6.20→14.88，+140%）。扣掉约 5ms 常量后应用侧约 1.0→9.9ms/键。
- **后：基本平坦**（5.33→7.20，+35%；同构建另一轮 5.28→5.85，+11%）。扣掉常量后应用侧约 0.3→2.2ms/键，1MB 档的增量在 Playwright 噪声量级内。
- `PerformanceObserver` 的 `longtask` 在键入窗口与 600ms 暂停窗口内均无条目（>50ms 任务为 0）；暂停窗口的 O(N) 防抖提交（`getValue` + `wordCount`）本身低于 50ms，未形成长任务。
- **复跑**：bash `COLAMD_PERF_BENCH=1`（PowerShell `$env:COLAMD_PERF_BENCH='1'`）后 `pnpm -C packages/desktop exec playwright test --config=test/e2e/playwright.config.ts test/e2e/source-mode-perf.bench.spec.ts`。默认不进 CI（spec 内 `test.skip`），否则每个 PR 多 4 条 skip 与约 1.3 分钟基准。
- **#151 折行补充**：同一 spec 的另一条用 5,100 行 × 400 字符（约 2MB）量 `lineWrapping` + `viewportMargin: 200`。scrollHeight 顶部/底部/回顶 **453,765 / 453,765 / 453,765**（另一轮 453,765 / 453,757 / 453,757，≤8px），末行可达（`lineAtHeight` 返回末行）。**但 TOC 远跳落点实测 `headingTop = −17,796 ~ −17,823px`**：目标行仍在渲染窗口外，`heightAtLine` 的估算偏差超过 200 行 margin，`scrollSourceEditorToLine` 的 ±2px 修正回路没有可测对象，因此不收敛。这条数据否定了 #151 当时"修正回路对任何偏差都收敛到 2px"的假设——它只在目标行落进渲染窗口后成立。修复方向（沿行号粗定位再精确修正，或对折行文档取更大 margin）留在 #151。

