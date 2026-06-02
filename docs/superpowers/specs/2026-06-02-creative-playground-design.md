# META.SPACE — Creative Playground Phase Design Spec

**Date:** 2026-06-02  
**Status:** Approved  
**Scope:** Phase 1 — Visual Controls (creative playground)  
**Deferred to Phase 2:** SVG export, shareable URL, preset history, copy-to-clipboard

---

## Overview

Extend META.SPACE from a single-parameter poster tool into a full creative playground.  
The primary goal is expressive experimentation — users should be able to generate wildly different  
visual outcomes fast, with per-letter control over every meaningful visual parameter.

All UI text is **English only**. No Chinese labels anywhere in the panel or canvas UI.

---

## Features In Scope

### New Global Controls
| Control | Type | Range | Default | Effect |
|---|---|---|---|---|
| Ink Threshold | Slider | 0–255 | 100 | Cutoff for rasterizer — lower = thicker strokes |
| Canvas Padding | Slider | 0–80px | 0 | Breathing room added around auto-cropped canvas |
| Fill Density | Slider | 0.1–1.0 | 1.0 | Fraction of CH blocks that actually render a char |
| Gradient Type | Picker | none / H / V / radial | none | Gradient applied to fill character color |
| Gradient Color A | Color | any | #1a6bff | Gradient start color |
| Gradient Color B | Color | any | #a371f7 | Gradient end color |
| Grain Amount | Slider | 0–1 | 0 | Film grain noise overlay opacity |
| Color Presets | Pills | 5 presets | — | One-click palette: Blue/Black, Red/White, Gold/Black, Mono, Neon |
| Animation Mode | Toggle | off / colors / grain / both | off | Live animation type |
| Animation Speed | Slider | 0.25–3× | 1.0 | Multiplier for animation tick rate |

### Per-Letter Controls (new)
Each letter in the big text gets an independent override for:
| Control | Type | Range | Default |
|---|---|---|---|
| Rotation | Slider | -180° to +180° | 0° |
| Scale | Slider | 0.25× to 3× | 1.0× |
| Skew (italic) | Slider | -45° to +45° | 0° |
| Fill Color | Color picker | any | inherits global fill color |
| Fill Character | Text input | single char | inherits global fill char |

### Other Features
- **Letter alignment:** top / center / bottom — controls vertical alignment when letters differ in height
- **Letter overlap:** toggle — when on, letter spacing can go negative (letters overlap)
- **CJK / Unicode support:** no code change needed — rasterizer already handles any glyph; just remove any char restrictions in the input field
- **Different fill per letter:** covered by per-letter fill character override
- **Live animation snapshot:** "📷 Snapshot" button pauses animation loop and downloads current frame as PNG

---

## State Shape

```js
const state = {
  // Existing
  bigText:        'O',
  pixelHeight:    57,
  widthRatio:     0.55,
  letterSpacing:  4,
  bgColor:        '#000000',
  charColor:      '#1a6bff',
  hollowColor:    '#ffffff',
  fontWeight:     '400',
  fontFamily:     'Space Mono',
  layout:         'horizontal',   // 'horizontal' | 'vertical' | 'grid'
  offsets:        {},             // { index → px delta } — existing drag offsets

  // New — global
  selectedLetter: null,           // integer index into bigText, or null
  letterOverrides: {},            // { index → { rotation?, scale?, skew?, color?, fillChar? } }
  inkThreshold:   100,            // replaces hardcoded 100 in rasterizer
  canvasPadding:  0,              // px added on each side of auto-cropped canvas
  fillDensity:    1.0,            // fraction of CH blocks rendered
  gradientType:   'none',         // 'none' | 'linear-h' | 'linear-v' | 'radial'
  gradientA:      '#1a6bff',
  gradientB:      '#a371f7',
  grainAmount:    0,              // 0–1
  colorPreset:    null,           // display name of last applied preset
  animMode:       'none',         // 'none' | 'color-cycle' | 'grain-shift' | 'both'
  animSpeed:      1.0,
  letterAlign:    'bottom',       // 'top' | 'center' | 'bottom'
  allowOverlap:   false,
};
```

**Per-letter override resolution** (in renderLetter):
```js
const ov       = state.letterOverrides[i] ?? {};
const rotation = ov.rotation ?? 0;
const scale    = ov.scale    ?? 1;
const skew     = ov.skew     ?? 0;
const color    = ov.color    ?? resolvedFillColor;  // resolved = gradient or flat charColor
const fillChar = ov.fillChar ?? state.smallText;
```

---

## UI Panel Design

### Two Modes

**Default (no letter selected)**  
Full global controls visible in this order:
1. Text section — Big Text input, Fill Character input
2. Grid section — Pixel Height, Width Ratio, Letter Spacing, Ink Threshold, Fill Density, Canvas Padding
3. Color section — Background, Fill Color, Stroke Color, Gradient picker (4 pills: none/H/V/radial), Gradient A+B colors, Grain slider
4. Presets section — 5 color preset pills
5. Layout section — Horizontal / Vertical / Grid toggle, Letter Alignment (top/center/bottom), Overlap toggle
6. Font section — Font Family select, Fill Weight select
7. Animation section — 4-way toggle (off/colors/grain/both), Speed slider, Snapshot button (visible only when animMode ≠ 'none')
8. Actions — Download PNG, Reset to Default

**Letter Selected (letter index N)**  
- Blue badge at top: "Letter 'X' — click elsewhere to deselect"
- Per-letter section (prominent, blue-tinted background):
  - Rotation slider (−180 to +180°)
  - Scale slider (0.25× to 3×)
  - Skew slider (−45 to +45°)
  - Fill Color picker (with "Use global" checkbox)
  - Fill Character input (single char, with "Use global" checkbox)
  - Reset Letter button / Deselect button
- Global controls collapsed into a "▾ Global Controls" accordion (expand on click)
- Actions remain at bottom

### Canvas Interaction

| Action | Effect |
|---|---|
| Click letter | Selects it; panel switches to per-letter mode |
| Drag letter body | Moves it (existing offset behaviour) |
| Click empty canvas area | Deselects; panel returns to global mode |
| Drag yellow dot (top of selected letter) | Rotates letter |
| Drag blue corner dots | Scales letter |

Selected letter shows:
- Blue outline + 4 corner scale handles (blue dots)
- Yellow rotation dot above letter center + connecting line

---

## Rendering Changes

### Per-Letter Transforms (`renderLetter`)
```js
const cx = ox + w / 2;
const cy = oy + h / 2;
ctx.save();
ctx.translate(cx, cy);
ctx.rotate(rotation * Math.PI / 180);
ctx.scale(scale, scale);
ctx.transform(1, 0, Math.tan(skew * Math.PI / 180), 1, 0, 0);
ctx.translate(-cx, -cy);
// … existing block rendering …
ctx.restore();
```

### Ink Threshold
Replace hardcoded `> 100` in `rasterizeCharacter`:
```js
strokeGrid[r][c] = data[idx] > state.inkThreshold;
```
Cache key must include `inkThreshold` so grid invalidates on change.

### Fill Density
In `renderLetter`, when a CH block is about to be drawn:
```js
if (Math.random() > state.fillDensity) continue;
```
Note: density uses `Math.random()` so it re-rolls on every render frame — this is intentional and creates a pleasant shimmer effect when combined with animation.

### Gradient Fill
Before rendering a letter, create a gradient spanning the full canvas:
```js
let fillSource = state.charColor;
if (state.gradientType !== 'none') {
  const grad = createGradient(ctx, state.gradientType, canvasW, canvasH);
  grad.addColorStop(0, state.gradientA);
  grad.addColorStop(1, state.gradientB);
  fillSource = grad;
}
```
Pass `fillSource` down through opts so per-letter color overrides still take precedence.

### Grain / Noise Overlay
After all letters are drawn:
```js
if (state.grainAmount > 0) {
  const noise = getNoiseCanvas(canvasW, canvasH, grainSeed);
  ctx.globalAlpha = state.grainAmount * 0.4;
  ctx.drawImage(noise, 0, 0);
  ctx.globalAlpha = 1;
}
```
`getNoiseCanvas` generates a cached offscreen canvas of random grey pixels.  
`grainSeed` is a number incremented each animation tick when animMode includes grain.

### Canvas Padding
After `computeLayout` returns `{ canvasW, canvasH, positions }`:
```js
const pad = state.canvasPadding;
canvas.width  = (canvasW + pad * 2) * scale;
canvas.height = (canvasH + pad * 2) * scale;
positions = positions.map(p => ({ x: p.x + pad, y: p.y + pad }));
```

### Letter Alignment
In `computeLayout` horizontal mode, when letters differ in height, apply `letterAlign`:
```js
// top: y = 0
// center: y = (maxH - h) / 2
// bottom: y = maxH - h   ← current behaviour
```

---

## Live Animation System

```js
let animFrameId = null;
let animTick    = 0;

function startAnimation() {
  if (animFrameId) return;
  function tick() {
    animTick += state.animSpeed * 0.016;  // ~60fps normalized
    if (state.animMode === 'color-cycle' || state.animMode === 'both') {
      // Shift hue of gradientA and gradientB by small delta
      shiftHue(animTick);
    }
    if (state.animMode === 'grain-shift' || state.animMode === 'both') {
      grainSeed = Math.random();
    }
    doRender();
    animFrameId = requestAnimationFrame(tick);
  }
  animFrameId = requestAnimationFrame(tick);
}

function stopAnimation() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId = null;
}

function snapshotPNG() {
  stopAnimation();
  triggerDownload();          // existing download logic
  startAnimation();           // resume
}
```

---

## UI Label Translations (English-only)

| Chinese (old) | English (new) |
|---|---|
| 控制台参数 | Parameters |
| 核心大文字 | Big Text |
| 填充小文字 | Fill Character |
| 基准像素高度 | Pixel Height |
| 大字单个字母宽度比例 | Width Ratio |
| 字母间距 | Letter Spacing |
| 背景填充色 | Background Color |
| 小字文字颜色 | Fill Color |
| 大字镂空区颜色 | Stroke Color |
| 微细填充字字重 | Fill Weight |
| 字体 | Font Family |
| 排列模式 | Layout Mode |
| 横排 / 纵排 / 网格 | Horizontal / Vertical / Grid |
| 下载 PNG 高清艺术图 | Download PNG |
| 恢复原稿红蓝白配置 | Reset to Default |
| 自动裁剪画布尺寸 | Canvas Size (auto-cropped) |
| 拖拽字母可调整位置 | Drag letters to reposition |
| 物理双端边缘重映射引擎 | Physical Edge Remap Engine |

---

## Color Presets

| Name | Background | Fill Color | Stroke Color |
|---|---|---|---|
| Blue / Black | #000000 | #1a6bff | #ffffff |
| Red / White | #ffffff | #e8172c | #000000 |
| Gold / Black | #000000 | #f0b429 | #ffffff |
| Mono | #111111 | #cccccc | #ffffff |
| Neon | #0a0a0a | #39ff14 | #ff00ff |

---

## File Change Summary

| File | Changes |
|---|---|
| `index.html` | Translate all labels to English; add new control groups (ink threshold, fill density, canvas padding, gradient, grain, presets, animation, letter align, overlap toggle); add per-letter panel section with accordion |
| `style.css` | Style new controls: gradient picker pills, preset pills, animation toggle, per-letter section (blue tinted), canvas handles overlay |
| `app.js` | Extend state object; update rasterizeCharacter (inkThreshold param); update generateLetterGrid (cache key); update renderLetter (transforms, density, gradient, per-letter overrides); update computeLayout (padding, alignment); add noise canvas generator; add animation loop; add click-to-select hit testing; add canvas handle rendering |

---

## Out of Scope (Phase 2)

- SVG export
- Shareable URL encoding
- Preset save/load history
- Copy-to-clipboard
- GIF / WebM animation export
- Multi-line text wrapping
- Fixed canvas aspect ratio lock
