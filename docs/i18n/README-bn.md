<p align="center"><img src="../assets/logo-small.png" alt="ColaMD" width="100" height="100"></p>

<h1 align="center">ColaMD</h1>

<div align="center">
  <strong>:high_brightness: আধুনিক প্রজন্মের Markdown এডিটর :crescent_moon:</strong><br>
  একটি সাধারণ এবং অত্যাধুনিক Markdown এডিটর যা গতি এবং ব্যবহারযোগ্যতার দিকে গুরুত্ত দেয়।<br>
  <sub>Linux, macOS এবং Windows-এর জন্য।</sub>
</div>

<br>

<div align="center">
  <!-- License -->
  <a href="../../LICENSE">
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
</div>

<div align="center">
  <h3>
    <a href="https://github.com/TheQYQ/ColaMD#features">
      বৈশিষ্ট্য
    </a>
    <span> | </span>
    <a href="https://github.com/TheQYQ/ColaMD#download-and-installation">
      ডাউনলোড
    </a>
    <span> | </span>
    <a href="https://github.com/TheQYQ/ColaMD#development">
      ডেভেলপমেন্ট
    </a>
    <span> | </span>
    <a href="https://github.com/TheQYQ/ColaMD#contribution">
      অবদান
    </a>
  </h3>
</div>

<div align="center">
  <sub>MarkText-এর একটি ফর্ক, পরিচর্যায় <a href="https://github.com/TheQYQ">TheQYQ</a>।</sub>
</div>

<br />

## স্ক্রিনশট

![](../assets/colamd.png?raw=true)

## বৈশিষ্ট্য

- রিয়েলটাইম প্রিভিউ (WYSIWYG) এবং পরিচ্ছন্ন, আধুনিক ইন্টারফেস আপনাকে গভীর মনোযোগের সাথে লেখার অভিজ্ঞতা দেয়।
- [CommonMark Spec](https://spec.commonmark.org), [GitHub Flavored Markdown Spec](https://github.github.com/gfm/) এবং আংশিকভাবে [Pandoc markdown](https://pandoc.org/MANUAL.html#pandocs-markdown) সমর্থন করে।
- Markdown এক্সটেনশন যেমন গণিতের অভিব্যক্তি (KaTeX), front matter এবং emoji সমর্থন করে।
- দ্রুত লেখার জন্য paragraph ও inline style shortcut সমর্থন করে।
- **HTML** এবং **PDF** ফাইলে এক্সপোর্ট করা যায়।
- বিভিন্ন [theme](https://github.com/TheQYQ/ColaMD/docs/themes): **Cadmium Light**, **Material Dark** ইত্যাদি।
- বিভিন্ন এডিটিং মোড: **Source Code mode**, **Typewriter mode**, **Focus mode**।
- ক্লিপবোর্ড থেকে সরাসরি ছবি পেস্ট করা যায়।

## ডাউনলোড ও ইনস্টলেশন

![platform](https://img.shields.io/static/v1.svg?label=Platform&message=Linux%20x64%20|%20macOS%20x64%2Farm64%20|%20Windows%20x64%2Farm64&style=for-the-badge)

|             ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/mac-pass-sm.png)             |             ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/windows-pass-sm.png)             |            ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/linux-pass-sm.png)            |
| :-------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------: |
| [![Download for macOS](https://img.shields.io/badge/macOS-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) | [![Download for Windows](https://img.shields.io/badge/Windows-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) | [![Download for Linux](https://img.shields.io/badge/Linux-Download-blue)](https://github.com/TheQYQ/ColaMD/releases/latest) |

#### macOS

macOS 11 (Big Sur) বা পরবর্তী সংস্করণ প্রয়োজন। Universal build প্রকাশ করা হয় না, তাই আপনার মেশিনের সঙ্গে মিল থাকা `arm64` বা `x64` installer বেছে নিন।

macOS 11 (Big Sur) বা তার পরের সংস্করণ প্রয়োজন। ইউনিভার্সাল বিল্ড প্রকাশিত হয় না — আপনার মেশিনের সাথে মিলিয়ে `colamd-mac-(arm64|x64)-<সংস্করণ>.dmg` বেছে নিন।

#### Windows

Windows 10 অথবা 11 প্রয়োজন। x64 এবং arm64 - উভয় installer প্রকাশ করা হয়, তাই আপনার মেশিনের architecture অনুযায়ীটি বেছে নিন।

Windows 10 বা 11 প্রয়োজন। x64 এবং arm64 উভয় ইনস্টলারই প্রকাশিত হয় — আপনার মেশিনের আর্কিটেকচারের সাথে মিলিয়ে (`colamd-win-(x64|arm64)-<সংস্করণ>-setup.exe`) বেছে নিন।

#### Linux

অনুগ্রহ করে [Linux installation instructions](https://github.com/TheQYQ/ColaMD/docs/installation) অনুসরণ করুন।

#### অন্যান্য

Linux, macOS এবং Windows-এর সব binary [release page](https://github.com/TheQYQ/ColaMD/releases/latest) থেকে ডাউনলোড করা যাবে। আপনার সিস্টেমের জন্য কোনো সংস্করণ না থাকলে একটি [issue](https://github.com/TheQYQ/ColaMD/issues) খুলুন।

## ডেভেলপমেন্ট

আপনি যদি নিজে ColaMD build করতে চান, তাহলে আমাদের [build instructions](https://github.com/TheQYQ/ColaMD/docs/dev/build) দেখুন।

- [ব্যবহারকারী ডকুমেন্টেশন](https://github.com/TheQYQ/ColaMD/docs/introduction)
- [ডেভেলপার ডকুমেন্টেশন](https://github.com/TheQYQ/ColaMD/docs/dev/overview)

ColaMD সম্পর্কে আপনার কোনো প্রশ্ন থাকলে issue খুলতে পারেন। Issue খোলার সময় অনুগ্রহ করে ডিফল্ট ফরম্যাটটি ব্যবহার করুন। অবশ্যই, সরাসরি PR পাঠালে সেটিও অত্যন্ত প্রশংসিত হবে।

## অবদান

ColaMD উন্নয়নের পর্যায়ে আছে — pull request করার আগে অনুগ্রহ করে [অবদান নির্দেশিকা](../../.github/CONTRIBUTING.md) পড়ে নিন।

## অবদানকারীরা

যারা ইতিমধ্যেই ColaMD-এ অবদান রেখেছেন, তাদের সবাইকে ধন্যবাদ [[contributors](https://github.com/TheQYQ/ColaMD/graphs/contributors)]।

<a href="https://github.com/TheQYQ/ColaMD/graphs/contributors"><img src="https://contrib.rocks/image?repo=TheQYQ/ColaMD" /></a>

## কৃতজ্ঞতা স্বীকার

ColaMD [MarkText](https://github.com/marktext/marktext)-এর একটি ফর্ক, যার মূল নির্মাতা [Luo Ran (Jocs)](https://github.com/Jocs) এবং [MarkText অবদানকারীরা](https://github.com/marktext/marktext/graphs/contributors)। এই সম্পাদকের ভিত্তি স্থাপনের জন্য তাদের ধন্যবাদ।

## লাইসেন্স

[**MIT**](../../LICENSE) — লাইসেন্সের শর্ত অনুযায়ী, LICENSE ফাইলে MarkText-এর মূল কপিরাইট নোটিশ সংরক্ষিত আছে।
