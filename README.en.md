<p align="center"><img src="docs/assets/logo-small.png" alt="ColaMD" width="100" height="100"></p>

<h1 align="center">ColaMD</h1>

<p align="center">
  <sub><a href="README.md">简体中文</a> · <strong>English</strong></sub>
</p>

<div align="center">
  <strong>:high_brightness: A simple and elegant Markdown editor :crescent_moon:</strong><br>
  Focused on speed and usability, with a Typora-style distraction-free interface.<br>
  <sub>Available for Linux, macOS and Windows.</sub>
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
    <a href="#features">
      Features
    </a>
    <span> | </span>
    <a href="#download-and-installation">
      Downloads
    </a>
    <span> | </span>
    <a href="#development">
      Development
    </a>
    <span> | </span>
    <a href="#credits">
      Credits
    </a>
  </h3>
</div>

<br />

## Screenshot

![](docs/assets/colamd.png?raw=true)

## Features

- Typora-style minimal interface: a slim title bar and menu bar on top, a distraction-free centered writing area, and a slim status bar (word count, source-code toggle).
- Realtime preview (WYSIWYG) editing experience focused on speed and usability.
- Support [CommonMark Spec](https://spec.commonmark.org), [GitHub Flavored Markdown Spec](https://github.github.com/gfm/) and selective support [Pandoc markdown](https://pandoc.org/MANUAL.html#pandocs-markdown). Measured engine-side conformance: **CommonMark 88.0% / GFM 86.6%** — details in [`packages/muya/test/spec/conformance.md`](packages/muya/test/spec/conformance.md).
- Markdown extensions such as math expressions (KaTeX), diagrams (Mermaid, Flowchart, Vega, PlantUML), front matter and emojis.
- Sidebar with three panels: the file tree, the document outline, and version history.
- Command palette (`Ctrl+Shift+P`) and quick open (`Ctrl+P`) for keyboard-driven workflows.
- Paragraph and inline style shortcuts to improve your writing efficiency.
- Export to **8 formats** from _File → Export_: **HTML**, **PDF**, **Word (.docx)** and a **long image (PNG)**, plus **EPUB**, **LaTeX**, **RTF** and **OPML** when Pandoc is installed.
- 33 built-in themes (light & dark) plus a local theme marketplace for importing custom themes.
- Various editing modes: **Source Code mode**, **Typewriter mode**, **Focus mode**.
- Paste images directly from clipboard; unreferenced images can be cleaned up automatically.

## Download and Installation

![platform](https://img.shields.io/static/v1.svg?label=Platform&message=Linux%20x64%20|%20macOS%20x64%2Farm64%20|%20Windows%20x64%2Farm64&style=for-the-badge)

|             ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/mac-pass-sm.png)             |             ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/windows-pass-sm.png)             |            ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/linux-pass-sm.png)            |
| :-------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------: |
| [![Download for macOS](https://img.shields.io/badge/macOS-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) | [![Download for Windows](https://img.shields.io/badge/Windows-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) | [![Download for Linux](https://img.shields.io/badge/Linux-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) |

All installers are published on the [release page](https://github.com/TheQYQ/ColaMD/releases/latest). If a version is unavailable for your system, then please open an [issue](https://github.com/TheQYQ/ColaMD/issues).

#### macOS

Universal builds aren't published — pick the matching `arm64` or `x64` DMG (`colamd-mac-(arm64|x64)-<version>.dmg`).

#### Windows

Requires Windows 10 or 11. Both x64 and arm64 installers are published — pick the architecture that matches your machine (`colamd-win-(x64|arm64)-<version>-setup.exe`).

#### Linux

Download the format you prefer from the release page: **AppImage**, **deb**, **rpm**, **snap** or **tar.gz**.

## Development

ColaMD is an Electron + Vue 3 monorepo managed with pnpm (Node `>=20.19.0`).

```bash
git clone git@github.com:TheQYQ/ColaMD.git
cd ColaMD
pnpm install      # downloads Electron, applies patches, rebuilds native modules, minifies locales
pnpm run dev      # dev mode; restart the app when main-process code changes, the renderer has HMR
```

Gates to run before submitting:

```bash
pnpm check        # lint + typecheck
pnpm test:unit    # unit tests
pnpm build        # build check
```

More resources:

- [Project guide](docs/PROJECT_GUIDE.md) — structure, module map, feature → code table
- [AGENTS.md](AGENTS.md) — the hands-on guide for AI coding agents and new contributors
- [Contributing guide](.github/CONTRIBUTING.md)
- [Build & packaging scripts](package.json) — `pnpm run build:win` / `build:mac` / `build:linux`

## Credits

This project is a fork of [MarkText](https://github.com/marktext/marktext).

## License

[**MIT**](LICENSE) — the original MarkText copyright notice is retained in the LICENSE file as required by the license.
