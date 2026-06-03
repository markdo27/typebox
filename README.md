# RASTER.PRESS

> A browser-native creative toolkit for pixel typography and generative dithering — no installs, no dependencies, pure HTML + CSS + JavaScript.

![Status](https://img.shields.io/badge/status-live-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Stack](https://img.shields.io/badge/stack-Vanilla%20JS%20%2B%20WebGL-black?style=flat-square)

---

## Tools

| Tool | Description |
|------|-------------|
| [**RASTER.PRESS**](#rasterpress-1) `index.html` | Pixel typography engine — rasterize letters into character grids |
| [**DitherPat**](#ditherPat) `ditherpat.html` | Real-time dithering & halftone engine with physics, SVG export, and shape-mask fill |

---

## RASTER.PRESS

Rasterizes large letters onto a configurable cell grid, then fills each cell with a small repeated character. Every letter can be individually transformed, colored, and animated.

```
B I G   T E X T
↓ rasterized onto grid
┌─┬─┬─┬─┬─┬─┬─┐
│O│O│█│█│O│O│O│   █ = stroke cell
│O│█│O│O│█│O│O│   O = fill character
│O│█│O│O│█│O│O│
│O│O│█│█│O│O│O│
└─┴─┴─┴─┴─┴─┴─┘
```

### Controls

#### Global

| Control | Description |
|---------|-------------|
| **Big Text** | Letters to render (up to 10 characters) |
| **Fill Character** | Small character tiled into each non-stroke cell |
| **Pixel Height** | Cell height in px — controls overall scale |
| **Width Ratio** | Horizontal squeeze of the rasterized letter |
| **Letter Spacing** | Gap between letters (supports negative for overlap) |
| **Ink Threshold** | Rasterizer cutoff — lower = bolder strokes |
| **Fill Density** | Fraction of fill cells rendered (0 = sparse, 1 = full) |
| **Canvas Padding** | Breathing room added around the auto-cropped canvas |

#### Colors & Gradient
- **Background / Fill / Stroke** color pickers
- **Gradient** — None / Horizontal / Vertical / Radial, with From/To pickers
- **5 quick presets** — Blue, Red, Gold, Mono, Neon

#### Layout
- **Horizontal / Vertical / Grid** arrangement
- **Letter alignment** — Top / Center / Bottom
- **Allow Overlap** — letters can share space for tight layouts

#### Per-Letter Overrides
Click any letter on the canvas to open the per-letter panel:
- Rotation · Scale · Skew / italic
- Individual fill color and fill character
- Drag to reposition
- Yellow handle = rotate · Blue corner handles = scale

#### Animation

| Mode | Effect |
|------|--------|
| **Colors** | Continuously cycles hue through gradient A → B |
| **Grain** | Randomises film grain on every frame |
| **Both** | Colors + Grain simultaneously |

Speed slider + 📷 **Snapshot** to export a single animated frame.

#### Export
- **Download PNG** — exports at 3× resolution
- Shortcut: `Ctrl + S`
- Filename: `RASTER_PRESS_<TEXT>_<timestamp>.png`

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl + S` | Download PNG |
| `Ctrl + Z` | Reset all letter positions |
| `Escape` | Deselect current letter |
| `← → ↑ ↓` | Nudge selected letter 1 px |
| `Shift + arrows` | Nudge selected letter 10 px |

---

## DitherPat

A standalone real-time dithering and halftone engine. Upload any SVG as the "pixel unit" and process a live webcam, static image, or animated test pattern through four render modes.

### Render Modes

#### ◎ Halftone
Classic halftone grid — 7 luminance states map each cell from invisible (0) to full size (6). Upload a custom SVG to replace the built-in circle/square/diamond/cross/ring shapes.

- **Anti-Gravity physics** — toggle to detach particles from the grid:
  - Buoyancy (upward drift)
  - Air drag
  - Mouse repulsion with configurable radius
  - Turbulence
  - Snap speed (how fast particles return home)
- **Invert luminance** — dark areas become large shapes, light areas small
- **Monotone mode** — binary threshold: shape is either full size or invisible, no gradation

#### △ Low Poly
Jittered grid triangulation rendered as filled polygons.

- **Density** — number of columns
- **Jitter** — 0 = rigid grid · 1 = fully organic
- **Use image colors** — sample RGB from source per triangle
- **Show edges** — draw dark outlines between triangles
- **Regenerate Mesh** — new random jitter with current settings

#### ▩ Guided Structure
Tiled SVG or built-in shape grid where each cell is scaled and rotated by the luminance at that position.

- **Grid density**
- **Threshold** — luminance cutoff below which cells are hidden
- **Tiling mode** — Alt (180° flip) · Quad (90° rotations) · Mirror
- **Scale by luminance** — shapes grow/shrink with brightness

#### ◫ Shape Fill *(new)*
SVG-mask based fill — a **Body SVG** defines the mask region; a **Pattern SVG** tiles inside it.

**Workflow:**
1. Upload **① Pattern Shape** — the small repeating unit (e.g. triangle, arrow)
2. Upload **② Body Shape** — the stencil mask (e.g. letter outlines, logo)
3. Adjust Grid Density, Pattern Scale, Pattern Rotation
4. Set Body BG Color and Pattern color (Shape color in the Color panel)
5. Export as SVG — both shapes are pre-rasterized to PNG for maximum compatibility

**Controls:**
| Control | Description |
|---------|-------------|
| Grid Density | Columns of pattern shapes across the canvas |
| Pattern Scale | Size of each tile within its cell |
| Pattern Rotation | Rotation angle applied to every pattern tile |
| Mask Threshold | Alpha cutoff to detect inside the body shape |
| Body BG Color | Color tinted over the body shape background |
| Body Opacity | How visible the body layer is behind the pattern |
| Show body behind pattern | Toggle body background layer |
| Tint body / Tint pattern | Override SVG colors with chosen colors |

### SVG Shape Controls (all modes)

- **Upload SVG** — any SVG becomes the pixel unit for Halftone, Low Poly, and Guided modes
- **Tint SVG with dot color** — composites dot color over the SVG via `source-atop`
- **Rotation** — 0–360° rotation applied to each shape instance; updates cache instantly

### Color Controls

| Control | Description |
|---------|-------------|
| Shape color | Dot / pattern fill color |
| Background color | Canvas background |
| Opacity | Global shape opacity |
| **Monotone** | Binary on/off mode — flat solid color, no opacity gradation |
| Cut threshold | Luminance level for monotone mode (above = show, below = hide) |

### Sources

| Source | Description |
|--------|-------------|
| ◈ Test | Animated procedural sine-wave pattern |
| ◉ Cam | Live webcam feed |
| ▦ Image | Upload any raster image (JPG, PNG, WebP…) |

### Export

| Format | Content |
|--------|---------|
| **↓ PNG** | Current canvas frame at device pixel ratio |
| **↓ SVG** | True vector output — all 4 modes, embeds custom shapes |

SVG export details by mode:
- **Halftone** — one `<circle>`, `<rect>`, `<polygon>` etc. per visible particle
- **Low Poly** — one `<polygon>` per triangle with exact `fill="rgb(r,g,b)"`
- **Guided** — one `<g transform="translate rotate">` per visible cell
- **Shape Fill** — body + pattern SVGs pre-rasterized to embedded PNG for cross-viewer compatibility

---

## Project Structure

```
typebox/
├── index.html          # RASTER.PRESS — app shell, controls, canvas
├── style.css           # Shared design system (Swiss: Inter, red/black/white)
├── app.js              # RASTER.PRESS render engine, animation, interaction
├── gradient-engine.js  # WebGL gradient layer engine
├── gradient.vert       # Vertex shader
├── gradient-data.frag  # Data fragment shader
├── gradient-render.frag# Render fragment shader
└── ditherpat.html      # DitherPat — standalone dithering + halftone engine
```

### RASTER.PRESS Engine (`app.js`)

| Function | Responsibility |
|----------|---------------|
| `rasterizeCharacter` | Renders letter to offscreen canvas, samples pixel grid |
| `generateLetterGrid` | Converts pixel samples to BG / Stroke / Fill cell map |
| `mergeBlocks` | Run-length merges adjacent same-type cells for efficiency |
| `renderLetter` | Draws merged blocks with per-letter transforms |
| `doRender` | Orchestrates layout, gradient, grain, handles, labels |
| `startAnimation` | `requestAnimationFrame` loop for color/grain animation |

### DitherPat Engine (`ditherpat.html` — `DitherPatEngine`)

| Method | Responsibility |
|--------|---------------|
| `_buildGrid` | Initialises particle array, offscreen sample canvas |
| `_getCache` | Pre-renders SVG/built-in shapes to `OffscreenCanvas` per state |
| `_sampleSource` | Draws source (test/webcam/image) to offscreen grid |
| `_lumToState` | Maps luminance → 7 states; binary in Monotone mode |
| `_frameHalftone` | Physics update + particle draw |
| `_frameLowPoly` | Triangulation fill with optional image colors |
| `_frameGuided` | Tiled SVG/shape grid with luminance-driven scale |
| `_frameShapeFill` | SVG mask fill — pattern tiles inside body shape |
| `_isInsideBody` | Alpha/luminance mask sampling against 512 px offscreen |
| `exportSVG` | Serialises current frame to SVG string, triggers download |

---

## Getting Started

No build step required.

```bash
git clone https://github.com/markdo27/typebox.git
cd typebox

# Open RASTER.PRESS
open index.html

# Open DitherPat
open ditherpat.html
```

Or serve locally for webcam support:

```bash
npx --yes serve . --listen 5174
# → http://localhost:5174
# → http://localhost:5174/ditherpat.html
```

> Webcam requires `localhost` or HTTPS — file:// protocol will be blocked by the browser.

---

## License

MIT © 2026
