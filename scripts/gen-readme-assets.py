#!/usr/bin/env python3
"""README visuals for dsh-lsp-actions — v5 (1440x576 hero + 1100x660 flow).

Both figures are derived from the code, not from a template:

  src/tools.ts        eight model tools (six reference-only, two write) and the
                      editor's four actions all end in one ActionRunner
  src/runner.ts       per-call seam resolution: a hit returns, `unsupported`
                      fails loud with LSP_ACTION_UNSUPPORTED (never silently
                      re-spawns a duplicate), and absent / legacy / no-provider
                      falls through to the `servers` route
  src/servers.ts      routing order ① fileGlobs ② nearest projectMarkers
                      ③ extensionToLanguage
  src/client.ts       one process per (entry, canonical workspace), lazy spawn,
                      resident didOpen/didChange, Content-Length framed JSON-RPC
  src/translate.ts    the real request method behind each action
  src/tools.ts        format / rename apply edits through the official
                      `fs/write-intent` waterfall + per-call sandbox policy
  src/render.ts       bounded render; src/editor/ reuses the same runner

  hero  (Pillow, zh/en x light/dark) — an *action ledger*, not a diagram:
        eight tool rows, each with the language-server method behind it and a
        read/write badge, plus the bounded / fail-loud facts underneath.

  flow  (hand-written SVG, light/dark) — grammar: a ROUND TRIP (loop), not a
        row of five boxes. Top leg = request: the two entry surfaces collapse
        into ActionRunner, which splits into the preferred `ctx.lsp` seam track
        (solid) and the fallback `servers` -> built-in stdio track (dashed),
        both landing on one language server. Bottom leg = return: normalise +
        bounds, then the one-way write valve only format/rename enters, then
        the render back into the caller. An up-channel on the left margin
        closes the loop; the stable LSP_ACTION_* codes ride the footer rail.

Labels inside the SVG are command tokens plus short Chinese notes, so the
light/dark pair is shared by all five README languages; only the hero carries
localised prose.

Outputs (idempotent overwrite):
  docs/assets/dsh-lsp-actions-hero-{zh,en}-{light,dark}.webp
  docs/assets/dsh-lsp-actions-flow-v5-{light,dark}.svg

The previous single-skin assets (dsh-lsp-actions-flow.svg, ...-hero.png) stay
on disk untouched so external links keep resolving; the READMEs stop pointing
at them.

Run:  python scripts/gen-readme-assets.py
Needs: Pillow + msyh.ttc / msyhbd.ttc / consola.ttf (a CJK font is mandatory:
       Chinese must never render as tofu boxes).
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'assets')

FONT_CJK = r'C:\Windows\Fonts\msyh.ttc'
FONT_CJK_BOLD = r'C:\Windows\Fonts\msyhbd.ttc'
FONT_MONO = r'C:\Windows\Fonts\consola.ttf'
FONT_MONO_BOLD = r'C:\Windows\Fonts\consolab.ttf'
for _p in (FONT_CJK, FONT_CJK_BOLD, FONT_MONO):
    if not os.path.exists(_p):
        raise SystemExit(f'FATAL: font missing: {_p}  (CJK must never render as '
                         f'tofu boxes; install msyh.ttc / msyhbd.ttc / consola.ttf)')
FONT_MONO_BOLD = FONT_MONO_BOLD if os.path.exists(FONT_MONO_BOLD) else FONT_CJK_BOLD

KIND = {'cjk': FONT_CJK, 'cjk_bold': FONT_CJK_BOLD, 'mono': FONT_MONO,
        'mono_bold': FONT_MONO_BOLD}

# --- palette: family accent + the two mandated page gradients ---------------
SKIN = {
    'light': dict(bg_from='#f9f6fd', bg_to='#e4eaf8', card='#ffffff',
                  card_edge='#e4e1ee', edge='#e4e1ee', zone='#f7f5fc',
                  text='#141419',
                  sub='#4d5261', faint='#8f94a4', accent='#4B67B4',
                  accent2='#6d80c4', ok='#16a34a', warn='#bc4c00',
                  fail='#cf222e', pill='#ece7f9', ok_pill='#e6f4ea',
                  warn_pill='#fbeadf', grid='#e7e4f0', shadow=(32, 26, 64)),
    'dark': dict(bg_from='#131a2a', bg_to='#0c1016', card='#1b2231',
                 card_edge='#2e374b', edge='#2e374b', zone='#202839',
                 text='#f0f3f9',
                 sub='#a8b1c4', faint='#737b8d', accent='#8496f5',
                 accent2='#a9b7f8', ok='#3fb950', warn='#d29922',
                 fail='#f85149', pill='#242d42', ok_pill='#1d3a2a',
                 warn_pill='#3a2b1c', grid='#2a3348', shadow=(0, 0, 0)),
}

W, H = 1440, 576


def font(size: float, kind: str = 'cjk_bold') -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(KIND[kind], int(round(size)))


def hx(s: str) -> tuple[int, int, int]:
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def gradient(w: int, h: int, c1: str, c2: str) -> Image.Image:
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = 0.2 * (y / h) + 0.8 * (y / h) ** 1.5
        d.line([(0, y), (w, y)],
               fill=tuple(int(p + (q - p) * t) for p, q in zip(hx(c1), hx(c2))))
    return img


def glow(img: Image.Image, cx: int, cy: int, r: int, color, alpha: int = 26):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(10, 0, -1):
        rr = r * i / 10
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  fill=color + (int(alpha * (1 - i / 11)),))
    return Image.alpha_composite(img.convert('RGBA'),
                                 layer).convert('RGB')


def card(img, box, skin, radius=20, shadow=16, fill=None, edge=None, width=2):
    """Rounded card with a soft, offset shadow."""
    x0, y0, x1, y1 = box
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    for i in range(shadow, 0, -2):
        sd.rounded_rectangle([x0 - i // 5, y0 + i // 2, x1 + i // 5, y1 + i],
                             radius=radius + i // 4,
                             fill=skin['shadow'] + (int(7 * (1 - i / shadow)),))
    base = Image.alpha_composite(img.convert('RGBA'),
                                 sh.filter(ImageFilter.GaussianBlur(9)))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=radius, fill=hx(fill or skin['card']),
                        outline=hx(edge or skin['card_edge']), width=width)
    return base.convert('RGB')


def pill(img, xy, text, skin, size=17, fg=None, bg=None, kind='cjk_bold'):
    d = ImageDraw.Draw(img)
    f = font(size, kind)
    tw = d.textlength(text, font=f)
    x, y = xy
    h = size + 15
    d.rounded_rectangle([x, y, x + tw + 28, y + h], radius=h // 2,
                        fill=hx(bg or skin['pill']))
    d.text((x + 14, y + 6), text, font=f, fill=hx(fg or skin['accent']))


def fitted(d, text, kind, size, maxw, floor=13):
    """Largest font <= size whose rendered width stays inside maxw."""
    size = int(size)
    while size > floor:
        f = font(size, kind)
        if d.textlength(text, font=f) <= maxw:
            return f, size
        size -= 1
    return font(floor, kind), floor


# ---------------------------------------------------------------------------
# hero copy — only prose is localised; every right-hand label is a token
# ---------------------------------------------------------------------------
HERO = {
    'zh': dict(
        kicker='DeepSeek Harness · LSP 动作面',
        value=['八个动作，全由真服务器作答', 'seam 优先，内置 stdio 兜底'],
        sub=['诊断 · 格式化 · 补全 · 代码动作 · 符号 · 签名',
             '内联提示 · 重命名；六个只读，两个写盘'],
        meta='单 host 行 · 懒启动服务器 · 默认只读 · 无网络 · DSH ≥0.2.1 <0.3.0',
        foot='Apache-2.0 · 社区插件，与 DeepSeek 官方无关',
        p_head='动作面 · 8 个工具 · 服务器方法',
        p_legend='R 只读 · W 写盘',
        p_foot='lsp.actions.* 复用同一条 runner：list / run / events · 结果有界 · 不联网',
    ),
    'en': dict(
        kicker='DeepSeek Harness · LSP action surface',
        value=['Eight actions, real servers', 'Seam first, stdio fallback'],
        sub=['diagnostics · format · completion · code action',
             'symbols · signature · inlay hints · rename',
             'six read-only, two write'],
        meta='single host row · lazy servers · no network · DSH >=0.2.1 <0.3.0',
        foot='Apache-2.0 · community plugin, not affiliated with DeepSeek',
        p_head='8 tools · the server method behind each',
        p_legend='R read-only · W writes',
        p_foot='lsp.actions.* reuses the same runner: list / run / events · bounded · no network',
    ),
}

# (tool, method, read/write) — methods straight from src/translate.ts:requestMethod.
LEDGER = [
    ('lsp_diagnostics', 'textDocument/diagnostic', 'R'),
    ('lsp_format', 'textDocument/formatting (+range)', 'W'),
    ('lsp_completion', 'textDocument/completion', 'R'),
    ('lsp_code_action', 'textDocument/codeAction', 'R'),
    ('lsp_symbols', 'workspace/symbol · documentSymbol', 'R'),
    ('lsp_signature', 'textDocument/signatureHelp', 'R'),
    ('lsp_inlay_hints', 'textDocument/inlayHint', 'R'),
    ('lsp_rename', 'textDocument/rename', 'W'),
]


def hero(skin: str, lang: str) -> Image.Image:
    s = SKIN[skin]
    c = HERO[lang]
    img = gradient(W, H, s['bg_from'], s['bg_to'])
    img = glow(img, 1140, 60, 300,
               hx(s['accent'] if skin == 'light' else s['accent2']), 20)
    img = glow(img, 180, 530, 280, hx(s['accent2']), 11)
    d = ImageDraw.Draw(img)

    # ---------------- left column -----------------------------------------
    lx, lmax = 64, 600
    pill(img, (lx, 58), c['kicker'], s, size=19, fg=s['accent'], bg=s['pill'])
    d = ImageDraw.Draw(img)

    tfont, _ = fitted(d, 'dsh-lsp-actions', 'cjk_bold', 79, 620, floor=48)
    d.text((lx, 110), 'dsh-lsp-actions', font=tfont, fill=hx(s['text']))

    vy = 228
    for line in c['value']:
        f, _ = fitted(d, line, 'cjk_bold', 38, lmax, floor=24)
        d.text((lx, vy), line, font=f, fill=hx(s['text']))
        vy += 50

    vy = 344
    for line in c['sub']:
        f, _ = fitted(d, line, 'cjk', 25, 630, floor=15)
        d.text((lx, vy), line, font=f, fill=hx(s['sub']))
        vy += 33

    mf, _ = fitted(d, c['meta'], 'cjk', 20, 620, floor=12)
    d.text((lx, 456), c['meta'], font=mf, fill=hx(s['faint']))

    d.text((lx, 504), c['foot'], font=font(17, 'cjk'), fill=hx(s['faint']))

    # ---------------- right panel: action ledger ---------------------------
    px0, py0, px1, py1 = 700, 78, 1392, 500
    img = card(img, (px0, py0, px1, py1), s, radius=22, shadow=18)
    d = ImageDraw.Draw(img)

    d.text((px0 + 24, py0 + 20), c['p_head'], font=font(15, 'cjk_bold'),
           fill=hx(s['text']))
    legend_f = font(12, 'cjk')
    d.text((px1 - 24 - d.textlength(c['p_legend'], font=legend_f), py0 + 23),
           c['p_legend'], font=legend_f, fill=hx(s['faint']))
    d.line([(px0 + 24, py0 + 50), (px1 - 24, py0 + 50)], fill=hx(s['grid']), width=1)

    cw = (px1 - px0 - 48 - 18) // 2
    rows = [LEDGER[0:4], LEDGER[4:8]]
    row_h = 74
    for col, column in enumerate(rows):
        cx = px0 + 24 + col * (cw + 18)
        for i, (tool, method, rw) in enumerate(column):
            cy = py0 + 58 + i * row_h
            if i:
                d.line([(cx, cy - 8), (cx + cw, cy - 8)],
                       fill=hx(s['grid']), width=1)
            d.text((cx + 10, cy + 4), tool, font=font(16, 'mono_bold'),
                   fill=hx(s['text']))
            mf2, _ = fitted(d, method, 'mono', 13, cw - 78, floor=11)
            d.text((cx + 10, cy + 28), method, font=mf2, fill=hx(s['sub']))
            badge_fg = s['ok'] if rw == 'R' else s['warn']
            badge_bg = s['ok_pill'] if rw == 'R' else s['warn_pill']
            bw, bh = 30, 24
            bx, by = cx + cw - bw - 6, cy + 10
            d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=9,
                                fill=hx(badge_bg))
            bf = font(13, 'mono_bold')
            d.text((bx + bw / 2 - d.textlength(rw, font=bf) / 2, by + 3),
                   rw, font=bf, fill=hx(badge_fg))

    d.line([(px0 + 24, py1 - 46), (px1 - 24, py1 - 46)],
           fill=hx(s['grid']), width=1)
    pf, _ = fitted(d, c['p_foot'], 'cjk', 13, px1 - px0 - 48, floor=11)
    d.text((px0 + 24, py1 - 34), c['p_foot'], font=pf, fill=hx(s['faint']))
    return img


# ---------------------------------------------------------------------------
# flow SVG (light + dark) — grammar: round trip / loop
# ---------------------------------------------------------------------------
SANS = ("'Segoe UI','Microsoft YaHei','PingFang SC','Noto Sans CJK SC',"
        "system-ui,sans-serif")
MONO = ("'Cascadia Mono',Consolas,'SFMono-Regular',Menlo,'Microsoft YaHei',"
        "monospace")


def esc(t: str) -> str:
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def tw(text: str, size: float, mono: bool = False) -> float:
    """Rough advance width: CJK full-width, ASCII ~0.56em (0.6em mono)."""
    w = 0.0
    for ch in text:
        if ord(ch) > 0x2E80:
            w += size
        else:
            w += size * (0.6 if mono else 0.56)
    return w


class Svg:
    def __init__(self, w: int, h: int, s: dict):
        self.w, self.h, self.s = w, h, s
        self.p: list[str] = []

    def add(self, raw: str):
        self.p.append(raw)

    def rect(self, x, y, w, h, r=16, fill='none', stroke='none', sw=1.5,
             dash=None):
        extra = f' stroke-dasharray="{dash}"' if dash else ''
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" '
                 f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{extra}/>')

    def text(self, x, y, t, size=12, fill=None, weight=400, mono=False,
             anchor='start', maxw=None):
        if maxw is not None:
            w = tw(t, size, mono)
            if w > maxw:
                raise ValueError(f'SVG text overflows its box ({w:.0f} > '
                                 f'{maxw:.0f}): {t!r}')
        fam = MONO if mono else SANS
        self.add(f'<text x="{x}" y="{y}" fill="{fill or self.s["text"]}" '
                 f'font-family="{fam}" font-size="{size}" '
                 f'font-weight="{weight}" text-anchor="{anchor}">'
                 f'{esc(t)}</text>')

    def pill(self, x, y, t, size=10, fg=None, bg=None, mono=True, pad=9):
        w = tw(t, size, mono) + pad * 2
        h = size + 12
        self.rect(x, y, w, h, r=h / 2, fill=bg or self.s['pill'], stroke='none')
        self.text(x + pad, y + h - 4, t, size=size, fill=fg or self.s['accent'],
                  weight=700, mono=mono)
        return w, h

    def arrow(self, pts, color, sw=2, dash=None, head=7):
        d = 'M' + f'{pts[0][0]} {pts[0][1]}'
        for x, y in pts[1:]:
            d += f'L{x} {y}'
        extra = f' stroke-dasharray="{dash}"' if dash else ''
        self.add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}"'
                 f' stroke-linecap="round" stroke-linejoin="round"{extra}/>')
        (x1, y1), (x2, y2) = pts[-2], pts[-1]
        if x1 == x2:
            sgn = 1 if y2 > y1 else -1
            self.add(f'<path d="M{x2 - head} {y2 - sgn * head}L{x2} {y2}'
                     f'L{x2 + head} {y2 - sgn * head}" fill="none" '
                     f'stroke="{color}" stroke-width="{sw}" '
                     f'stroke-linecap="round" stroke-linejoin="round"/>')
        else:
            sgn = 1 if x2 > x1 else -1
            self.add(f'<path d="M{x2 - sgn * head} {y2 - head}L{x2} {y2}'
                     f'L{x2 - sgn * head} {y2 + head}" fill="none" '
                     f'stroke="{color}" stroke-width="{sw}" '
                     f'stroke-linecap="round" stroke-linejoin="round"/>')


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    g = Svg(1100, 660, {
        'text': s['text'], 'sub': s['sub'], 'faint': s['faint'],
        'card': s['card'], 'edge': s['card_edge'], 'zone': s['zone'],
        'accent': s['accent'], 'ok': s['ok'], 'warn': s['warn'],
        'grid': s['grid'], 'pill': s['pill'],
        'ok_pill': s['ok_pill'], 'warn_pill': s['warn_pill'],
    })
    g.add('<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="660" '
          'viewBox="0 0 1100 660" role="img" aria-labelledby="t d">')
    g.add('<title id="t">dsh-lsp-actions 结构图：请求-回传环</title>')
    g.add('<desc id="d">八个工具与编辑器协议汇入 ActionRunner；优先走 ctx.lsp '
          'seam，缺席/旧版/无 provider 时回落到 servers 路由与内置 stdio 客户端；'
          '语言服务器作答后经有界归一化回传，只有格式化与重命名穿过写入单向阀。</desc>')
    g.add('<defs>')
    g.add(f'<linearGradient id="page" x1="0" y1="0" x2="0.4" y2="1">'
          f'<stop offset="0" stop-color="{s["bg_from"]}"/>'
          f'<stop offset="1" stop-color="{s["bg_to"]}"/></linearGradient>')
    g.add('</defs>')
    g.add('<rect width="1100" height="660" rx="20" fill="url(#page)"/>')

    # ---------------- header ------------------------------------------------
    g.text(40, 46, 'dsh-lsp-actions', size=27, weight=700)
    g.text(40, 76, '八个工具 + 编辑器协议 → ActionRunner → seam 优先 / stdio 兜底 '
                   '→ 语言服务器 → 有界回传；写动作走单向阀',
           size=14.5, fill=s['sub'])
    g.add(f'<rect x="40" y="88" width="1020" height="1" fill="{s["grid"]}"/>')

    # ---------------- loop framing -----------------------------------------
    g.text(64, 108, '① 请求 · 出站', size=11, fill=s['accent'], weight=700)
    g.text(64, 408, '② 结果 · 回传', size=11, fill=s['ok'], weight=700)

    # left return channel closes the loop: render card -> entry surface
    g.arrow([(64, 477), (44, 477), (44, 156), (62, 156)], s['ok'], sw=2)
    g.add('<g transform="translate(34 300) rotate(-90)">')
    g.text(0, 0, '回环 · 结果回到调用方', size=11, fill=s['ok'], anchor='middle')
    g.add('</g>')

    # ---------------- entry surfaces ---------------------------------------
    ex, ew = 64, 196
    g.rect(ex, 120, ew, 124, r=16, fill=s['card'], stroke=s['edge'])
    g.text(ex + 14, 146, 'lsp_* 工具 ×8', size=15, weight=700)
    g.text(ex + 14, 164, '6 只读 · 2 写盘', size=11, fill=s['faint'])
    for i, t in enumerate(['diagnostics · format', 'completion · code_action',
                           'symbols · signature', 'inlay_hints · rename']):
        g.text(ex + 14, 184 + i * 16, t, size=11.5, fill=s['sub'], mono=True,
               maxw=ew - 28)

    g.rect(ex, 252, ew, 128, r=16, fill=s['card'], stroke=s['edge'])
    g.text(ex + 14, 278, 'lsp.actions.*', size=15, weight=700)
    g.text(ex + 14, 296, '编辑器 JSON-RPC v1', size=11, fill=s['faint'])
    for i, t in enumerate(['list · run · events', 'lsp.event 通知流',
                           'editor.enabled 才启动']):
        g.text(ex + 14, 316 + i * 16, t, size=11.5, fill=s['sub'],
               maxw=ew - 28)

    # ---------------- ActionRunner hub -------------------------------------
    hx0, hw = 276, 182
    g.rect(hx0, 120, hw, 260, r=18, fill=s['card'], stroke=s['accent'], sw=2)
    g.add(f'<rect x="{hx0 + 16}" y="140" width="3" height="40" '
          f'fill="{s["accent"]}"/>')
    g.text(hx0 + 28, 148, 'ActionRunner', size=16, weight=700, mono=True)
    g.text(hx0 + 16, 172, 'provider 接口 · 9 个操作', size=11.5, fill=s['sub'])
    g.add(f'<rect x="{hx0 + 16}" y="186" width="{hw - 32}" height="1" '
          f'fill="{s["grid"]}"/>')
    for i, t in enumerate(['工具只依赖接口', '内置 runner 是其一',
                           '第三方 provider 可替换', 'seam 逐调用解析',
                           '命中即返回，不重开进程']):
        g.add(f'<circle cx="{hx0 + 21}" cy="{205 + i * 25}" r="2.4" '
              f'fill="{s["accent"]}"/>')
        g.text(hx0 + 31, 209 + i * 25, t, size=11.5, fill=s['sub'])
    g.add(f'<rect x="{hx0 + 16}" y="330" width="{hw - 32}" height="1" '
          f'fill="{s["grid"]}"/>')
    g.text(hx0 + 16, 356, '8 工具 + 4 编辑器动作共用', size=11, fill=s['faint'])

    # entries -> runner
    g.arrow([(260, 179), (276, 179)], s['accent'], sw=2)
    g.arrow([(260, 313), (276, 313)], s['accent'], sw=2)

    # ---------------- preferred track: ctx.lsp seam ------------------------
    sx0, sw_ = 482, 262
    g.rect(sx0, 120, sw_, 98, r=16, fill=s['card'], stroke=s['accent'], sw=2)
    g.pill(sx0 + sw_ - 58, 131, '优先', size=10, fg=s['accent'], bg=s['pill'])
    g.text(sx0 + 16, 148, 'ctx.lsp 扩展 seam', size=15, weight=700, mono=True)
    g.text(sx0 + 16, 170, 'diagnostics / format / completion', size=11,
           fill=s['sub'], mono=True, maxw=sw_ - 32)
    g.text(sx0 + 16, 190, '命中即返回；unsupported → 响亮失败', size=11,
           fill=s['sub'], maxw=sw_ - 32)
    g.text(sx0 + 16, 206, 'LSP_ACTION_UNSUPPORTED · 不回退', size=11,
           fill=s['warn'], mono=True, maxw=sw_ - 32)

    # runner -> seam (solid, preferred)
    g.arrow([(458, 169), (482, 169)], s['accent'], sw=2)

    # ---------------- fallback track: servers + stdio client ---------------
    fx0, fy0, fw_, fh = 482, 236, 262, 144
    g.rect(fx0, fy0, fw_, fh, r=16, fill=s['card'], stroke=s['edge'], dash='6 5')
    g.pill(fx0 + fw_ - 54, fy0 + 9, '兜底', size=10, fg=s['sub'], bg=s['zone'])
    g.text(fx0 + 16, fy0 + 26, '内置 stdio 客户端', size=15, weight=700)
    g.text(fx0 + 16, fy0 + 45, 'seam 缺席 · 旧版 · 该文件无 provider', size=11,
           fill=s['faint'], maxw=fw_ - 32)
    for i, t in enumerate(['① fileGlobs  ② projectMarkers',
                           '③ extensionToLanguage 路由',
                           'spawn · Content-Length JSON-RPC',
                           '常驻 didOpen · JSON-RPC 帧']):
        g.text(fx0 + 16, fy0 + 64 + i * 18, t, size=11.5, fill=s['sub'],
               mono=True, maxw=fw_ - 32)
    g.text(fx0 + 16, fy0 + 134, '路由无命中 → LSP_ACTION_UNAVAILABLE',
           size=11, fill=s['warn'], mono=True, maxw=fw_ - 32)

    # runner -> fallback (dashed)
    g.arrow([(458, 309), (482, 309)], s['sub'], sw=1.8, dash='5 5')

    # ---------------- language server --------------------------------------
    vx, vw = 786, 274
    g.rect(vx, 120, vw, 260, r=18, fill=s['card'], stroke=s['accent'], sw=2)
    g.text(vx + 18, 148, '语言服务器', size=16, weight=700)
    g.text(vx + 18, 170, '真实进程 · 不是 mock', size=11.5, fill=s['sub'])
    for i, t in enumerate(['typescript-language-server', 'gopls · pyright',
                           'rust-analyzer', '任何 stdio LSP 服务器']):
        g.rect(vx + 18, 184 + i * 34, vw - 36, 26, r=8, fill=s['zone'])
        g.text(vx + 28, 201 + i * 34, t, size=11.5, fill=s['text'], mono=True,
               maxw=vw - 56)
    g.add(f'<rect x="{vx + 18}" y="336" width="{vw - 36}" height="1" '
          f'fill="{s["grid"]}"/>')
    g.text(vx + 18, 356, 'initialize → capabilities', size=11, fill=s['faint'],
           maxw=vw - 36)
    g.text(vx + 18, 372, '懒启动 · idleTimeoutMs 0 常驻', size=11,
           fill=s['faint'], maxw=vw - 36)

    # seam / fallback -> server
    g.arrow([(744, 169), (786, 169)], s['accent'], sw=2)
    g.arrow([(744, 309), (786, 309)], s['sub'], sw=1.8, dash='5 5')

    # ---------------- return leg -------------------------------------------
    g.arrow([(923, 380), (923, 414)], s['ok'], sw=2)

    # read-only results bypass the valve: dashed short-cut over the return row
    g.arrow([(800, 414), (800, 398), (430, 398), (430, 414)], s['ok'],
            sw=1.6, dash='5 4')
    g.text(615, 391, '只读结果直通（6 / 8）', size=11, fill=s['ok'],
           anchor='middle', weight=700)

    # normalise + bounds
    nx0, ny0, nw_, nh = 786, 414, 274, 126
    g.rect(nx0, ny0, nw_, nh, r=16, fill=s['card'], stroke=s['ok'], sw=1.6)
    g.text(nx0 + 16, ny0 + 24, '归一化 + 有界', size=15, weight=700)
    bounds = [('maxDiagnostics 200 · maxSymbols 100', True),
              ('maxResultChars 16000', True),
              ('maxDocumentBytes 4000000', True),
              ('timeoutMs 60000', True),
              ('编辑器 LRU 缓存 64 文件 · 不落盘', False)]
    for i, (t, is_mono) in enumerate(bounds):
        g.text(nx0 + 16, ny0 + 46 + i * 17, t, size=11, fill=s['sub'],
               mono=is_mono, maxw=nw_ - 32)

    # normalise -> write valve (the conditional write path)
    g.arrow([(786, 462), (746, 462)], s['warn'], sw=1.8)

    # write valve
    wx0, wy0, ww_, wh = 482, 414, 262, 126
    g.rect(wx0, wy0, ww_, wh, r=16, fill=s['card'], stroke=s['warn'], sw=1.8)
    g.pill(wx0 + ww_ - 78, wy0 + 9, '仅 2 / 8', size=10, fg=s['warn'],
           bg=s['warn_pill'])
    g.text(wx0 + 16, wy0 + 26, '写入单向阀', size=15, weight=700)
    for i, t in enumerate(['① UTF-16 偏移应用服务器编辑',
                           '② 重叠 / 越界 → LSP_ACTION_CONFLICT',
                           '③ fs/write-intent 观测→守卫写→观测',
                           '④ sandbox · read-only 往返前拒绝',
                           '⑤ diff · linesChanged 回传']):
        g.text(wx0 + 16, wy0 + 48 + i * 17, t, size=11, fill=s['sub'],
               maxw=ww_ - 32)

    # write valve -> render
    g.arrow([(482, 462), (446, 462)], s['warn'], sw=1.8)

    # render / back to caller
    rx0, ry0, rw_, rh = 64, 414, 380, 126
    g.rect(rx0, ry0, rw_, rh, r=16, fill=s['card'], stroke=s['edge'])
    g.text(rx0 + 16, ry0 + 24, '渲染 · 返回调用方', size=15, weight=700)
    for i, t in enumerate(['诊断文本 / 补全列表 / diff 卡片',
                           'presenter 纯函数：直播与重放同源',
                           '工具结果只存在于会话日志']):
        g.text(rx0 + 16, ry0 + 48 + i * 18, t, size=11, fill=s['sub'])
    g.text(rx0 + 16, ry0 + 112, '↺ 回到入口，下一轮动作重新解析 seam',
           size=10.5, fill=s['faint'])

    # ---------------- footer rail: stable error codes ----------------------
    g.add(f'<rect x="40" y="556" width="1020" height="1" fill="{s["grid"]}"/>')
    g.text(40, 578, '错误码 · 按 code 路由，绝不解析消息文本', size=12,
           fill=s['sub'], weight=700)
    g.text(1060, 578, '共 12 个稳定 code', size=11, fill=s['faint'],
           anchor='end')
    x = 40
    for code in ('LSP_ACTION_UNAVAILABLE', 'LSP_ACTION_UNSUPPORTED',
                 'LSP_ACTION_SERVER_FAILED', 'LSP_ACTION_CONFLICT',
                 'LSP_ACTION_READ_ONLY'):
        w, _ = g.pill(x, 587, code, size=11, fg=s['sub'], bg=s['zone'])
        x += w + 9
    g.text(40, 636, '默认只读 · 单 host 行（inject: tools / fs / subprocess）· '
                    '无网络 · 有界 · servers: {} 不激活任何服务器，调用时响亮失败',
           size=11, fill=s['faint'])
    g.add('</svg>')
    return '\n'.join(g.p) + '\n'


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ('light', 'dark'):
        for lang in ('zh', 'en'):
            img = hero(skin, lang)
            path = os.path.join(OUT, f'dsh-lsp-actions-hero-{lang}-{skin}.webp')
            img.save(path, 'WEBP', quality=90, method=6)
            print('wrote', os.path.relpath(path, ROOT))
    for skin in ('light', 'dark'):
        path = os.path.join(OUT, f'dsh-lsp-actions-flow-v5-{skin}.svg')
        with open(path, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(flow_svg(skin))
        print('wrote', os.path.relpath(path, ROOT))


if __name__ == '__main__':
    main()
