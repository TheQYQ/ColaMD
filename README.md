<p align="center"><img src="docs/assets/logo-small.png" alt="ColaMD" width="100" height="100"></p>

<h1 align="center">ColaMD</h1>

<div align="center">
  <strong>:high_brightness: A simple and elegant Markdown editor :crescent_moon:</strong><br>
  Focused on speed and usability. A fork of <a href="https://github.com/marktext/marktext">MarkText</a>.<br>
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

<div align="center">
  <sub>Translations:</sub>
  <a href="docs/i18n/README-zh_cn.md#readme">
    <span>:cn:</span>
  </a>
  <a href="docs/i18n/README-zh_tw.md#readme">
    <span>:taiwan:</span>
  </a>
  <a href="docs/i18n/README-jp.md#readme">
    <span>:jp:</span>
  </a>
  <a href="docs/i18n/README-fr.md#readme">
    <span>:fr:</span>
  </a>
  <a href="docs/i18n/README-tr.md#readme">
    <span>:tr:</span>
  </a>
  <a href="docs/i18n/README-es.md#readme">
    <span>:es:</span>
  </a>
  <a href="docs/i18n/README-pt.md#readme">
    <span>:portugal:</span>
  </a>
  <a href="docs/i18n/README-kr.md#readme">
    <span>:kr:</span>
  </a>
  <a href="docs/i18n/README-ar.md#readme">
    <span>:saudi_arabia:</span>
  </a>
  <a href="docs/i18n/README-bn.md#readme">
    <span>:bangladesh:</span>
  </a>
  <a href="docs/i18n/README-de.md#readme">
    <span>:de:</span>
  </a>
</div>

<br />

## Screenshot

![](docs/assets/colamd.png?raw=true)

## Features

- Realtime preview (WYSIWYG) and a clean and simple interface to get a distraction-free writing experience.
- Support [CommonMark Spec](https://spec.commonmark.org), [GitHub Flavored Markdown Spec](https://github.github.com/gfm/) and selective support [Pandoc markdown](https://pandoc.org/MANUAL.html#pandocs-markdown).
- Markdown extensions such as math expressions (KaTeX), front matter and emojis.
- Support paragraphs and inline style shortcuts to improve your writing efficiency.
- Output **HTML** and **PDF** files.
- Various themes: **Cadmium Light**, **Material Dark** etc.
- Various editing modes: **Source Code mode**, **Typewriter mode**, **Focus mode**.
- Paste images directly from clipboard.

## Download and Installation

![platform](https://img.shields.io/static/v1.svg?label=Platform&message=Linux%20x64%20|%20macOS%20x64%2Farm64%20|%20Windows%20x64%2Farm64&style=for-the-badge)

|             ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/mac-pass-sm.png)             |             ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/windows-pass-sm.png)             |            ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/linux-pass-sm.png)            |
| :-------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------: |
| [![Download for macOS](https://img.shields.io/badge/macOS-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) | [![Download for Windows](https://img.shields.io/badge/Windows-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) | [![Download for Linux](https://img.shields.io/badge/Linux-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) |

All installers are published on the [release page](https://github.com/TheQYQ/ColaMD/releases/latest). If a version is unavailable for your system, then please open an [issue](https://github.com/TheQYQ/ColaMD/issues).

#### macOS

Requires macOS 11 (Big Sur) or later. Universal builds aren't published — pick the matching `arm64` or `x64` DMG (`colamd-mac-(arm64|x64)-<version>.dmg`).

#### Windows

Requires Windows 10 or 11. Both x64 and arm64 installers are published — pick the architecture that matches your machine (`colamd-win-(x64|arm64)-<version>-setup.exe`).

#### Linux

Download the format you prefer from the release page: **AppImage**, **deb**, **rpm**, **snap** or **tar.gz**.

## Development

ColaMD is an Electron + Vue 3 monorepo managed with pnpm.

```bash
git clone git@github.com:TheQYQ/ColaMD.git
cd ColaMD
pnpm install
pnpm run dev
```

More resources:

- [Development guide](CLAUDE.md) — architecture, commands, conventions
- [Contributing guide](.github/CONTRIBUTING.md)
- [Build & packaging scripts](package.json) — `pnpm run build:win` / `build:mac` / `build:linux`

## Credits

ColaMD started as a fork of [MarkText](https://github.com/marktext/marktext), originally
created by [Luo Ran (Jocs)](https://github.com/Jocs) together with the
[MarkText contributors](https://github.com/marktext/marktext/graphs/contributors).
Huge thanks to them for building the foundation of this editor.

## License

[**MIT**](LICENSE) — the original MarkText copyright notice is retained in the LICENSE file as required by the license.
