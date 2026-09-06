# -*- coding: utf-8 -*-
# ColaMD logo generator — cola bottle cap with the Markdown M-down mark.
# Renders one 1024px master (2x supersampled) and derives every asset:
# README logo, electron-builder PNG size set, win/linux/mac app icons,
# and the in-app logos (window icon, About dialog).
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
DESK = os.path.join(ROOT, 'packages', 'desktop')

MASTER = 1024
S = 2  # supersample factor (canvas = MASTER * S)
CX = CY = MASTER * S // 2

METAL = (201, 203, 212, 255)      # silver cap
METAL_DARK = (166, 169, 180, 255) # crimp shading
RED = (232, 35, 46, 255)          # cola red
RED_DEEP = (214, 26, 38, 255)     # disc edge shading
WHITE = (255, 255, 255, 255)


def draw_logo():
    img = Image.new('RGBA', (MASTER * S, MASTER * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, 'RGBA')

    def circle(r, fill=None, width=None, outline=None):
        bbox = [CX - r * S, CY - r * S, CX + r * S, CY + r * S]
        if width is None:
            d.ellipse(bbox, fill=fill)
        else:
            d.ellipse(bbox, outline=outline, width=width)

    def arc(r, start, end, width, fill):
        bbox = [CX - r * S, CY - r * S, CX + r * S, CY + r * S]
        d.arc(bbox, start, end, fill=fill, width=width)

    def stroke_polyline(pts, w, fill=WHITE):
        scaled = [(x * S * MASTER / 512, y * S * MASTER / 512) for x, y in pts]
        d.line(scaled, fill=fill, width=int(w * S * MASTER / 512), joint='curve')
        r = w * S * MASTER / 512 / 2
        for x, y in (scaled[0], scaled[-1]):
            d.ellipse([x - r, y - r, x + r, y + r], fill=fill)

    # ── bottle cap: scalloped metal edge ──────────────────────────
    # coordinates below are in the 512 design space, scaled by MASTER/512
    k = MASTER / 512
    N = 36         # crimp bumps (overlapping → scallop, not pearls)
    RING_R = 226
    BUMP_R = 26
    for i in range(N):
        a = 2 * math.pi * i / N
        bx = CX + RING_R * k * S * math.cos(a)
        by = CY + RING_R * k * S * math.sin(a)
        r = BUMP_R * k * S
        d.ellipse([bx - r, by - r, bx + r, by + r], fill=METAL)
    circle(230 * k, METAL)                                # cap body
    circle(251 * k, width=int(3 * k * S), outline=(142, 146, 160, 255))
    circle(212 * k, width=int(10 * k * S), outline=METAL_DARK)  # crimp groove

    # ── cola red disc ─────────────────────────────────────────────
    circle(200 * k, RED)
    arc(194 * k, 20, 160, int(8 * k * S), RED_DEEP)  # shading, bottom-right

    # gloss on a separate layer so alpha blends over the red
    gloss = Image.new('RGBA', img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    r = 178 * k * S
    gd.arc([CX - r, CY - r, CX + r, CY + r], 205, 285,
           fill=(255, 255, 255, 80), width=int(12 * k * S))
    img = Image.alpha_composite(img, gloss)
    d = ImageDraw.Draw(img, 'RGBA')

    # ── Markdown M-down mark ──────────────────────────────────────
    M = [(150, 327), (150, 184), (210, 280), (270, 184), (270, 327)]
    stroke_polyline(M, 26)
    stroke_polyline([(334, 184), (334, 311)], 26)
    stroke_polyline([(305, 283), (334, 312), (363, 283)], 26)

    return img.resize((MASTER, MASTER), Image.LANCZOS)


master = draw_logo()


def save_png(path, size):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    master.resize((size, size), Image.LANCZOS).save(path)


# ── README logo ──────────────────────────────────────────────────
save_png(os.path.join(ROOT, 'docs', 'assets', 'logo-small.png'), 512)

# ── electron-builder PNG size set ────────────────────────────────
for size in (16, 24, 32, 48, 64, 128, 256, 512):
    save_png(os.path.join(DESK, 'build', 'icons', f'{size}x{size}', 'colamd.png'), size)

# ── app icons: build/ (resources) and static/ (packaged) ────────
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ICNS_SIZES = [16, 32, 64, 128, 256, 512]
frames = {s: master.resize((s, s), Image.LANCZOS) for s in (16, 24, 32, 48, 64, 128, 256, 512)}

for base in (os.path.join(DESK, 'build', 'icons'), os.path.join(DESK, 'static')):
    master.resize((512, 512), Image.LANCZOS).save(os.path.join(base, 'icon.png'))
    master.save(os.path.join(base, 'icon.ico'), format='ICO',
                sizes=ICO_SIZES, append_images=[frames[s] for s, _ in ICO_SIZES])
    master.save(os.path.join(base, 'icon.icns'), format='ICNS',
                append_images=[frames[s] for s in ICNS_SIZES])

# ── in-app logos ─────────────────────────────────────────────────
save_png(os.path.join(DESK, 'static', 'logo-96px.png'), 96)    # window icons
save_png(os.path.join(DESK, 'static', 'logo-small.png'), 1024)
save_png(os.path.join(DESK, 'src', 'renderer', 'src', 'assets', 'images', 'logo.png'), 150)  # About dialog

print('generated: README logo, 8 build PNG sizes, icon.png/ico/icns x2, in-app logos')
