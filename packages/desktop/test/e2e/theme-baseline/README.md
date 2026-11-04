# 主题截图基线（GUI-SA 前置）

33 个可选主题 × 2 张 = 66 份 PNG。由 `theme-visual-baseline.spec.ts` 生成，作为专项 SA（主题文件瘦身，「GUI 四维审查」的 SA 专项，结论见 `docs/PROJECT_GUIDE.md` §14.2）的"零视觉差异"对照基线。补上 GUI-B9 验收清单里"33 主题视觉抽查（截图留档）"这个当时没做的缺口（issue #125 亦记）。

## 场景（两张截图拍什么）

启动时打开固定目录 `colamd-theme-baseline`（含 `notes.md` 与 `src/theme-fixture.md`），点树行开两个标签页：`notes.md` 非活动、`theme-fixture.md` 活动且承载固定 fixture（中英混排标题/行内格式/列表/任务列表/引用/prism 代码块/表格/hr）。窗口同时入镜：标题栏、自绘菜单栏、侧栏文件树、编辑器标签页（活动+非活动）、正文各面、状态栏——主题文件五类补丁（titlebar / side-bar / editor-tabs / code-block / muya kebab-case 变量）与 `:root` 色值全部被覆盖。

- `<id>.png` — 首屏。
- `<id>-bottom.png` — 编辑区滚动到底：表格、hr、结尾段落入镜。

主题清单在 spec 内硬编码（菜单顺序 10 亮 + 23 暗），`beforeAll` 会与运行中的应用菜单逐一核对，任何一侧漂移都会让整个套件红掉。

## 如何重新生成 / 比对

```bash
# 比对（SA 验收：期望 33 passed，零 diff）
cd packages/desktop && pnpm exec playwright test --config=test/e2e/playwright.config.ts test/e2e/theme-visual-baseline.spec.ts

# 重新生成（有意接受新外观时）
pnpm exec playwright test --config=test/e2e/playwright.config.ts test/e2e/theme-visual-baseline.spec.ts --update-snapshots
```

跑之前先 `pnpm build`（e2e 不自建产物），并确认环境变量里没有 `ELECTRON_FORCE_IS_PACKAGED`。

## 平台边界（重要）

PNG 钉死了 **Windows 的字体渲染与缩放**：基线只在本机（生成它的这台 Windows）生成与比对。spec 对非 win32 整体 `test.skip`（豁免注册在 `test/unit/utils/skipLedger.ts`），CI 的 linux/macos e2e 腿不会触碰这些文件。换机器或改显示缩放后基线失去意义，需重新生成。

已知未覆盖：搜索栏、命令面板、对话框/遮罩、图片与 hover 浮层（kebab 指的是 muya 的 kebab-case 变量，不是悬停按钮）。这些面由组件层 CSS 与 B9 的对比度脚本守着，不在主题文件瘦身的静默回归面上。

## 尺寸

66 份 × ~85KB ≈ 5.6MB，一次性入库的验收资产；仅当主题集或场景变化时整体重新生成。
