#!/usr/bin/env python3
"""Generate README image assets for dsh-lsp-actions (docs/assets/).

Outputs (idempotent overwrite):
  dsh-lsp-actions-flow-light.svg / dsh-lsp-actions-flow-dark.svg
      Hero flow diagram. Two hand-written SVG files (vector — never
      rasterized to webp). Text inside is command-surface tokens only
      (`lsp_*`, `ctx.lsp`, `servers`, `stdio JSON-RPC`, `fs/write-intent`,
      `LSP_ACTION_*`), so all five README languages share the same pair.

No evidence chart is produced: this repository has no benchmark/RESULTS.md
or other measured dataset to quote, and the playbook forbids inventing one.
The previous single-skin hero (`dsh-lsp-actions-flow.svg`, `…-hero.png`) and
the demo gif stay in docs/assets untouched so existing external links keep
resolving; the READMEs reference only the new pair.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (pip install pillow) — used here for the CJK font probe
           and kept so a future raster asset can reuse the palette/probe.
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont  # noqa: F401  (skeleton keeps the raster path ready)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
ORANGE = {"light": "#bc4c00", "dark": "#d29922"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}

# --- CJK font probe: Chinese must never render as tofu boxes ----------------
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",      # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",    # SimHei
    r"C:\Windows\Fonts\Deng.ttf",      # DengXian
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
if FONT_PATH is None:
    sys.exit("FATAL: no CJK font found (looked for msyh.ttc, simhei.ttf, "
             "Deng.ttf, Noto Sans CJK, PingFang). Refusing to render Chinese "
             "as tofu boxes; install one of the probed fonts and re-run.")


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)


# ---------------------------------------------------------------------------
# Hero action-flow SVG (light + dark). Tokens only — no prose sentences.
# ---------------------------------------------------------------------------
FLOW_NODES = [
    ("lsp_* ×8", "tools"),
    ("ActionRunner", "provider seam"),
    ("ctx.lsp / servers", "seam-first"),
    ("stdio JSON-RPC", "subprocess"),
    ("LSP server", "tsls · gopls · pyright"),
]

MONO = "ui-monospace,SFMono-Regular,Menlo,monospace"
SANS = "ui-sans-serif,system-ui,-apple-system,sans-serif"


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    w, h = 1200, 440
    nw, nh, gap = 186, 92, 40
    y0 = 146
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" '
        f'aria-label="dsh-lsp-actions action flow">',
        '<title>dsh-lsp-actions action flow</title>',
        f'<rect width="{w}" height="{h}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="60" y="62" fill="{s["text"]}" font-family="{SANS}" '
        f'font-size="30" font-weight="700">dsh-lsp-actions</text>',
        f'<text x="60" y="94" fill="{s["sub"]}" font-family="{MONO}" '
        f'font-size="16">lsp_* ×8 · lsp.actions.* · ctx.lsp · '
        f'stdio JSON-RPC</text>',
        f'<line x1="60" y1="116" x2="1140" y2="116" stroke="{s["border"]}"/>',
    ]
    for i, (label, sub) in enumerate(FLOW_NODES):
        x = 60 + i * (nw + gap)
        accent = GREEN[skin] if i == len(FLOW_NODES) - 1 else (
            FAMILY if i == 1 else s["border"])
        parts.append(
            f'<rect x="{x}" y="{y0}" width="{nw}" height="{nh}" rx="14" '
            f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 40}" fill="{s["text"]}" '
            f'text-anchor="middle" font-family="{MONO}" font-size="15" '
            f'font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 66}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="{MONO}" font-size="12">'
            f'{sub}</text>')
        if i < len(FLOW_NODES) - 1:
            ax = x + nw + 5
            ay = y0 + nh // 2
            parts.append(
                f'<path d="M{ax} {ay}h{gap - 12}" stroke="{s["sub"]}" '
                f'stroke-width="3"/>')
            parts.append(
                f'<path d="M{ax + gap - 13} {ay - 7}l10 7-10 7" fill="none" '
                f'stroke="{s["sub"]}" stroke-width="3" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')
    # editor protocol branch: ActionRunner (node 2) fed from below
    runner_cx = 60 + 1 * (nw + gap) + nw // 2
    bar_x, bar_w, bar_y, bar_h = 190, 820, 286, 52
    parts.append(
        f'<path d="M{runner_cx} {y0 + nh}v{bar_y - y0 - nh}" '
        f'stroke="{FAMILY}" stroke-width="2" stroke-dasharray="5 5"/>')
    parts.append(
        f'<rect x="{bar_x}" y="{bar_y}" width="{bar_w}" height="{bar_h}" '
        f'rx="12" fill="{s["box"]}" stroke="{FAMILY}" stroke-width="2"/>')
    parts.append(
        f'<text x="{bar_x + bar_w // 2}" y="{bar_y + 33}" fill="{s["text"]}" '
        f'text-anchor="middle" font-family="{MONO}" font-size="14">'
        f'lsp.actions.list · lsp.actions.run · lsp.events</text>')
    # write path + stable error codes (tokens only)
    parts.append(
        f'<text x="60" y="388" fill="{s["sub"]}" font-family="{MONO}" '
        f'font-size="13">fs/write-intent · sandbox_permissions + '
        f'justification · read-only</text>')
    parts.append(
        f'<text x="60" y="412" fill="{s["sub"]}" font-family="{MONO}" '
        f'font-size="13">LSP_ACTION_READ_ONLY · LSP_ACTION_CONFLICT · '
        f'LSP_ACTION_UNAVAILABLE</text>')
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        with open(os.path.join(OUT, f"dsh-lsp-actions-flow-{skin}.svg"),
                  "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    print("wrote 2 SVG assets to docs/assets/")


if __name__ == "__main__":
    main()
