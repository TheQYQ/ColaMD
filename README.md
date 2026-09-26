<p align="center"><img src="docs/assets/logo-small.png" alt="ColaMD" width="100" height="100"></p>

<h1 align="center">ColaMD</h1>

<p align="center">
  <sub><strong>简体中文</strong> · <a href="README.en.md">English</a> · <a href="docs/i18n/README-zh_tw.md">繁體中文</a> · <a href="docs/i18n/README-jp.md">日本語</a> · <a href="docs/i18n/README-kr.md">한국어</a> · <a href="docs/i18n/README-fr.md">Français</a> · <a href="docs/i18n/README-de.md">Deutsch</a> · <a href="docs/i18n/README-es.md">Español</a> · <a href="docs/i18n/README-pt.md">Português</a> · <a href="docs/i18n/README-tr.md">Türkçe</a> · <a href="docs/i18n/README-ar.md">العربية</a> · <a href="docs/i18n/README-bn.md">বাংলা</a></sub>
</p>

<div align="center">
  <strong>:high_brightness: 一款简单优雅的 Markdown 编辑器 :crescent_moon:</strong><br>
  专注速度与易用性，Typora 式的无干扰界面。源自 <a href="https://github.com/marktext/marktext">MarkText</a> 的 fork。<br>
  <sub>支持 Linux、macOS 与 Windows。</sub>
</div>

<br>

<div align="center">
  <!-- License -->
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/TheQYQ/ColaMD.svg" alt="LICENSE">
  </a>
  <!-- Release -->
  <a href="https://github.com/TheQYQ/ColaMD/releases">
    <img src="https://img.shields.io/github/release/TheQYQ/ColaMD.svg" alt="release">
  </a>
  <!-- Downloads latest release -->
  <a href="https://github.com/TheQYQ/ColaMD/releases/latest">
    <img src="https://img.shields.io/github/downloads/TheQYQ/ColaMD/latest/total.svg" alt="downloads">
  </a>
</div>

<div align="center">
  <h3>
    <a href="#功能">功能</a>
    <span> | </span>
    <a href="#下载与安装">下载</a>
    <span> | </span>
    <a href="#开发">开发</a>
    <span> | </span>
    <a href="#致谢">致谢</a>
  </h3>
</div>

<br />

## 截图

![](docs/assets/colamd.png?raw=true)

## 功能

- **Typora 式的极简界面**：顶部细标题栏与菜单栏、居中无干扰的书写区、底部细状态栏（字数统计、源码模式开关）。
- **实时渲染（所见即所得）编辑**，以速度为先。
- **标准兼容**：支持 [CommonMark 规范](https://spec.commonmark.org)、[GitHub Flavored Markdown 规范](https://github.github.com/gfm/)，以及选择性的 [Pandoc markdown](https://pandoc.org/MANUAL.html#pandocs-markdown) 扩展。引擎侧的逐条一致性实测为 **CommonMark 88.0% / GFM 86.6%**，明细见 [`packages/muya/test/spec/conformance.md`](packages/muya/test/spec/conformance.md)。
- **扩展语法**：数学公式（KaTeX）、图表（Mermaid、Flowchart、Vega、PlantUML）、YAML front matter、表情符号。
- **侧栏两个面板**：文件树与文档大纲。
- **键盘优先**：命令面板（`Ctrl+Shift+P`）与快速打开（`Ctrl+P`）。
- **段落与行内样式快捷键**，减少手碰鼠标。
- **导出 8 种格式**（菜单「文件 → 导出」）：**HTML**、**PDF**、**Word (.docx)**、**长图 (PNG)**，以及需要本机安装 Pandoc 的 **EPUB**、**LaTeX**、**RTF**、**OPML**。
- **35 套内置主题**（浅色与深色），外加主题市场，可导入自定义主题。
- **三种编辑模式**：**源码模式**、**打字机模式**、**专注模式**。
- **图片直接粘贴**自剪贴板；未引用的图片可自动清理。

## 下载与安装

![platform](https://img.shields.io/static/v1.svg?label=Platform&message=Linux%20x64%20|%20macOS%20x64%2Farm64%20|%20Windows%20x64%2Farm64&style=for-the-badge)

|           ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/mac-pass-sm.png)           |           ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/windows-pass-sm.png)           |          ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/linux-pass-sm.png)          |
| :---------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: |
| [![Download for macOS](https://img.shields.io/badge/macOS-下载-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) | [![Download for Windows](https://img.shields.io/badge/Windows-下载-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) | [![Download for Linux](https://img.shields.io/badge/Linux-下载-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) |

所有安装包都发布在 [release 页面](https://github.com/TheQYQ/ColaMD/releases/latest)。若你的系统没有对应版本，请开一个 [issue](https://github.com/TheQYQ/ColaMD/issues)。

#### macOS

按机器架构选择 `arm64` 或 `x64` 的 DMG（文件名形如 `colamd-mac-(arm64|x64)-<version>.dmg`）；未发布通用（Universal）包。

#### Windows

`x64` 与 `arm64` 安装包都有发布，按机器架构选择（文件名形如 `colamd-win-(x64|arm64)-<version>-setup.exe`）。

#### Linux

在 release 页面按需选择格式：**AppImage**、**deb**、**rpm**、**snap** 或 **tar.gz**。

## 开发

ColaMD 是用 pnpm 管理的 Electron + Vue 3 monorepo（Node `>=20.19.0`）。

```bash
git clone git@github.com:TheQYQ/ColaMD.git
cd ColaMD
pnpm install      # 会下载 Electron、打补丁、rebuild 原生模块、压缩 locale
pnpm run dev      # 开发模式；改主进程要重启，渲染端有 HMR
```

提交前的门禁：

```bash
pnpm check        # lint + typecheck
pnpm test:unit    # 单元测试
pnpm build        # 构建校验
```

更多资料：

- [项目指南](docs/PROJECT_GUIDE.md) — 结构、模块地图、功能→代码定位表
- [优化路线](docs/OPTIMIZATION_ROADMAP.md) — 实测基线与待办清单
- [AGENTS.md](AGENTS.md) — 给 AI 编码代理与新贡献者的动手须知
- [贡献指南](.github/CONTRIBUTING.md)
- [构建与打包脚本](package.json) — `pnpm run build:win` / `build:mac` / `build:linux`

## 致谢

ColaMD 起源于 [MarkText](https://github.com/marktext/marktext) 的 fork，原始项目由
[Luo Ran (Jocs)](https://github.com/Jocs) 与
[MarkText 的贡献者们](https://github.com/marktext/marktext/graphs/contributors)共同创建。
感谢他们为这款编辑器打下基础。

## 许可证

[**MIT**](LICENSE) — 依许可证要求，原始 MarkText 的版权声明保留在 LICENSE 文件中。
