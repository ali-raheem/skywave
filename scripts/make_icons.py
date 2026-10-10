#!/usr/bin/env python3
"""Draw the app icons (icon.svg plus the PNG sizes) from one geometry: the curve of the
earth, the ionosphere above it, and a signal hopping between them. Pillow only."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / 'icons'
BG = (3, 6, 11)
EARTH = (26, 42, 51)
LAYER = (127, 196, 255)
HOPS = [(255, 225, 74), (91, 227, 107), (63, 195, 255)]


def geometry(s, inset):
    m = s * inset
    w = s - 2 * m
    P = lambda x, y: (m + x * w, m + y * w)
    earth = (P(-0.6, 0.72), P(1.6, 2.4))  # a big ellipse whose top is the horizon
    layer = (P(-0.45, 0.22), P(1.45, 1.9))
    # Hop path: ground → layer → ground → layer → ground.
    pts = [P(0.1, 0.8), P(0.3, 0.34), P(0.5, 0.74), P(0.7, 0.34), P(0.9, 0.8)]
    return earth, layer, pts


def png(size, inset, rounded):
    s = size * 4
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 0.22, fill=BG)
    else:
        d.rectangle((0, 0, s, s), fill=BG)
    earth, layer, pts = geometry(s, inset)
    lw = max(2, s // 40)
    d.ellipse(layer, outline=LAYER + (110,), width=lw)
    d.ellipse(earth, fill=EARTH, outline=(140, 190, 220), width=max(2, s // 90))
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        d.line([a, b], fill=HOPS[min(i // 1, 2) if i < 3 else 2], width=lw, joint='curve')
    for p in pts[1:-1:2]:
        r = s * 0.025
        d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=(255, 255, 255))
    if rounded:
        mask = Image.new('L', (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 0.22, fill=255)
        img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def svg():
    s = 512
    earth, layer, pts = geometry(s, 0.0)
    ell = lambda box, extra: (f'<ellipse cx="{(box[0][0] + box[1][0]) / 2:.1f}" cy="{(box[0][1] + box[1][1]) / 2:.1f}" '
                              f'rx="{(box[1][0] - box[0][0]) / 2:.1f}" ry="{(box[1][1] - box[0][1]) / 2:.1f}" {extra}/>')
    lines = ''.join(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="rgb{HOPS[min(i, 2)]}" stroke-width="13" stroke-linecap="round"/>'
                    for i, (a, b) in enumerate(zip(pts, pts[1:])))
    dots = ''.join(f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="13" fill="#fff"/>' for p in pts[1:-1:2])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}">'
            f'<clipPath id="c"><rect width="{s}" height="{s}" rx="{s * 0.22:.0f}"/></clipPath>'
            f'<g clip-path="url(#c)"><rect width="{s}" height="{s}" fill="rgb{BG}"/>'
            + ell(layer, f'fill="none" stroke="rgb{LAYER}" stroke-opacity="0.45" stroke-width="13"')
            + ell(earth, f'fill="rgb{EARTH}" stroke="rgb(140,190,220)" stroke-width="6"')
            + lines + dots + '</g></svg>\n')


ROOT.mkdir(exist_ok=True)
(ROOT / 'icon.svg').write_text(svg())
png(192, 0.0, True).save(ROOT / 'icon-192.png')
png(512, 0.0, True).save(ROOT / 'icon-512.png')
png(512, 0.12, False).save(ROOT / 'icon-maskable-512.png')
png(180, 0.04, False).convert('RGB').save(ROOT / 'apple-touch-icon.png')
print('wrote', ', '.join(sorted(p.name for p in ROOT.iterdir())))
