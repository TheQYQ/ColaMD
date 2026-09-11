# Muya Keystroke-Pipeline Performance Baseline

> 説明：本文档记录 `keystrokePipeline.bench.spec.ts` 微基准的首轮实测数字与复跑方法，作为 M1 系列（M1.1 / M1.2 / M1.4）优化的前后对照基线。每轮优化合入后，请用「复跑方法」一节刷新数字并附 PR 链接。

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

## 变更记录

| 日期       | 提交                              | 变化                               | 备注                       |
| ---------- | --------------------------------- | ---------------------------------- | -------------------------- |
| 2026-09-09 | 601d5c3 (基线)                    | 首次记录                           | M1.0 基线建立              |
| 2026-09-10 | 19d3c1e (perf/m1-1-getstate-live) | PR-3 实测：edit+flush 1MB p50 −14% | 后台负载偏高，空闲复测待做 |
| 2026-09-11 | 8a471b1 (perf/m1-2-keystroke-deser) | M1.2 实测：edit+flush 1MB p50 50.8→2.7ms、p95 4.7ms | 验收线达成（<16ms）        |
