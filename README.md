<p align="center"><img src="docs/assets/logo-small.png" alt="ColaMD" width="100" height="100"></p>

<h1 align="center">ColaMD</h1>

<div align="center">
  <a href="https://twitter.com/intent/tweet?via=colamdme&url=https://github.com/TheQYQ/ColaMD/&text=What%20do%20you%20want%20to%20say%20to%20app?&hashtags=happyColaMD">
    <img src="https://img.shields.io/twitter/url/https/github.com/TheQYQ/ColaMD.svg?style=for-the-badge" alt="twitter">
  </a>
</div>
<div align="center">
  <strong>:high_brightness: Next generation markdown editor :crescent_moon:</strong><br>
  A simple and elegant open-source markdown editor that focused on speed and usability.<br>
  <sub>Available for Linux, macOS and Windows.</sub>
</div>

<br>

<div align="center">
  <!-- License -->
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/TheQYQ/ColaMD.svg" alt="LICENSE">
  </a>
  <!-- Downloads total -->
  <a href="https://github.com/TheQYQ/ColaMD/releases">
    <img src="https://img.shields.io/github/downloads/TheQYQ/ColaMD/total.svg" alt="total download">
  </a>
  <!-- Downloads latest release -->
  <a href="https://github.com/TheQYQ/ColaMD/releases/latest">
    <img src="https://img.shields.io/github/downloads/TheQYQ/ColaMD/latest/total.svg" alt="latest download">
  </a>
  <!-- sponsors -->
  <a href="https://opencollective.com/colamd">
    <img src="https://opencollective.com/colamd/tiers/silver-sponsors/badge.svg?label=SilverSponsors&color=brightgreen" alt="sponsors">
  </a>
</div>

<div align="center">
  <h3>
    <a href="https://github.com/TheQYQ/ColaMD">
      Website
    </a>
    <span> | </span>
    <a href="https://github.com/TheQYQ/ColaMD#features">
      Features
    </a>
    <span> | </span>
    <a href="https://github.com/TheQYQ/ColaMD#download-and-installation">
      Downloads
    </a>
    <span> | </span>
    <a href="https://github.com/TheQYQ/ColaMD#development">
      Development
    </a>
    <span> | </span>
    <a href="https://github.com/TheQYQ/ColaMD#contribution">
      Contribution
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
  <a href="docs/i18n/README-bn.md#readme">
    <span>:bangladesh:</span>
  </a>
</div>

<div align="center">
  <sub>This Markdown editor that could. Built with ❤︎ by
    <a href="https://github.com/Jocs">Jocs</a> and
    <a href="https://github.com/TheQYQ/ColaMD/graphs/contributors">
      contributors
    </a>
    .
  </sub>
</div>

<br />

<h2 align="center">Sponsors</h2>

ColaMD is an open-source Markdown editor powered by the support of its community. If ColaMD improves your workflow, please consider [sponsoring the project](https://github.com/sponsors/colamd). Thank you to all the sponsors ❤️

**Special Sponsor**

| [<img src="docs/assets/sponsors/serpapi.png" width="150">](https://serpapi.com/?utm_source=colamd) | [Scrape Google and other search engines from our fast, easy, and complete API.](https://serpapi.com/?utm_source=colamd) |
| -------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |

## Screenshot

![](docs/assets/colamd.png?raw=true)

## Features

- Realtime preview (WYSIWYG) and a clean and simple interface to get a distraction-free writing experience.
- Support [CommonMark Spec](https://spec.commonmark.org), [GitHub Flavored Markdown Spec](https://github.github.com/gfm/) and selective support [Pandoc markdown](https://pandoc.org/MANUAL.html#pandocs-markdown).
- Markdown extensions such as math expressions (KaTeX), front matter and emojis.
- Support paragraphs and inline style shortcuts to improve your writing efficiency.
- Output **HTML** and **PDF** files.
- Various [themes](https://github.com/TheQYQ/ColaMD/docs/themes): **Cadmium Light**, **Material Dark** etc.
- Various editing modes: **Source Code mode**, **Typewriter mode**, **Focus mode**.
- Paste images directly from clipboard.

## Download and Installation

![platform](https://img.shields.io/static/v1.svg?label=Platform&message=Linux%20x64%20|%20macOS%20x64%2Farm64%20|%20Windows%20x64%2Farm64&style=for-the-badge)

|             ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/mac-pass-sm.png)             |             ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/windows-pass-sm.png)             |            ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/linux-pass-sm.png)            |
| :-------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------: |
| [![Download for macOS](https://img.shields.io/badge/macOS-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) | [![Download for Windows](https://img.shields.io/badge/Windows-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) | [![Download for Linux](https://img.shields.io/badge/Linux-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) |

Want to see new features of the latest version? Please refer to [CHANGELOG](https://github.com/TheQYQ/ColaMD/docs/changelog).

#### macOS

Requires macOS 11 (Big Sur) or later. Universal builds aren't published — pick the matching `arm64` or `x64` installer.

You can either download the latest `colamd-mac-(arm64|x64)-%version%.dmg` from the [release page](https://github.com/TheQYQ/ColaMD/releases/latest) or install ColaMD using [**homebrew cask**](https://github.com/caskroom/homebrew-cask). To use Homebrew-Cask you just need to have [Homebrew](https://brew.sh/) installed.

```bash
brew install --cask mark-text
```

#### Windows

Requires Windows 10 or 11. Both x64 and arm64 installers are published — pick the architecture that matches your machine.

Simply download and install ColaMD via the setup wizard (`colamd-win-(x64|arm64)-%version%-setup.exe`) and choose whether to install per-user or machine wide. Alternatively, install ColaMD using a package manager such as [Chocolatey](https://chocolatey.org/) or [Winget](https://docs.microsoft.com/en-us/windows/package-manager/winget/).

To use Chocolatey, you need to have [Chocolatey](https://chocolatey.org/install) installed:

```bash
choco install colamd
```

To use Winget, you need to have [Winget](https://docs.microsoft.com/en-us/windows/package-manager/winget/#install-winget) installed:

```bash
winget install colamd
```

#### Linux

Please follow the [Linux installation instructions](https://github.com/TheQYQ/ColaMD/docs/installation).

#### Other

All binaries for Linux, macOS and Windows can be downloaded from the [release page](https://github.com/TheQYQ/ColaMD/releases/latest). If a version is unavailable for your system, then please open an [issue](https://github.com/TheQYQ/ColaMD/issues).

## Development

If you wish to build ColaMD yourself, please check out our [build instructions](https://github.com/TheQYQ/ColaMD/docs/dev/build).

- [User documentation](https://github.com/TheQYQ/ColaMD/docs/introduction)
- [Developer documentation](https://github.com/TheQYQ/ColaMD/docs/dev/overview)

If you have any questions regarding ColaMD, you are welcome to write an issue. When doing so please use the default format found when opening an issue. Of course, if you submit a PR directly, it will be greatly appreciated.

## Contribution

ColaMD is in development, please make sure to read the [Contributing Guide](.github/CONTRIBUTING.md) before making a pull request. Want to add some features to ColaMD? Refer to our [roadmap](https://github.com/TheQYQ/ColaMD/projects) and open issues.

## Contributors

Thank you to all the people who have already contributed to ColaMD[[contributors](https://github.com/TheQYQ/ColaMD/graphs/contributors)].

<a href="https://github.com/TheQYQ/ColaMD/graphs/contributors"><img src="https://opencollective.com/colamd/contributors.svg?width=890" /></a>

## License

[**MIT**](LICENSE).
