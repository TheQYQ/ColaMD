#!/usr/bin/env python3
"""Theme contrast gate (GUI-B9 / A11Y-02).

Parses the `:root` custom properties of every built-in theme CSS file and
checks the fixed text pairs against WCAG 2.1 contrast:

  1. buttonPrimaryFontColor on buttonPrimaryBgColor  (primary buttons)
  2. sideBarTextColor      on sideBarBgColor         (sidebar text)
  3. editorColor           on editorBgColor          (editor body text)

Alpha colors are composited over their pair's background before measuring,
mirroring how the browser actually paints them.

Usage:
  python scripts/check-theme-contrast.py            # gate mode, exit 1 on failure
  python scripts/check-theme-contrast.py --fix      # rewrite failing colors in place

--fix darkens (or lightens) ONLY the failing foreground variable — adjusting
its lightness along the same hue until the pair reaches 4.5:1 — and prints a
per-file report for human review. The checked-in gate always runs in check
mode; run --fix from a worktree and read the diff.

Zero third-party dependencies, same CI shape as check-md-links.py.
"""

from __future__ import annotations

import colorsys
import glob
import os
import re
import sys

THEME_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "packages", "desktop", "src", "renderer", "src", "assets", "themes",
)

THRESHOLD = 4.5

# The checked pairs: (foreground var, background var). Backgrounds resolve
# recursively so a var referencing another var (--themeColor) works.
PAIRS = [
    ("buttonPrimaryFontColor", "buttonPrimaryBgColor"),
    ("sideBarTextColor", "sideBarBgColor"),
    ("editorColor", "editorBgColor"),
]

VAR_RE = re.compile(r"--([A-Za-z0-9]+)\s*:\s*([^;]+);")


def parse_color(value: str):
    value = value.strip()
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", value)
    if m:
        h = m.group(1)
        return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))
    m = re.fullmatch(
        r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value
    )
    if m:
        rgb = tuple(int(m.group(i)) for i in (1, 2, 3))
        alpha = float(m.group(4)) if m.group(4) is not None else 1.0
        return (*rgb, alpha)
    return None


def composite(fg, bg):
    if len(fg) == 3:
        return fg
    alpha = fg[3]
    return tuple(round(fg[i] * alpha + bg[i] * (1 - alpha)) for i in range(3))


def opaque(rgb):
    # A translucent background paints over the window; approximating the blend
    # against white keeps the measurement defined without guessing the layer
    # beneath. Only affects the rare rgba() background declaration.
    if len(rgb) == 3:
        return rgb
    return composite(rgb, (255, 255, 255))


def luminance(rgb):
    def channel(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg_rgb, bg_rgb):
    l1, l2 = sorted((luminance(opaque(fg_rgb)), luminance(opaque(bg_rgb))), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def resolve(name, variables, seen=None):
    seen = seen or set()
    if name in seen:
        return None
    seen.add(name)
    raw = variables.get(name)
    if raw is None:
        return None
    color = parse_color(raw)
    if color is not None:
        return color
    ref = re.fullmatch(r"var\(\s*--([A-Za-z0-9]+)\s*\)", raw.strip())
    if ref:
        return resolve(ref.group(1), variables, seen)
    return None


def rgb_to_hex(rgb):
    return "#%02X%02X%02X" % rgb


def adjust_for_contrast(start_rgb, bg_rgb, threshold=THRESHOLD, darken=None):
    """Return a color with the same hue as `start_rgb` whose lightness walks
    (2% steps, toward darker or lighter) until its contrast against `bg_rgb`
    reaches the threshold. Deterministic; `darken` picks the direction and
    defaults to inferring it from the two colors' luminance."""
    r, g, b = (c / 255 for c in start_rgb)
    h, l, s = colorsys.rgb_to_hls(r, g, b)

    def attempt(lightness):
        r2, g2, b2 = colorsys.hls_to_rgb(h, lightness, s)
        return contrast((round(r2 * 255), round(g2 * 255), round(b2 * 255)), bg_rgb)

    if darken is None:
        # Text pairs: walk the text toward the background's luminance pole.
        darken = luminance(opaque(start_rgb)) > luminance(opaque(bg_rgb))

    step = 0.02 * (-1 if darken else 1)
    lightness = l
    for _ in range(60):
        lightness = min(1.0, max(0.0, lightness + step))
        if attempt(lightness) >= threshold:
            r2, g2, b2 = colorsys.hls_to_rgb(h, lightness, s)
            return (round(r2 * 255), round(g2 * 255), round(b2 * 255))
    # Hue with no reaching lightness in that direction: fall back to the other.
    step = -step
    lightness = l
    for _ in range(60):
        lightness = min(1.0, max(0.0, lightness + step))
        if attempt(lightness) >= threshold:
            r2, g2, b2 = colorsys.hls_to_rgb(h, lightness, s)
            return (round(r2 * 255), round(g2 * 255), round(b2 * 255))
    return start_rgb


def walk_accent(fg_rgb, accent_rgb, threshold=THRESHOLD):
    """Button-pair fix: walk the ACCENT color (same hue) until the label the
    theme chose reaches the threshold ON the candidate — not against the old
    accent, which is self-referential. A dark label moves the accent lighter,
    a light label darker."""
    r, g, b = (c / 255 for c in accent_rgb)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    label_lum = luminance(composite(fg_rgb, accent_rgb))
    step = 0.02 * (-1 if label_lum > 0.35 else 1)

    def try_lightness(lightness):
        c2 = colorsys.hls_to_rgb(h, lightness, s)
        rgb2 = (round(c2[0] * 255), round(c2[1] * 255), round(c2[2] * 255))
        return rgb2, contrast(composite(fg_rgb, rgb2), rgb2)

    for direction in (step, -step):
        lightness = l
        for _ in range(60):
            lightness = min(1.0, max(0.0, lightness + direction))
            rgb2, ratio = try_lightness(lightness)
            if ratio >= threshold:
                return rgb2
    return accent_rgb


def check_file(path):
    variables = {}
    for m in VAR_RE.finditer(open(path, encoding="utf-8").read()):
        variables[m.group(1)] = m.group(2).strip()

    failures = []
    for fg_name, bg_name in PAIRS:
        fg = resolve(fg_name, variables)
        bg = resolve(bg_name, variables)
        if fg is None or bg is None:
            continue
        ratio = contrast(composite(fg, bg), bg)
        if ratio < THRESHOLD:
            failures.append((fg_name, fg_name, ratio))
    return variables, failures


def fix_file(path, variables, failures):
    lines = open(path, encoding="utf-8").read().split("\n")
    report = []
    for fg_name, _, ratio in failures:
        bg_name = next(b for f, b in PAIRS if f == fg_name)
        fg = resolve(fg_name, variables)
        bg = resolve(bg_name, variables)
        # Primary buttons: the audit's strategy is to darken the ACCENT
        # background so the white label stays white. Text pairs: adjust the
        # text color itself toward the background.
        if fg_name == "buttonPrimaryFontColor":
            target_name, start_rgb = bg_name, opaque(bg)
        else:
            target_name, start_rgb = fg_name, composite(fg, bg)
        if fg_name == 'buttonPrimaryFontColor':
            new_rgb = walk_accent(composite(fg, bg), opaque(bg))
        else:
            new_rgb = adjust_for_contrast(composite(fg, bg), bg)
        new_hex = rgb_to_hex(new_rgb)
        replaced = False
        for i, line in enumerate(lines):
            m = re.search(r"(--" + target_name + r"\s*:\s*)([^;]+)(;)", line)
            if not m:
                continue
            lines[i] = line[: m.start(2)] + new_hex + line[m.end(2) :]
            replaced = True
            break
        if replaced:
            variables[target_name] = new_hex
            report.append(f"  {target_name}: {ratio:.2f} -> {new_hex}")
    open(path, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
    return report


def main():
    fix = "--fix" in sys.argv
    failing_files = 0
    for path in sorted(glob.glob(os.path.join(THEME_DIR, "*.theme.css"))):
        name = os.path.basename(path)
        variables, failures = check_file(path)
        if not failures:
            continue
        failing_files += 1
        if not fix:
            print(f"FAIL {name}")
            for fg_name, _, ratio in failures:
                bg_name = next(b for f, b in PAIRS if f == fg_name)
                print(f"  {fg_name} on {bg_name}: {ratio:.2f} (threshold {THRESHOLD})")
            continue
        print(f"FIX  {name}")
        for line in fix_file(path, variables, failures):
            print(line)

    if fix:
        print("\n--fix pass complete: review the diff, then rerun in gate mode.")
        return 0
    if failing_files:
        print(
            f"\n{failing_files} theme file(s) below {THRESHOLD}:1 — run "
            "scripts/check-theme-contrast.py --fix and review the diff."
        )
        return 1
    print("OK — all theme contrast pairs at or above 4.5:1.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
