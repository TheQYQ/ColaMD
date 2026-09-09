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

## 变更记录

| 日期       | 提交           | 变化     | 备注          |
| ---------- | -------------- | -------- | ------------- |
| 2026-09-09 | 601d5c3 (基线) | 首次记录 | M1.0 基线建立 |
