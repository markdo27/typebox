# RASTER.PRESS

A pixel typography creative playground — build bold, expressive letter art directly in the browser. No installs, no dependencies, pure HTML + CSS + JavaScript.

![RASTER.PRESS](https://img.shields.io/badge/status-live-brightgreen?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

---

## What it does

RASTER.PRESS rasterizes large letters onto a configurable cell grid, then fills each cell with a small repeated character. Every letter can be individually transformed, colored, and animated.

```
B I G   T E X T
↓ rasterized onto grid
┌─┬─┬─┬─┬─┬─┬─┐
│O│O│█│█│O│O│O│   █ = stroke (white)
│O│█│O│O│█│O│O│   O = fill character (colored)
│O│█│O│O│█│O│O│
│O│O│█│█│O│O│O│
└─┴─┴─┴─┴─┴─┴─┘
```

---

## Features

### Global Controls
| Control | Description |
|---------|-------------|
| **Big Text** | The letters to render (up to 10 characters) |
| **Fill Character** | Small character tiled into each non-stroke cell |
| **Pixel Height** | Height of each cell in px — controls overall scale |
| **Width Ratio** | Horizontal squeeze of the rasterized letter |
| **Letter Spacing** | Gap between letters (supports negative for overlap) |
| **Ink Threshold** | Rasterizer cutoff — lower = bolder strokes |
| **Fill Density** | Fraction of fill cells rendered (0 = sparse, 1 = full) |
| **Canvas Padding** | Breathing room added around the auto-cropped canvas |

### Colors & Gradient
- **Background**, **Fill Color**, **Stroke Color** pickers
- **Gradient** — None / Horizontal / Vertical / Radial, with From/To color pickers
- **5 quick presets** — Blue, Red, Gold, Mono, Neon

### Layout
- **Horizontal / Vertical / Grid** arrangement
- **Letter alignment** — Top / Center / Bottom
- **Allow Overlap** — letters can share space for tight layouts

### Per-Letter Overrides
Click any letter on the canvas to open a per-letter panel:
- Rotation (–180° → 180°)
- Scale (0.2× → 3×)
- Skew / italic (–45° → 45°)
- Individual fill color
- Individual fill character
- Drag to reposition
- Rotate via yellow handle, scale via blue corner handles

### Animation
| Mode | Effect |
|------|--------|
| **Colors** | Continuously cycles hue through gradient A/B |
| **Grain** | Randomises film grain on each frame |
| **Both** | Colors + Grain simultaneously |

Speed slider + 📷 **Snapshot** button to export a single animated frame.

### Export
- **Download PNG** — exports at 3× resolution (Ctrl+S shortcut)
- Filename format: `RASTER_PRESS_<TEXT>_<timestamp>.png`

---

## Getting started

No build step required.

```bash
git clone https://github.com/markdo27/typebox.git
cd typebox
# Open index.html in your browser
```

Or just open `index.html` directly — it runs fully offline (only Google Fonts requires a network connection).

---

## Project structure

```
typebox/
├── index.html      # App shell, controls, canvas
├── style.css       # Design system + UI styles
└── app.js          # Render engine, animation, interaction
```

### Engine overview (`app.js`)

| Layer | Responsibility |
|-------|---------------|
| `rasterizeCharacter` | Renders letter to offscreen canvas, samples pixel grid |
| `generateLetterGrid` | Converts pixel samples to BG / Stroke / Fill cell map |
| `mergeBlocks` | Run-length merges adjacent same-type cells for efficiency |
| `renderLetter` | Draws merged blocks with per-letter transforms (rotate/scale/skew) |
| `renderChar` | Fills a single cell with the fill character, scaled to fit |
| `doRender` | Orchestrates layout, gradient, grain, handles, label |
| `startAnimation` | `requestAnimationFrame` loop for color/grain animation |

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl + S` | Download PNG |
| `Ctrl + Z` | Reset all letter positions |
| `Escape` | Deselect current letter |
| `← → ↑ ↓` | Nudge selected letter 1px |
| `Shift + arrows` | Nudge selected letter 10px |

---

## License

MIT © 2026
