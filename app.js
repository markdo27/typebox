/**
 * RASTER.PRESS — Pixel Typography Creative Playground
 * Physical Edge Remap Engine
 *
 * Cell types:
 *   0 = BG  — background (skipped)
 *   1 = CH  — filled with small "fill" character, stretched to block bounds
 *   2 = HO  — solid stroke body of the big letter
 */

'use strict';

const BG = 0, CH = 1, HO = 2;

/* ═══════════════════════════════════════════════════════════════════════
   APPLICATION STATE
   ═══════════════════════════════════════════════════════════════════════ */
const state = {
  // Core text
  bigText:        'O',
  smallText:      'O',

  // Grid
  pixelHeight:    57,
  widthRatio:     0.55,
  tracking:       0.07,   // fraction of pixelHeight added between letters
  inkThreshold:   100,    // rasterizer cutoff (0–255)
  fillDensity:    1.0,    // fraction of CH blocks rendered (0.1–1)
  canvasPadding:  0,      // px added on each side of canvas

  // Colors
  bgColor:        '#000000',
  charColor:      '#1a6bff',
  hollowColor:    '#ffffff',

  // Gradient
  gradientType:   'none',    // 'none' | 'linear-h' | 'linear-v' | 'radial'
  gradientA:      '#1a6bff',
  gradientB:      '#a371f7',

  // Grain
  grainAmount:    0,   // 0–1

  // Font
  fontWeight:     '400',
  fontFamily:     'Space Mono',

  // Layout
  layout:         'horizontal',  // 'horizontal' | 'vertical' | 'grid'
  letterAlign:    'bottom',      // 'top' | 'center' | 'bottom' (bottom = optical baseline)
  allowOverlap:   false,

  // Animation
  animMode:       'none',   // 'none' | 'color-cycle' | 'grain-shift' | 'both'
  animSpeed:      1.0,

  // Per-letter
  selectedLetter:  null,   // index or null
  letterOverrides: {},     // { index → { rotation?, scale?, skew?, color?, fillChar?, kerning?, cellSize? } }
  offsets:         {},     // { index → px delta } — horizontal drag offsets
  yOffsets:        {},     // { index → px delta } — vertical arrow-key nudge
};

/* ═════════════════════════════════════════════════════════════════════════
   GRADIENT LAYER STATE
   ═════════════════════════════════════════════════════════════════════════ */
const glState = {
  enabled:      false,
  engineReady:  false,
  paintingGroupId: null,   // groupId currently being painted, or null
  groups: [],              // [{ id, color }]
  nextGroupId: 0,
  blendTarget: 'both',     // 'bg' | 'fill' | 'both'
  opacity:     1.0,
  brushSize:   16,
  grain:       0,
  // Last point while painting (for segment construction)
  _lastPt: null,
};


/** Export resolution multiplier */
const EXPORT_SCALE  = 3;
/** Preview canvas resolution scale for HiDPI */
const PREVIEW_SCALE = 2;

/* ═══════════════════════════════════════════════════════════════════════
   CANVAS SETUP
   ═══════════════════════════════════════════════════════════════════════ */
const canvas = document.getElementById('poster-canvas');
const ctx    = canvas.getContext('2d', { alpha: false });

/* ═══════════════════════════════════════════════════════════════════════
   CORE ENGINE — DYNAMIC CHARACTER RASTERIZER
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Rasterize a character onto a cell grid.
 * widthRatio is applied as ctx.scale(widthRatio, 1) so the character is
 * squished/stretched horizontally while cells stay square.
 */
/**
 * Baseline position fraction within the rasterize canvas.
 * Text is drawn with textBaseline='alphabetic' at Y = H * BASELINE_FRAC.
 * This gives: ascenders above, descenders below, all on a consistent baseline.
 */
const BASELINE_FRAC = 0.72;

function rasterizeCharacter(char, R, C_grid, fontFamily, fontWeight, widthRatio, inkThreshold) {
  const SCALE = 8;
  const W = C_grid * SCALE;
  const H = R * SCALE;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width  = W;
  tempCanvas.height = H;
  const tempCtx = tempCanvas.getContext('2d', { alpha: false });

  tempCtx.fillStyle = '#000000';
  tempCtx.fillRect(0, 0, W, H);

  const fontSize = H * 0.88;
  tempCtx.font           = `${fontWeight} ${fontSize}px "${fontFamily}", "Arial Black", Impact, sans-serif`;
  tempCtx.fontKerning    = 'normal';
  tempCtx.textRendering  = 'optimizeLegibility';
  tempCtx.textAlign      = 'center';
  tempCtx.textBaseline   = 'alphabetic';  // consistent typographic baseline
  tempCtx.fillStyle      = '#ffffff';

  tempCtx.save();
  tempCtx.translate(W / 2, H * BASELINE_FRAC);
  tempCtx.scale(widthRatio, 1);
  tempCtx.fillText(char, 0, 0);
  tempCtx.restore();

  const imgData = tempCtx.getImageData(0, 0, W, H);
  const data    = imgData.data;

  const strokeGrid = [];
  for (let r = 0; r < R; r++) {
    strokeGrid[r] = [];
    for (let c = 0; c < C_grid; c++) {
      const px  = Math.floor((c + 0.5) * SCALE);
      const py  = Math.floor((r + 0.5) * SCALE);
      const idx = (py * W + px) * 4;
      strokeGrid[r][c] = data[idx] > inkThreshold;
    }
  }

  // The alphabetic baseline in the canvas is at H * BASELINE_FRAC px
  const baselineRow = Math.floor(R * BASELINE_FRAC);
  return { strokeGrid, baselineRow };
}

/**
 * Generate block grid for a letter.
 * Stroke cells → HO (white solid). Non-stroke → CH (fill character).
 * Auto-crops to tight bounding box + 1-cell padding on all sides.
 * Returns baselineRow: the typographic baseline row index within the cropped grid.
 */
function generateLetterGrid(char, fontFamily, fontWeight, effectiveCellSize) {
  const R      = Math.max(4, Math.round(700 / effectiveCellSize));
  const charCellsEst = Math.ceil(R * 0.65 * state.widthRatio);
  const C_grid = Math.max(6, charCellsEst + 6);

  const { strokeGrid, baselineRow: rawBaselineRow } = rasterizeCharacter(
    char, R, C_grid, fontFamily, fontWeight,
    state.widthRatio, state.inkThreshold
  );

  const grid = [];
  for (let r = 0; r < R; r++) {
    grid[r] = [];
    for (let c = 0; c < C_grid; c++) {
      grid[r][c] = strokeGrid[r][c] ? HO : CH;
    }
  }

  // Find tight bounding box (both rows and columns)
  let minC = C_grid, maxC = -1, minR = R, maxR = -1;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C_grid; c++) {
      if (grid[r][c] === HO) {
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }
    }
  }

  if (maxC === -1) {
    const defaultCols = Math.max(3, Math.round(R * state.widthRatio * 0.5));
    const defaultRows = Math.max(3, Math.round(R * 0.6));
    return {
      grid: Array.from({ length: defaultRows }, () => new Array(defaultCols).fill(CH)),
      cols: defaultCols, rows: defaultRows, baselineRow: Math.floor(defaultRows * 0.72),
    };
  }

  // Add 1-cell padding on all sides (clamped to grid bounds)
  const startC = Math.max(0, minC - 1);
  const endC   = Math.min(C_grid - 1, maxC + 1);
  const startR = Math.max(0, minR - 1);
  const endR   = Math.min(R - 1, maxR + 1);
  const cols   = endC - startC + 1;
  const rows   = endR - startR + 1;

  const croppedGrid = [];
  for (let r = startR; r <= endR; r++) {
    croppedGrid[r - startR] = [];
    for (let c = startC; c <= endC; c++) croppedGrid[r - startR].push(grid[r][c]);
  }

  // Baseline row relative to the cropped grid
  const croppedBaselineRow = Math.max(0, Math.min(rawBaselineRow - startR, rows - 1));

  return { grid: croppedGrid, cols, rows, baselineRow: croppedBaselineRow };
}

/** Cache keyed on all params that affect grid shape */
const gridCache = new Map();

/**
 * Get (cached) letter grid. letterIdx is used to look up per-letter cellSize override.
 */
function getLetterGrid(char, letterIdx) {
  const effectiveCellSize = (letterIdx != null && state.letterOverrides[letterIdx]?.cellSize)
    ? state.letterOverrides[letterIdx].cellSize
    : state.pixelHeight;
  const key = `${char}_${effectiveCellSize}_${state.widthRatio}_${state.inkThreshold}_${state.fontFamily}_${state.fontWeight}`;
  if (gridCache.has(key)) return gridCache.get(key);
  const result = generateLetterGrid(char, state.fontFamily, state.fontWeight, effectiveCellSize);
  gridCache.set(key, result);
  return result;
}

function invalidateGridCache() { gridCache.clear(); }

/** Returns dimensions plus baselineRow for optical baseline alignment. */
function getLetterDims(char, letterIdx) {
  const effectiveCellSize = (letterIdx != null && state.letterOverrides[letterIdx]?.cellSize)
    ? state.letterOverrides[letterIdx].cellSize
    : state.pixelHeight;
  const cellH = effectiveCellSize;
  const cellW = cellH;
  const { cols, rows, baselineRow } = getLetterGrid(char, letterIdx);
  return { cellW, cellH, w: cols * cellW, h: rows * cellH, cols, rows, baselineRow };
}

/** Compute the pixel gap between letters from fractional tracking state. */
function computeGap() {
  return Math.round(state.tracking * state.pixelHeight);
}

/* ═══════════════════════════════════════════════════════════════════════
   CORE ENGINE — BLOCK MERGING (HORIZONTAL-FIRST THEN VERTICAL)
   ═══════════════════════════════════════════════════════════════════════ */

function mergeBlocks(grid) {
  const R = grid.length;
  const C = grid[0].length;

  // Pass 1 — horizontal spans
  const spans = [];
  for (let r = 0; r < R; r++) {
    let c = 0;
    while (c < C) {
      const type = grid[r][c];
      let end = c + 1;
      while (end < C && grid[r][end] === type) end++;
      spans.push({ r, startC: c, width: end - c, type, merged: false });
      c = end;
    }
  }

  // Pass 2 — vertical merge of identical horizontal spans
  const blocks = [];
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span.merged) continue;

    let endR = span.r + 1;
    while (endR < R) {
      const match = spans.find(s =>
        !s.merged && s.r === endR &&
        s.startC === span.startC &&
        s.width  === span.width  &&
        s.type   === span.type
      );
      if (match) { match.merged = true; endR++; }
      else break;
    }

    span.merged = true;
    blocks.push({ r: span.r, c: span.startC, rs: endR - span.r, cs: span.width, type: span.type });
  }

  return blocks;
}

/* ═══════════════════════════════════════════════════════════════════════
   CORE ENGINE — CHARACTER RENDERING
   ═══════════════════════════════════════════════════════════════════════ */

function renderChar(renderCtx, char, x, y, w, h, opts) {
  if (!char || !char.trim()) return;

  const fontFamily = opts.fontFamily;
  const fontWeight = opts.fontWeight;
  const color      = opts.fillColor;   // resolved fill color (may be per-letter override)
  const fontSize   = Math.max(h, 4);

  renderCtx.save();
  renderCtx.font = `${fontWeight} ${fontSize}px "${fontFamily}", monospace`;

  const metrics  = renderCtx.measureText(char);
  const naturalW = metrics.width;
  const naturalH = fontSize * 0.72;

  const scaleX = w / Math.max(1, naturalW);
  const scaleY = h / Math.max(1, naturalH);

  renderCtx.translate(x + w * 0.5, y + h * 0.5);
  renderCtx.scale(scaleX, scaleY);
  renderCtx.textAlign    = 'center';
  renderCtx.textBaseline = 'middle';
  renderCtx.fillStyle    = color;
  renderCtx.fillText(char, 0, 0);

  renderCtx.restore();
}

/* ═══════════════════════════════════════════════════════════════════════
   CORE ENGINE — LETTER RENDERING
   ═══════════════════════════════════════════════════════════════════════ */

function renderLetter(renderCtx, char, ox, oy, opts) {
  const letterIdx = opts.letterIndex ?? 0;
  const { cellW, cellH, w, h } = getLetterDims(char, letterIdx);
  const { grid }   = getLetterGrid(char, letterIdx);
  const blocks     = mergeBlocks(grid);

  const rotation = opts.rotation ?? 0;
  const scale    = opts.scale    ?? 1;
  const skew     = opts.skew     ?? 0;

  // Apply per-letter transform around letter center
  renderCtx.save();
  if (rotation !== 0 || scale !== 1 || skew !== 0) {
    const cx = ox + w / 2;
    const cy = oy + h / 2;
    renderCtx.translate(cx, cy);
    renderCtx.rotate(rotation * Math.PI / 180);
    renderCtx.scale(scale, scale);
    if (skew !== 0) renderCtx.transform(1, 0, Math.tan(skew * Math.PI / 180), 1, 0, 0);
    renderCtx.translate(-cx, -cy);
  }

  // Background
  renderCtx.fillStyle = opts.bgColor;
  renderCtx.fillRect(ox, oy, w, h);

  for (const blk of blocks) {
    const bx = ox + blk.c * cellW;
    const by = oy + blk.r * cellH;
    const bw = blk.cs * cellW;
    const bh = blk.rs * cellH;

    if (blk.type === BG) {
      // skip
    } else if (blk.type === HO) {
      renderCtx.fillStyle = opts.hollowColor;
      renderCtx.fillRect(bx, by, bw, bh);
    } else if (blk.type === CH) {
      // Fill density — deterministic per block position so pattern is stable
      if (hashInt(fillDensitySeed + opts.letterIndex * 97, blk.r, blk.c) > opts.fillDensity) continue;
      renderChar(renderCtx, opts.fillChar, bx, by, bw, bh, opts);
    }
  }

  renderCtx.restore();
}

/* ═══════════════════════════════════════════════════════════════════════
   GRADIENT HELPER
   ═══════════════════════════════════════════════════════════════════════ */

function buildGradient(renderCtx, canvasW, canvasH) {
  if (state.gradientType === 'none') return null;
  let grad;
  if (state.gradientType === 'linear-h') {
    grad = renderCtx.createLinearGradient(0, 0, canvasW, 0);
  } else if (state.gradientType === 'linear-v') {
    grad = renderCtx.createLinearGradient(0, 0, 0, canvasH);
  } else {
    grad = renderCtx.createRadialGradient(
      canvasW / 2, canvasH / 2, 0,
      canvasW / 2, canvasH / 2, Math.max(canvasW, canvasH) / 2
    );
  }
  grad.addColorStop(0, state.gradientA);
  grad.addColorStop(1, state.gradientB);
  return grad;
}

/* ═══════════════════════════════════════════════════════════════════════
   NOISE CANVAS
   ═══════════════════════════════════════════════════════════════════════ */

let _noiseCanvas = null;
let _noiseKey    = '';

function getNoiseCanvas(w, h, seed) {
  const key = `${w}_${h}_${seed}`;
  if (_noiseKey === key && _noiseCanvas) return _noiseCanvas;

  const nc  = document.createElement('canvas');
  nc.width  = w; nc.height = h;
  const nctx = nc.getContext('2d');
  const img  = nctx.createImageData(w, h);
  const d    = img.data;
  // Fast LCG RNG seeded by seed
  let s = (seed * 9301 + 49297) % 233280;
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 9301 + 49297) % 233280;
    const v = (s / 233280) * 255;
    d[i] = d[i+1] = d[i+2] = v;
    d[i+3] = 255;
  }
  nctx.putImageData(img, 0, 0);
  _noiseCanvas = nc;
  _noiseKey    = key;
  return nc;
}

/* ═══════════════════════════════════════════════════════════════════════
   LAYOUT COMPUTATION
   ═══════════════════════════════════════════════════════════════════════ */

function computeLayout(letters) {
  const gap = computeGap();
  const n   = letters.length;
  let canvasW = 0, canvasH = 0;
  const positions = [];

  if (state.layout === 'horizontal') {
    if (state.letterAlign === 'bottom') {
      // —— Optical baseline alignment: all letters share a common typographic baseline ——
      let maxAboveBaseline = 0, maxBelowBaseline = 0;
      letters.forEach((c, i) => {
        const { h, cellH, baselineRow } = getLetterDims(c, i);
        maxAboveBaseline = Math.max(maxAboveBaseline, baselineRow * cellH);
        maxBelowBaseline = Math.max(maxBelowBaseline, h - baselineRow * cellH);
      });
      canvasH = Math.max(1, maxAboveBaseline + maxBelowBaseline);

      let curX = 0;
      letters.forEach((char, i) => {
        const { w, cellH, baselineRow } = getLetterDims(char, i);
        const dx = state.offsets[i] || 0;
        // Kerning: adjust gap before this letter (not applied to first letter)
        const kernPx = i > 0
          ? Math.round((state.letterOverrides[i]?.kerning ?? 0) * state.pixelHeight)
          : 0;
        if (i > 0) curX += kernPx;
        const y = maxAboveBaseline - baselineRow * cellH;
        positions.push({ x: curX + dx, y });
        const advance = state.allowOverlap ? Math.min(w, w + gap) : w + gap;
        curX += advance;
      });
      canvasW = Math.max(1, curX - (state.allowOverlap ? 0 : gap));

    } else {
      // —— Grid-align modes (top / center) ——
      let maxH = 0;
      letters.forEach((c, i) => { const { h } = getLetterDims(c, i); if (h > maxH) maxH = h; });
      canvasH = Math.max(1, maxH);

      let curX = 0;
      letters.forEach((char, i) => {
        const { w, h } = getLetterDims(char, i);
        const dx = state.offsets[i] || 0;
        const kernPx = i > 0
          ? Math.round((state.letterOverrides[i]?.kerning ?? 0) * state.pixelHeight)
          : 0;
        if (i > 0) curX += kernPx;
        let y = 0;
        if (state.letterAlign === 'center') y = (maxH - h) / 2;
        positions.push({ x: curX + dx, y });
        const advance = state.allowOverlap ? Math.min(w, w + gap) : w + gap;
        curX += advance;
      });
      canvasW = Math.max(1, curX - (state.allowOverlap ? 0 : gap));
    }

  } else if (state.layout === 'vertical') {
    let maxW = 0;
    letters.forEach((c, i) => { const { w } = getLetterDims(c, i); if (w > maxW) maxW = w; });
    canvasW = maxW;
    let curY = 0;
    letters.forEach((char, i) => {
      const { w, h } = getLetterDims(char, i);
      const dx = state.offsets[i]  || 0;
      const dy = state.yOffsets[i] || 0;
      positions.push({ x: (maxW - w) / 2 + dx, y: curY + dy });
      curY += h + gap;
    });
    canvasH = Math.max(1, curY - gap);

  } else {
    // Grid layout
    const colsCount = Math.ceil(Math.sqrt(n));
    const rowsCount = Math.ceil(n / colsCount);
    const colWidths  = new Array(colsCount).fill(0);
    const rowHeights = new Array(rowsCount).fill(0);

    for (let i = 0; i < n; i++) {
      const gc = i % colsCount;
      const gr = Math.floor(i / colsCount);
      const { w, h } = getLetterDims(letters[i], i);
      if (w > colWidths[gc])  colWidths[gc]  = w;
      if (h > rowHeights[gr]) rowHeights[gr] = h;
    }

    canvasW = colWidths.reduce((a, b) => a + b, 0)  + Math.max(0, colsCount - 1) * gap;
    canvasH = rowHeights.reduce((a, b) => a + b, 0) + Math.max(0, rowsCount - 1) * gap;

    for (let i = 0; i < n; i++) {
      const gc = i % colsCount;
      const gr = Math.floor(i / colsCount);
      const dx = state.offsets[i]  || 0;
      const dy = state.yOffsets[i] || 0;
      const x  = colWidths.slice(0, gc).reduce((a, b) => a + b, 0) + gc * gap + dx;
      const y  = rowHeights.slice(0, gr).reduce((a, b) => a + b, 0) + gr * gap + dy;
      positions.push({ x, y });
    }
  }

  // Apply canvas padding
  const pad = state.canvasPadding;
  return {
    canvasW: canvasW + pad * 2,
    canvasH: canvasH + pad * 2,
    positions: positions.map(p => ({ x: p.x + pad, y: p.y + pad })),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN RENDER LOOP
   ═══════════════════════════════════════════════════════════════════════ */

let renderScheduled = false;
let grainSeed       = 1;
let fillDensitySeed = 1;   // changes only when user adjusts fillDensity slider

/** Fast integer hash — deterministic per (seed, a, b) */
function hashInt(seed, a, b) {
  let h = (seed * 2654435761 ^ a * 2246822519 ^ b * 3266489917) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(doRender);
}

function doRender() {
  renderScheduled = false;

  const rawText = state.bigText.trim().toUpperCase() || 'O';
  const letters = rawText.split('');

  const { canvasW, canvasH, positions } = computeLayout(letters);

  const scale = PREVIEW_SCALE;
  canvas.width  = Math.round(canvasW * scale);
  canvas.height = Math.round(canvasH * scale);
  canvas.style.width  = `${Math.round(canvasW)}px`;
  canvas.style.height = `${Math.round(canvasH)}px`;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.fillStyle = state.bgColor;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // ── Gradient Layer (WebGL distance-field) ──
  if (glState.enabled && glState.engineReady && glState.groups.length > 0) {
    // Ensure WebGL canvas is same logical size
    if (gradientEngine.width !== Math.round(canvasW) || gradientEngine.height !== Math.round(canvasH)) {
      gradientEngine.resize(Math.round(canvasW), Math.round(canvasH));
    }
    gradientEngine.render({
      grain: glState.grain > 0,
      grainAmount: glState.grain,
      opacity: glState.opacity,
    });
    if (glState.blendTarget === 'bg' || glState.blendTarget === 'both') {
      ctx.drawImage(gradientEngine.getCanvas(), 0, 0, canvasW, canvasH);
    }
  } else {
    // Fallback: solid bg already drawn above
  }

  // Gradient source (null = flat color) — only used when GL layer is OFF
  const grad = (glState.enabled && glState.groups.length > 0) ? null : buildGradient(ctx, canvasW, canvasH);

  letters.forEach((char, i) => {
    const { x, y } = positions[i];
    const ov       = state.letterOverrides[i] ?? {};

    // Sample fill color from gradient layer if active
    let fillColor = ov.color ?? (grad || state.charColor);
    if (!ov.color && glState.enabled && glState.engineReady &&
        glState.groups.length > 0 &&
        (glState.blendTarget === 'fill' || glState.blendTarget === 'both')) {
      fillColor = _sampleGlColor(x, y, canvasW, canvasH);
    }

    const opts = {
      fillChar:    ov.fillChar ?? (state.smallText || 'O'),
      fontFamily:  state.fontFamily,
      fontWeight:  state.fontWeight,
      fillColor,
      hollowColor: state.hollowColor,
      bgColor:     state.bgColor,
      fillDensity: state.fillDensity,
      rotation:    ov.rotation ?? 0,
      scale:       ov.scale    ?? 1,
      skew:        ov.skew     ?? 0,
      letterIndex: i,
    };

    renderLetter(ctx, char, x, y, opts);
  });

  // Grain overlay
  if (state.grainAmount > 0) {
    const noise = getNoiseCanvas(Math.round(canvasW), Math.round(canvasH), grainSeed);
    ctx.globalAlpha = state.grainAmount * 0.4;
    ctx.drawImage(noise, 0, 0);
    ctx.globalAlpha = 1;
  }

  // Canvas handles for selected letter
  if (state.selectedLetter !== null && state.selectedLetter < letters.length) {
    drawHandles(letters, positions);
  }

  // Update dimension label
  const label = document.getElementById('canvas-label');
  if (label) {
    label.textContent = `Canvas: ${Math.round(canvasW)} × ${Math.round(canvasH)} px (auto-cropped)`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   CANVAS HANDLES
   ═══════════════════════════════════════════════════════════════════════ */

function drawHandles(letters, positions) {
  const i    = state.selectedLetter;
  const char = letters[i];
  if (!char) return;

  const { w, h } = getLetterDims(char);
  const { x, y } = positions[i];
  const cx = x + w / 2;
  const cy = y + h / 2;

  // Swiss: solid red outline
  ctx.save();
  ctx.strokeStyle = '#e8000b';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

  // Corner scale handles — white square (Swiss: no circles)
  const HR = 4;
  for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(hx - HR, hy - HR, HR * 2, HR * 2);
    ctx.strokeStyle = '#e8000b';
    ctx.lineWidth = 1;
    ctx.strokeRect(hx - HR, hy - HR, HR * 2, HR * 2);
  }

  // Rotation handle — red square above center
  const rotY = y - 16;
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx, rotY);
  ctx.strokeStyle = '#e8000b';
  ctx.lineWidth   = 1;
  ctx.stroke();

  ctx.fillStyle = '#e8000b';
  ctx.fillRect(cx - HR, rotY - HR, HR * 2, HR * 2);

  ctx.restore();
}

/* ═══════════════════════════════════════════════════════════════════════
   ANIMATION SYSTEM
   ═══════════════════════════════════════════════════════════════════════ */

let animFrameId  = null;
let animTick     = 0;
let animBaseHueA = 0;
let animBaseHueB = 180;

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function startAnimation() {
  if (animFrameId) return;
  function tick() {
    animTick += state.animSpeed * 0.5;

    if (state.animMode === 'color-cycle' || state.animMode === 'both') {
      const hA = (animBaseHueA + animTick) % 360;
      const hB = (animBaseHueB + animTick) % 360;
      state.gradientA = hslToHex(hA, 80, 55);
      state.gradientB = hslToHex(hB, 80, 55);
      if (state.gradientType === 'none') state.gradientType = 'linear-h';
    }

    if (state.animMode === 'grain-shift' || state.animMode === 'both') {
      grainSeed = Math.random() * 999999;
      if (state.grainAmount === 0) state.grainAmount = 0.5;
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

function setAnimMode(mode) {
  state.animMode = mode;
  if (mode === 'none') {
    stopAnimation();
  } else {
    startAnimation();
  }
  // Show/hide snapshot button and speed slider
  const snapBtn   = document.getElementById('snapshot-btn');
  const speedWrap = document.getElementById('anim-speed-wrap');
  if (snapBtn)   snapBtn.style.display   = mode === 'none' ? 'none' : 'flex';
  if (speedWrap) speedWrap.style.display = mode === 'none' ? 'none' : 'block';
}

/* ═══════════════════════════════════════════════════════════════════════
   EXPORT
   ═══════════════════════════════════════════════════════════════════════ */

function downloadPNG() {
  const rawText = state.bigText.trim().toUpperCase() || 'O';
  const letters = rawText.split('');
  const { canvasW, canvasH, positions } = computeLayout(letters);

  const scale     = EXPORT_SCALE;
  const exportCvs = document.createElement('canvas');
  exportCvs.width  = Math.round(canvasW * scale);
  exportCvs.height = Math.round(canvasH * scale);
  const ectx = exportCvs.getContext('2d', { alpha: false });
  ectx.setTransform(scale, 0, 0, scale, 0, 0);

  ectx.fillStyle = state.bgColor;
  ectx.fillRect(0, 0, canvasW, canvasH);

  // Gradient layer on export
  if (glState.enabled && glState.engineReady && glState.groups.length > 0) {
    if (glState.blendTarget === 'bg' || glState.blendTarget === 'both') {
      ectx.save();
      ectx.setTransform(1, 0, 0, 1, 0, 0);
      // Draw at full export resolution (scale up from logical size)
      ectx.drawImage(gradientEngine.getCanvas(), 0, 0, exportCvs.width, exportCvs.height);
      ectx.restore();
    }
  }

  const grad = (glState.enabled && glState.groups.length > 0) ? null : buildGradient(ectx, canvasW, canvasH);

  letters.forEach((char, i) => {
    const { x, y } = positions[i];
    const ov       = state.letterOverrides[i] ?? {};

    let fillColor = ov.color ?? (grad || state.charColor);
    if (!ov.color && glState.enabled && glState.engineReady &&
        glState.groups.length > 0 &&
        (glState.blendTarget === 'fill' || glState.blendTarget === 'both')) {
      fillColor = _sampleGlColor(x, y, canvasW, canvasH);
    }

    const opts = {
      fillChar:    ov.fillChar ?? (state.smallText || 'O'),
      fontFamily:  state.fontFamily,
      fontWeight:  state.fontWeight,
      fillColor,
      hollowColor: state.hollowColor,
      bgColor:     state.bgColor,
      fillDensity: 1.0,  // always full density on export
      rotation:    ov.rotation ?? 0,
      scale:       ov.scale    ?? 1,
      skew:        ov.skew     ?? 0,
      letterIndex: i,
    };
    renderLetter(ectx, char, x, y, opts);
  });

  if (state.grainAmount > 0) {
    const noise = getNoiseCanvas(Math.round(canvasW * scale), Math.round(canvasH * scale), grainSeed);
    ectx.save();
    ectx.setTransform(1, 0, 0, 1, 0, 0);
    ectx.globalAlpha = state.grainAmount * 0.4;
    ectx.drawImage(noise, 0, 0);
    ectx.globalAlpha = 1;
    ectx.restore();
  }

  exportCvs.toBlob(blob => {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = `RASTER_PRESS_${rawText}_${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(`✓ Exported ${rawText} — ${exportCvs.width} × ${exportCvs.height} px`);
  }, 'image/png');
}

/* ═══════════════════════════════════════════════════════════════════════
   DRAG INTERACTION
   ═══════════════════════════════════════════════════════════════════════ */

let drag     = null;
let rotDrag  = null;

function hitTestLetter(canvasX, canvasY, letters) {
  const gap = computeGap();

  if (state.layout === 'horizontal') {
    const pad = state.canvasPadding;
    let currentX = pad;
    for (let i = 0; i < letters.length; i++) {
      const { w } = getLetterDims(letters[i], i);
      const dx = state.offsets[i] || 0;
      const kernPx = i > 0
        ? Math.round((state.letterOverrides[i]?.kerning ?? 0) * state.pixelHeight)
        : 0;
      currentX += (i > 0 ? kernPx : 0);
      const lx = currentX + dx;
      if (canvasX >= lx && canvasX < lx + w) return i;
      const advance = state.allowOverlap ? Math.min(w, w + gap) : w + gap;
      currentX += advance;
    }
  } else {
    const { positions } = computeLayout(letters);
    for (let i = 0; i < letters.length; i++) {
      const { w, h } = getLetterDims(letters[i], i);
      const { x, y } = positions[i];
      if (canvasX >= x && canvasX < x + w && canvasY >= y && canvasY < y + h) return i;
    }
  }
  return -1;
}

function hitTestRotHandle(canvasX, canvasY, letters, positions) {
  if (state.selectedLetter === null) return false;
  const i    = state.selectedLetter;
  const char = letters[i];
  if (!char) return false;
  const { w, h } = getLetterDims(char, i);
  const { x, y } = positions[i];
  const cx   = x + w / 2;
  const rotY = y - 18;
  return Math.hypot(canvasX - cx, canvasY - rotY) < 10;
}

canvas.addEventListener('mousedown', e => {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / PREVIEW_SCALE / rect.width;
  const scaleY = canvas.height / PREVIEW_SCALE / rect.height;
  const cx     = (e.clientX - rect.left) * scaleX;
  const cy     = (e.clientY - rect.top)  * scaleY;

  const rawText = state.bigText.trim().toUpperCase() || 'O';
  const letters = rawText.split('');
  const { positions } = computeLayout(letters);

  // Check rotation handle first
  if (hitTestRotHandle(cx, cy, letters, positions)) {
    const i    = state.selectedLetter;
    const { w, h } = getLetterDims(letters[i], i);
    const lx   = positions[i].x + w / 2;
    const ly   = positions[i].y + h / 2;
    rotDrag = {
      idx: i,
      startAngle: Math.atan2(cy - ly, cx - lx),
      startRot: (state.letterOverrides[i] ?? {}).rotation ?? 0,
      cx: lx, cy: ly,
    };
    e.preventDefault();
    return;
  }

  const idx = hitTestLetter(cx, cy, letters);

  if (idx >= 0) {
    // Select letter
    state.selectedLetter = idx;
    updatePerLetterPanel(letters[idx], idx);
    drag = { idx, startX: e.clientX, startOffset: state.offsets[idx] || 0 };
    scheduleRender();
  } else {
    // Deselect
    if (state.selectedLetter !== null) {
      state.selectedLetter = null;
      hidePerLetterPanel();
      scheduleRender();
    }
  }

  canvas.classList.add('is-dragging');
  e.preventDefault();
});

window.addEventListener('mousemove', e => {
  if (rotDrag) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / PREVIEW_SCALE / rect.width;
    const scaleY = canvas.height / PREVIEW_SCALE / rect.height;
    const cx     = (e.clientX - rect.left) * scaleX;
    const cy     = (e.clientY - rect.top)  * scaleY;
    const angle  = Math.atan2(cy - rotDrag.cy, cx - rotDrag.cx);
    const delta  = (angle - rotDrag.startAngle) * 180 / Math.PI;
    const newRot = Math.round(rotDrag.startRot + delta);

    if (!state.letterOverrides[rotDrag.idx]) state.letterOverrides[rotDrag.idx] = {};
    state.letterOverrides[rotDrag.idx].rotation = newRot;

    // Sync per-letter slider
    const rotEl = document.getElementById('pl-rotation');
    const rotValEl = document.getElementById('pl-rotation-val');
    if (rotEl) { rotEl.value = newRot; rotValEl.textContent = `${newRot}°`; }

    scheduleRender();
    return;
  }

  if (!drag) return;
  const delta = e.clientX - drag.startX;
  state.offsets[drag.idx] = drag.startOffset + delta;
  scheduleRender();
});

window.addEventListener('mouseup', () => {
  drag = null; rotDrag = null;
  canvas.classList.remove('is-dragging');
});

// Touch support
canvas.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  const t    = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / PREVIEW_SCALE / rect.width;
  const scaleY = canvas.height / PREVIEW_SCALE / rect.height;
  const cx   = (t.clientX - rect.left) * scaleX;
  const cy   = (t.clientY - rect.top)  * scaleY;
  const rawText = state.bigText.trim().toUpperCase() || 'O';
  const letters = rawText.split('');
  const idx = hitTestLetter(cx, cy, letters);
  if (idx < 0) return;
  drag = { idx, startX: t.clientX, startOffset: state.offsets[idx] || 0 };
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  if (!drag || e.touches.length !== 1) return;
  const delta = e.touches[0].clientX - drag.startX;
  state.offsets[drag.idx] = drag.startOffset + delta;
  scheduleRender();
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', () => { drag = null; });

/* ═════════════════════════════════════════════════════════════════════════
   AESTHETIC PRESETS
   ═════════════════════════════════════════════════════════════════════════ */

const AESTHETIC_PRESETS = [
  { name: 'Concert',   fontFamily: 'Bebas Neue',        fontWeight: '400', tracking: 0.10, bgColor: '#0a0000', charColor: '#ff3300', hollowColor: '#ffffff', gradientType: 'none', inkThreshold: 85,  grainAmount: 0.10 },
  { name: 'Editorial', fontFamily: 'Playfair Display',  fontWeight: '900', tracking: 0.05, bgColor: '#0d0b20', charColor: '#f0b429', hollowColor: '#ffffff', gradientType: 'none', inkThreshold: 100, grainAmount: 0    },
  { name: 'Brutalist', fontFamily: 'Anton',             fontWeight: '400', tracking: 0.02, bgColor: '#0f0f0f', charColor: '#ffffff', hollowColor: '#0f0f0f', gradientType: 'none', inkThreshold: 110, grainAmount: 0    },
  { name: 'Neon',      fontFamily: 'DM Sans',           fontWeight: '800', tracking: 0.08, bgColor: '#050510', charColor: '#00ffe5', hollowColor: '#ff00aa', gradientType: 'linear-h', gradientA: '#00ffe5', gradientB: '#ff00aa', inkThreshold: 95, grainAmount: 0.05 },
  { name: 'Retrowave', fontFamily: 'Righteous',         fontWeight: '400', tracking: 0.12, bgColor: '#120024', charColor: '#ff00c8', hollowColor: '#ffe600', gradientType: 'linear-h', gradientA: '#ff00c8', gradientB: '#00d4ff', inkThreshold: 100, grainAmount: 0.15 },
  { name: 'Newsprint', fontFamily: 'Zilla Slab',        fontWeight: '700', tracking: 0.03, bgColor: '#0c0c0c', charColor: '#e8e0d0', hollowColor: '#ffffff', gradientType: 'none', inkThreshold: 100, grainAmount: 0.20 },
  { name: 'Gallery',   fontFamily: 'Cormorant Garamond',fontWeight: '700', tracking: 0.15, bgColor: '#1a1a1f', charColor: '#d4c5b0', hollowColor: '#e8e0d8', gradientType: 'none', inkThreshold: 90,  grainAmount: 0.10 },
  { name: 'Sport',     fontFamily: 'Barlow Condensed',  fontWeight: '800', tracking: 0.04, bgColor: '#0a0a14', charColor: '#f5d000', hollowColor: '#ffffff', gradientType: 'none', inkThreshold: 95,  grainAmount: 0    },
  { name: 'Hacker',    fontFamily: 'Space Mono',        fontWeight: '700', tracking: 0.06, bgColor: '#000500', charColor: '#39ff14', hollowColor: '#004a00', gradientType: 'none', inkThreshold: 100, grainAmount: 0.05 },
  { name: 'Fashion',   fontFamily: 'Syne',              fontWeight: '800', tracking: 0.20, bgColor: '#000000', charColor: '#ffffff', hollowColor: '#000000', gradientType: 'none', inkThreshold: 105, grainAmount: 0    },
  { name: 'Baroque',   fontFamily: 'Abril Fatface',     fontWeight: '400', tracking: 0.08, bgColor: '#f5f0e8', charColor: '#8b0000', hollowColor: '#f5f0e8', gradientType: 'none', inkThreshold: 95,  grainAmount: 0.08 },
  { name: 'Pop Art',   fontFamily: 'Fjalla One',        fontWeight: '400', tracking: 0.06, bgColor: '#ffffff', charColor: '#0033cc', hollowColor: '#ffcc00', gradientType: 'none', inkThreshold: 90,  grainAmount: 0    },
];

function applyAesthetic(name) {
  const p = AESTHETIC_PRESETS.find(a => a.name === name);
  if (!p) return;
  const fields = ['fontFamily', 'fontWeight', 'tracking', 'bgColor', 'charColor',
                  'hollowColor', 'gradientType', 'gradientA', 'gradientB',
                  'inkThreshold', 'grainAmount'];
  fields.forEach(key => { if (p[key] !== undefined) state[key] = p[key]; });

  // Update gradient color visibility
  const gradColors = document.getElementById('gradient-colors');
  if (gradColors) gradColors.style.display = state.gradientType === 'none' ? 'none' : 'flex';

  document.querySelectorAll('.aesthetic-card').forEach(card => {
    card.classList.toggle('active', card.dataset.aesthetic === name);
  });

  invalidateGridCache();
  syncAllControls();
  scheduleRender();
  showToast(`✓ ${name} aesthetic applied`);
}

function syncColorHex(inputId, hexId, val) {
  const el = document.getElementById(inputId);
  const hexEl = document.getElementById(hexId);
  if (el) el.value = val;
  if (hexEl) hexEl.textContent = val;
}

/* ═══════════════════════════════════════════════════════════════════════
   PER-LETTER PANEL MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════ */

function updatePerLetterPanel(char, idx) {
  const panel = document.getElementById('per-letter-panel');
  const badge = document.getElementById('selected-badge-text');
  if (!panel) return;

  const ov = state.letterOverrides[idx] ?? {};

  if (badge) badge.textContent = `Letter "${char}" selected`;

  // Sync sliders to current overrides
  const setSlider = (id, valId, val, unit, precision = 0) => {
    const el = document.getElementById(id);
    const velEl = document.getElementById(valId);
    if (el) el.value = val;
    if (velEl) velEl.textContent = unit ? `${val}${unit}` : val;
  };

  setSlider('pl-rotation', 'pl-rotation-val', ov.rotation ?? 0, '°');
  setSlider('pl-scale',    'pl-scale-val',    ov.scale    ?? 1,  '×');
  setSlider('pl-skew',     'pl-skew-val',     ov.skew     ?? 0,  '°');

  const plColor = document.getElementById('pl-color');
  const plColorHex = document.getElementById('pl-color-hex');
  if (plColor) {
    plColor.value = ov.color ?? state.charColor;
    if (plColorHex) plColorHex.textContent = plColor.value;
  }

  const plFillChar = document.getElementById('pl-fill-char');
  if (plFillChar) plFillChar.value = ov.fillChar ?? state.smallText ?? 'O';

  // Kerning
  const plKerning = document.getElementById('pl-kerning');
  const plKerningVal = document.getElementById('pl-kerning-val');
  if (plKerning) {
    plKerning.value = ov.kerning ?? 0;
    if (plKerningVal) plKerningVal.textContent = (ov.kerning ?? 0).toFixed(2);
  }

  // Cell Size
  const plCellSize = document.getElementById('pl-cell-size');
  const plCellSizeVal = document.getElementById('pl-cell-size-val');
  if (plCellSize) {
    plCellSize.value = ov.cellSize ?? state.pixelHeight;
    if (plCellSizeVal) plCellSizeVal.textContent = ov.cellSize != null ? `${ov.cellSize}px` : 'Global';
  }

  panel.style.display = 'block';

  // Collapse global controls
  const globalPanel = document.getElementById('global-controls-accordion');
  if (globalPanel) globalPanel.classList.add('collapsed');
}

function hidePerLetterPanel() {
  const panel = document.getElementById('per-letter-panel');
  if (panel) panel.style.display = 'none';

  const globalPanel = document.getElementById('global-controls-accordion');
  if (globalPanel) globalPanel.classList.remove('collapsed');
}

/* ═══════════════════════════════════════════════════════════════════════
   TOAST NOTIFICATION
   ═══════════════════════════════════════════════════════════════════════ */
let toastTimer = null;

function showToast(msg, duration = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/* ═══════════════════════════════════════════════════════════════════════
   COLOR PRESETS
   ═══════════════════════════════════════════════════════════════════════ */

const COLOR_PRESETS = {
  'Blue / Black': { bgColor: '#000000', charColor: '#1a6bff', hollowColor: '#ffffff' },
  'Red / White':  { bgColor: '#ffffff', charColor: '#e8172c', hollowColor: '#000000' },
  'Gold / Black': { bgColor: '#000000', charColor: '#f0b429', hollowColor: '#ffffff' },
  'Mono':         { bgColor: '#111111', charColor: '#cccccc', hollowColor: '#ffffff' },
  'Neon':         { bgColor: '#0a0a0a', charColor: '#39ff14', hollowColor: '#ff00ff' },
};

function applyPreset(name) {
  const p = COLOR_PRESETS[name];
  if (!p) return;
  Object.assign(state, p);
  state.gradientType = 'none';
  state.colorPreset  = name;

  // Sync color inputs
  ['bg-color', 'char-color', 'hollow-color'].forEach(id => {
    const key = id.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
    const stateKey = { 'bgColor': 'bgColor', 'charColor': 'charColor', 'hollowColor': 'hollowColor' }[key] || key;
    const el = document.getElementById(id);
    if (el) el.value = state[stateKey] ?? state[key];
  });
  syncColorHex('bg-color',     'bg-color-hex',     state.bgColor);
  syncColorHex('char-color',   'char-color-hex',   state.charColor);
  syncColorHex('hollow-color', 'hollow-color-hex', state.hollowColor);

  // Update active preset pill
  document.querySelectorAll('.preset-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.preset === name);
  });

  scheduleRender();
}

function syncColorHex(inputId, hexId, val) {
  const el = document.getElementById(inputId);
  const hexEl = document.getElementById(hexId);
  if (el) el.value = val;
  if (hexEl) hexEl.textContent = val;
}

/* ═══════════════════════════════════════════════════════════════════════
   UI EVENT HANDLERS
   ═══════════════════════════════════════════════════════════════════════ */

function wireInputs() {

  // ── Big text ──
  const bigTextEl = document.getElementById('big-text');
  bigTextEl.addEventListener('input', () => {
    const prev = state.bigText;
    state.bigText = bigTextEl.value;
    if (state.bigText.length !== prev.length) {
      state.offsets = {};
      state.letterOverrides = {};
      state.selectedLetter = null;
      hidePerLetterPanel();
    }
    scheduleRender();
  });

  // ── Small text ──
  document.getElementById('small-text').addEventListener('input', e => {
    state.smallText = e.target.value;
    scheduleRender();
  });

  // ── Pixel height ──
  wireSlider('pixel-height', 'pixel-height-val', v => {
    state.pixelHeight = parseInt(v);
    invalidateGridCache();
  }, 'px');

  // ── Width ratio ──
  wireSlider('width-ratio', 'width-ratio-val', v => {
    state.widthRatio = parseFloat(v);
    invalidateGridCache();
  }, '', 2);

  // ── Tracking (fractional — replaces fixed letter-spacing) ──
  const trackingEl    = document.getElementById('tracking');
  const trackingValEl = document.getElementById('tracking-val');
  if (trackingEl) {
    trackingEl.addEventListener('input', () => {
      state.tracking = parseFloat(trackingEl.value);
      if (trackingValEl) trackingValEl.textContent = `${Math.round(state.tracking * 100)}%`;
      scheduleRender();
    });
  }

  // ── Ink threshold ──
  wireSlider('ink-threshold', 'ink-threshold-val', v => {
    state.inkThreshold = parseInt(v);
    invalidateGridCache();
  }, '');

  // ── Fill density ──
  wireSlider('fill-density', 'fill-density-val', v => {
    state.fillDensity = parseFloat(v);
    fillDensitySeed   = (fillDensitySeed * 1664525 + 1013904223) & 0x7fffffff || 1;
  }, '', 2);

  // ── Canvas padding ──
  wireSlider('canvas-padding', 'canvas-padding-val', v => {
    state.canvasPadding = parseInt(v);
  }, 'px');

  // ── Colors ──
  wireColor('bg-color',     'bg-color-hex',     'bgColor');
  wireColor('char-color',   'char-color-hex',   'charColor');
  wireColor('hollow-color', 'hollow-color-hex', 'hollowColor');

  // ── Gradient type pills ──
  document.querySelectorAll('.grad-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.grad-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.gradientType = pill.dataset.grad;
      // Show/hide gradient color pickers
      const gradColors = document.getElementById('gradient-colors');
      if (gradColors) gradColors.style.display = state.gradientType === 'none' ? 'none' : 'flex';
      scheduleRender();
    });
  });

  // ── Gradient colors ──
  wireColor('gradient-a', 'gradient-a-hex', 'gradientA');
  wireColor('gradient-b', 'gradient-b-hex', 'gradientB');

  // ── Grain ──
  wireSlider('grain-amount', 'grain-amount-val', v => {
    state.grainAmount = parseFloat(v);
    grainSeed = Math.random() * 999999;
  }, '', 2);

  // ── Color presets ──
  document.querySelectorAll('.preset-pill').forEach(pill => {
    pill.addEventListener('click', () => applyPreset(pill.dataset.preset));
  });

  // ── Font weight ──
  document.getElementById('font-weight').addEventListener('change', e => {
    state.fontWeight = e.target.value;
    scheduleRender();
  });

  // ── Font family ──
  document.getElementById('font-family').addEventListener('change', e => {
    state.fontFamily = e.target.value;
    invalidateGridCache();
    scheduleRender();
  });

  // ── Layout toggle ──
  document.querySelectorAll('[data-layout]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-layout]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.layout  = btn.dataset.layout;
      state.offsets = {};
      scheduleRender();
    });
  });

  // ── Letter alignment ──
  document.querySelectorAll('[data-align]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-align]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.letterAlign = btn.dataset.align;
      scheduleRender();
    });
  });

  // ── Overlap toggle ──
  const overlapEl = document.getElementById('allow-overlap');
  if (overlapEl) {
    overlapEl.addEventListener('change', () => {
      state.allowOverlap = overlapEl.checked;
      scheduleRender();
    });
  }

  // ── Animation mode ──
  document.querySelectorAll('[data-anim]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-anim]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setAnimMode(btn.dataset.anim);
      scheduleRender();
    });
  });

  // ── Animation speed ──
  wireSlider('anim-speed', 'anim-speed-val', v => {
    state.animSpeed = parseFloat(v);
  }, '×', 2);

  // ── Snapshot ──
  const snapBtn = document.getElementById('snapshot-btn');
  if (snapBtn) {
    snapBtn.addEventListener('click', () => {
      const wasPaused = !animFrameId;
      stopAnimation();
      downloadPNG();
      if (!wasPaused) startAnimation();
    });
    snapBtn.style.display = 'none'; // hidden until animation on
  }

  // ── Per-letter sliders ──
  wirePlSlider('pl-rotation', 'pl-rotation-val', 'rotation', '°');
  wirePlSlider('pl-scale',    'pl-scale-val',    'scale',    '×', 2);
  wirePlSlider('pl-skew',     'pl-skew-val',     'skew',     '°');

  // ── Per-letter kerning ──
  const plKerningEl = document.getElementById('pl-kerning');
  if (plKerningEl) {
    plKerningEl.addEventListener('input', () => {
      const idx = state.selectedLetter;
      if (idx === null) return;
      if (!state.letterOverrides[idx]) state.letterOverrides[idx] = {};
      state.letterOverrides[idx].kerning = parseFloat(plKerningEl.value);
      const val = document.getElementById('pl-kerning-val');
      if (val) val.textContent = parseFloat(plKerningEl.value).toFixed(2);
      scheduleRender();
    });
  }

  // ── Per-letter cell size ──
  const plCellSizeEl = document.getElementById('pl-cell-size');
  if (plCellSizeEl) {
    plCellSizeEl.addEventListener('input', () => {
      const idx = state.selectedLetter;
      if (idx === null) return;
      if (!state.letterOverrides[idx]) state.letterOverrides[idx] = {};
      const cs = parseInt(plCellSizeEl.value);
      state.letterOverrides[idx].cellSize = cs;
      const val = document.getElementById('pl-cell-size-val');
      if (val) val.textContent = `${cs}px`;
      invalidateGridCache();
      scheduleRender();
    });
  }

  const cellGlobalBtn = document.getElementById('cell-size-global-btn');
  if (cellGlobalBtn) {
    cellGlobalBtn.addEventListener('click', () => {
      const idx = state.selectedLetter;
      if (idx === null) return;
      if (state.letterOverrides[idx]) delete state.letterOverrides[idx].cellSize;
      const val = document.getElementById('pl-cell-size-val');
      if (val) val.textContent = 'Global';
      const el = document.getElementById('pl-cell-size');
      if (el) el.value = state.pixelHeight;
      invalidateGridCache();
      scheduleRender();
    });
  }

  // ── Aesthetic presets grid ──
  const aestheticGrid = document.getElementById('aesthetic-grid');
  if (aestheticGrid) {
    AESTHETIC_PRESETS.forEach(preset => {
      const card = document.createElement('div');
      card.className = 'aesthetic-card';
      card.dataset.aesthetic = preset.name;
      card.style.setProperty('--card-bg', preset.bgColor);
      card.style.setProperty('--card-fg', preset.charColor);
      card.style.setProperty('--card-font', `"${preset.fontFamily}"`);
      card.textContent = preset.name;
      card.addEventListener('click', () => applyAesthetic(preset.name));
      aestheticGrid.appendChild(card);
    });
  }

  // ── Per-letter color ──
  const plColorEl = document.getElementById('pl-color');
  if (plColorEl) {
    plColorEl.addEventListener('input', () => {
      const idx = state.selectedLetter;
      if (idx === null) return;
      if (!state.letterOverrides[idx]) state.letterOverrides[idx] = {};
      state.letterOverrides[idx].color = plColorEl.value;
      const hexEl = document.getElementById('pl-color-hex');
      if (hexEl) hexEl.textContent = plColorEl.value;
      scheduleRender();
    });
  }

  // ── Per-letter fill char ──
  const plFillCharEl = document.getElementById('pl-fill-char');
  if (plFillCharEl) {
    plFillCharEl.addEventListener('input', () => {
      const idx = state.selectedLetter;
      if (idx === null) return;
      if (!state.letterOverrides[idx]) state.letterOverrides[idx] = {};
      state.letterOverrides[idx].fillChar = plFillCharEl.value;
      scheduleRender();
    });
  }

  // ── Reset letter ──
  const resetLetterBtn = document.getElementById('reset-letter-btn');
  if (resetLetterBtn) {
    resetLetterBtn.addEventListener('click', () => {
      const idx = state.selectedLetter;
      if (idx === null) return;
      delete state.letterOverrides[idx];
      const rawText = state.bigText.trim().toUpperCase() || 'O';
      updatePerLetterPanel(rawText[idx], idx);
      scheduleRender();
    });
  }

  // ── Deselect letter ──
  const deselectBtn = document.getElementById('deselect-btn');
  if (deselectBtn) {
    deselectBtn.addEventListener('click', () => {
      state.selectedLetter = null;
      hidePerLetterPanel();
      scheduleRender();
    });
  }

  // ── Global controls accordion ──
  const accordionHeader = document.getElementById('global-accordion-header');
  if (accordionHeader) {
    accordionHeader.addEventListener('click', () => {
      const panel = document.getElementById('global-controls-accordion');
      if (panel) panel.classList.toggle('collapsed');
    });
  }

  // ── Download ──
  document.getElementById('download-btn').addEventListener('click', downloadPNG);

  // ── Reset all ──
  document.getElementById('reset-btn').addEventListener('click', () => {
    // Restore defaults
    Object.assign(state, {
      bigText: 'O', smallText: 'O', pixelHeight: 57, widthRatio: 0.55,
      tracking: 0.07, inkThreshold: 100, fillDensity: 1.0, canvasPadding: 0,
      bgColor: '#000000', charColor: '#1a6bff', hollowColor: '#ffffff',
      gradientType: 'none', gradientA: '#1a6bff', gradientB: '#a371f7',
      grainAmount: 0, fontWeight: '400', fontFamily: 'Space Mono',
      layout: 'horizontal', letterAlign: 'bottom', allowOverlap: false,
      animMode: 'none', animSpeed: 1.0,
      selectedLetter: null, letterOverrides: {}, offsets: {}, yOffsets: {},
    });

    stopAnimation();
    invalidateGridCache();
    hidePerLetterPanel();
    document.querySelectorAll('.aesthetic-card').forEach(c => c.classList.remove('active'));
    syncAllControls();
    scheduleRender();
    showToast('✓ Reset to default');
    // Also reset gradient layer
    glState.enabled = false;
    glState.groups  = [];
    glState.nextGroupId = 0;
    glState.paintingGroupId = null;
    glState._lastPt = null;
    gradientEngine.clear();
    _syncGlUI();
  });
}

/* ═════════════════════════════════════════════════════════════════════════
   GRADIENT LAYER CONTROLLER
   ═════════════════════════════════════════════════════════════════════════ */

/** Sample gradient engine pixel at logical canvas coords. Returns CSS hex color string. */
function _sampleGlColor(lx, ly, canvasW, canvasH) {
  if (!glState.engineReady) return state.charColor;
  const glCvs = gradientEngine.getCanvas();
  const gl    = gradientEngine.gl;
  if (!gl) return state.charColor;
  // Convert logical coords to GL canvas pixel coords
  const px = Math.round((lx / canvasW) * glCvs.width);
  const py = Math.round((ly / canvasH) * glCvs.height);
  const buf = new Uint8Array(4);
  // Read from WebGL (note: WebGL y-axis is flipped)
  const readY = glCvs.height - py - 1;
  gl.readPixels(px, readY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  if (buf[3] < 10) return state.charColor;  // transparent = no gradient here
  return `rgb(${buf[0]},${buf[1]},${buf[2]})`;
}

/** Convert canvas mouse event to logical canvas coordinates. */
function _canvasCoords(e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / PREVIEW_SCALE / rect.width;
  const scaleY = canvas.height / PREVIEW_SCALE / rect.height;
  const src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top)  * scaleY,
  };
}

/** Render gradient engine then redraw poster. */
function _glRender() {
  gradientEngine.render({
    grain: glState.grain > 0,
    grainAmount: glState.grain,
    opacity: glState.opacity,
  });
  scheduleRender();
}

/** Sync all GL panel UI to current glState. */
function _syncGlUI() {
  const body   = document.getElementById('gl-body');
  const toggle = document.getElementById('gl-toggle');
  if (toggle) toggle.checked = glState.enabled;
  if (body)   body.style.display = glState.enabled ? '' : 'none';

  // Render group list
  const list = document.getElementById('gl-group-list');
  if (!list) return;
  list.innerHTML = '';
  glState.groups.forEach(g => {
    const item = document.createElement('div');
    item.className = 'gl-group-item' + (glState.paintingGroupId === g.id ? ' is-active' : '');
    item.dataset.gid = g.id;
    item.innerHTML = `
      <div class="gl-swatch" style="background:${g.color}" title="Change color"></div>
      <input type="color" class="gl-swatch-input" value="${g.color}">
      <span class="gl-group-label">Stroke ${g.id + 1}</span>
      <button class="gl-draw-btn${glState.paintingGroupId === g.id ? ' is-painting' : ''}" data-gid="${g.id}">
        ${glState.paintingGroupId === g.id ? 'Painting…' : 'Draw'}
      </button>
      <button class="gl-del-btn" data-del="${g.id}" aria-label="Delete group">×</button>
    `;
    // Swatch click → open color picker
    const swatch = item.querySelector('.gl-swatch');
    const picker = item.querySelector('.gl-swatch-input');
    swatch.addEventListener('click', () => picker.click());
    picker.addEventListener('input', () => {
      g.color = picker.value;
      swatch.style.background = g.color;
      gradientEngine.updateGroupColor(g.id, g.color);
      _glRender();
    });
    // Draw button → toggle paint mode
    const drawBtn = item.querySelector('.gl-draw-btn');
    drawBtn.addEventListener('click', () => {
      if (glState.paintingGroupId === g.id) {
        _exitPaintMode();
      } else {
        _enterPaintMode(g.id);
      }
    });
    // Delete button
    const delBtn = item.querySelector('.gl-del-btn');
    delBtn.addEventListener('click', () => {
      glState.groups = glState.groups.filter(x => x.id !== g.id);
      if (glState.paintingGroupId === g.id) _exitPaintMode();
      _syncGlUI();
      _glRender();
    });
    list.appendChild(item);
  });
}

function _enterPaintMode(groupId) {
  glState.paintingGroupId = groupId;
  glState._lastPt = null;
  document.querySelector('.canvas-workspace').classList.add('gl-painting');
  document.querySelector('.canvas-header').classList.add('gl-painting');
  // Suspend normal letter interaction
  canvas.style.pointerEvents = 'auto';
  _syncGlUI();
  showToast('Paint mode — draw on canvas. Esc to stop.', 3000);
}

function _exitPaintMode() {
  glState.paintingGroupId = null;
  glState._lastPt = null;
  document.querySelector('.canvas-workspace').classList.remove('gl-painting');
  document.querySelector('.canvas-header').classList.remove('gl-painting');
  _syncGlUI();
}

/** Add a new color group and register it with the engine. */
function _glAddGroup(color) {
  const id = gradientEngine.addGroup(color);
  if (id < 0) { showToast('Max 30 stroke groups reached'); return; }
  glState.groups.push({ id, color });
  glState.nextGroupId = id + 1;
  _syncGlUI();
  _enterPaintMode(id);
}

/** Paint handlers — only active when paintingGroupId is set */
function _onGlPaintStart(e) {
  if (glState.paintingGroupId === null) return;
  if (!glState.engineReady) return;
  e.preventDefault();
  e.stopPropagation();
  const pt = _canvasCoords(e);
  // Ensure engine is sized to current canvas
  const rawText = state.bigText.trim().toUpperCase() || 'O';
  const letters = rawText.split('');
  const { canvasW, canvasH } = computeLayout(letters);
  if (gradientEngine.width !== Math.round(canvasW) || gradientEngine.height !== Math.round(canvasH)) {
    gradientEngine.resize(Math.round(canvasW), Math.round(canvasH));
  }
  glState._lastPt = pt;
  // Add a tiny segment (point) so single clicks register
  gradientEngine.addSegment(glState.paintingGroupId,
    { x: pt.x - 0.5, y: pt.y - 0.5 },
    { x: pt.x + 0.5, y: pt.y + 0.5 }
  );
  scheduleRender();
}

function _onGlPaintMove(e) {
  if (glState.paintingGroupId === null || !glState._lastPt) return;
  e.preventDefault();
  e.stopPropagation();
  const pt = _canvasCoords(e);
  gradientEngine.addSegment(glState.paintingGroupId, glState._lastPt, pt);
  glState._lastPt = pt;
  scheduleRender();
}

function _onGlPaintEnd(e) {
  if (glState.paintingGroupId === null) return;
  glState._lastPt = null;
}

function wireGradientLayer() {
  // Toggle
  const toggle = document.getElementById('gl-toggle');
  toggle?.addEventListener('change', async () => {
    glState.enabled = toggle.checked;
    if (glState.enabled && !glState.engineReady) {
      showToast('Initialising gradient engine…', 2000);
      const ok = await gradientEngine.init(
        Math.round(canvas.width  / PREVIEW_SCALE),
        Math.round(canvas.height / PREVIEW_SCALE)
      );
      glState.engineReady = ok;
      if (!ok) {
        showToast('WebGL not available — gradient layer disabled');
        glState.enabled = false;
        toggle.checked = false;
      } else {
        showToast('✓ Gradient layer ready — add a color to start painting');
      }
    }
    const body = document.getElementById('gl-body');
    if (body) body.style.display = glState.enabled ? '' : 'none';
    scheduleRender();
  });

  // Opacity
  const opacityEl = document.getElementById('gl-opacity');
  const opacityVal = document.getElementById('gl-opacity-val');
  opacityEl?.addEventListener('input', () => {
    glState.opacity = parseFloat(opacityEl.value);
    if (opacityVal) opacityVal.textContent = `${Math.round(glState.opacity * 100)}%`;
    _glRender();
  });

  // Blend target
  document.querySelectorAll('[data-blend]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-blend]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      glState.blendTarget = btn.dataset.blend;
      scheduleRender();
    });
  });

  // Brush size (cosmetic — engine uses segment thickness via shader falloff)
  const brushEl  = document.getElementById('gl-brush');
  const brushVal = document.getElementById('gl-brush-val');
  brushEl?.addEventListener('input', () => {
    glState.brushSize = parseInt(brushEl.value);
    if (brushVal) brushVal.textContent = `${glState.brushSize}px`;
  });

  // Grain
  const glGrainEl  = document.getElementById('gl-grain');
  const glGrainVal = document.getElementById('gl-grain-val');
  glGrainEl?.addEventListener('input', () => {
    glState.grain = parseFloat(glGrainEl.value);
    if (glGrainVal) glGrainVal.textContent = `${Math.round(glState.grain * 100)}%`;
    _glRender();
  });

  // Add Color
  document.getElementById('gl-add-group')?.addEventListener('click', () => {
    if (!glState.enabled) { showToast('Enable Gradient Layer first'); return; }
    if (!glState.engineReady) { showToast('Engine not ready yet'); return; }
    // Default colors cycle through a vibrant set
    const defaults = ['#ff3300','#0033ff','#00cc88','#ff00aa','#ffee00','#aa00ff'];
    const color = defaults[glState.groups.length % defaults.length];
    _glAddGroup(color);
  });

  // Clear all
  document.getElementById('gl-clear')?.addEventListener('click', () => {
    _exitPaintMode();
    glState.groups = [];
    glState.nextGroupId = 0;
    gradientEngine.clear();
    _syncGlUI();
    scheduleRender();
    showToast('✓ Gradient layer cleared');
  });

  // ── Canvas paint events (intercept before letter handler when painting) ──
  canvas.addEventListener('mousedown', _onGlPaintStart, { capture: true });
  window.addEventListener('mousemove', e => {
    if (glState.paintingGroupId !== null) _onGlPaintMove(e);
  }, { capture: true });
  window.addEventListener('mouseup', _onGlPaintEnd, { capture: true });

  canvas.addEventListener('touchstart', _onGlPaintStart, { capture: true, passive: false });
  window.addEventListener('touchmove', e => {
    if (glState.paintingGroupId !== null) _onGlPaintMove(e);
  }, { capture: true, passive: false });
  window.addEventListener('touchend', _onGlPaintEnd, { capture: true });
}


function syncAllControls() {
  const sv = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const st = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

  sv('big-text',       state.bigText);
  sv('small-text',     state.smallText);
  sv('pixel-height',   state.pixelHeight);   st('pixel-height-val',   `${state.pixelHeight}px`);
  sv('width-ratio',    state.widthRatio);    st('width-ratio-val',    state.widthRatio.toFixed(2));
  sv('tracking',       state.tracking);      st('tracking-val',       `${Math.round(state.tracking * 100)}%`);
  sv('ink-threshold',  state.inkThreshold);  st('ink-threshold-val',  state.inkThreshold);
  sv('fill-density',   state.fillDensity);   st('fill-density-val',   state.fillDensity.toFixed(2));
  sv('canvas-padding', state.canvasPadding); st('canvas-padding-val', `${state.canvasPadding}px`);
  sv('grain-amount',   state.grainAmount);   st('grain-amount-val',   state.grainAmount.toFixed(2));
  sv('anim-speed',     state.animSpeed);     st('anim-speed-val',     `${state.animSpeed.toFixed(2)}×`);
  sv('bg-color',     state.bgColor);     st('bg-color-hex',     state.bgColor);
  sv('char-color',   state.charColor);   st('char-color-hex',   state.charColor);
  sv('hollow-color', state.hollowColor); st('hollow-color-hex', state.hollowColor);
  sv('gradient-a',   state.gradientA);
  sv('gradient-b',   state.gradientB);
  sv('font-weight',  state.fontWeight);
  sv('font-family',  state.fontFamily);

  document.querySelectorAll('[data-layout]').forEach(b => b.classList.toggle('active', b.dataset.layout === state.layout));
  document.querySelectorAll('[data-align]').forEach(b => b.classList.toggle('active', b.dataset.align === state.letterAlign));
  document.querySelectorAll('[data-anim]').forEach(b => b.classList.toggle('active', b.dataset.anim === state.animMode));
  document.querySelectorAll('.grad-pill').forEach(p => p.classList.toggle('active', p.dataset.grad === state.gradientType));

  const snapBtn   = document.getElementById('snapshot-btn');
  const speedWrap = document.getElementById('anim-speed-wrap');
  if (snapBtn)   snapBtn.style.display   = state.animMode === 'none' ? 'none' : 'flex';
  if (speedWrap) speedWrap.style.display = state.animMode === 'none' ? 'none' : 'block';
  const gradColors = document.getElementById('gradient-colors');
  if (gradColors) gradColors.style.display = state.gradientType === 'none' ? 'none' : 'flex';
}

// ── Helpers ──
function wireSlider(inputId, valId, setter, unit = '', decimals = 0) {
  const el  = document.getElementById(inputId);
  const vel = document.getElementById(valId);
  if (!el) return;
  el.addEventListener('input', () => {
    setter(el.value);
    if (vel) vel.textContent = decimals > 0
      ? `${parseFloat(el.value).toFixed(decimals)}${unit}`
      : `${el.value}${unit}`;
    scheduleRender();
  });
}

function wireColor(inputId, hexId, stateKey) {
  const el    = document.getElementById(inputId);
  const hexEl = document.getElementById(hexId);
  if (!el) return;
  el.addEventListener('input', () => {
    state[stateKey] = el.value;
    if (hexEl) hexEl.textContent = el.value;
    scheduleRender();
  });
  const wrap = el.closest('.color-swatch-wrap');
  if (wrap) wrap.addEventListener('click', () => el.click());
}

function wirePlSlider(inputId, valId, ovKey, unit = '', decimals = 0) {
  const el  = document.getElementById(inputId);
  const vel = document.getElementById(valId);
  if (!el) return;
  el.addEventListener('input', () => {
    const idx = state.selectedLetter;
    if (idx === null) return;
    if (!state.letterOverrides[idx]) state.letterOverrides[idx] = {};
    state.letterOverrides[idx][ovKey] = decimals > 0 ? parseFloat(el.value) : parseInt(el.value);
    if (vel) vel.textContent = decimals > 0
      ? `${parseFloat(el.value).toFixed(decimals)}${unit}`
      : `${el.value}${unit}`;
    scheduleRender();
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════════════════════════════════════ */

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); downloadPNG(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { state.offsets = {}; state.yOffsets = {}; scheduleRender(); }
  if (e.key === 'Escape') {
    // Exit gradient paint mode first if active
    if (glState.paintingGroupId !== null) {
      _exitPaintMode();
      return;
    }
    state.selectedLetter = null;
    hidePerLetterPanel();
    scheduleRender();
  }

  // Arrow key nudge for selected letter (1px; 10px with Shift)
  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  if (ARROWS.includes(e.key) && state.selectedLetter !== null) {
    // Only nudge if the focus is NOT inside a text/number input (let those handle arrows naturally)
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' && document.activeElement.type !== 'range') return;

    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const idx  = state.selectedLetter;
    const cur  = state.offsets[idx] || 0;

    if (e.key === 'ArrowLeft')  state.offsets[idx] = cur - step;
    if (e.key === 'ArrowRight') state.offsets[idx] = cur + step;
    // Up/Down only make sense in vertical/grid layouts; in horizontal they do nothing visible
    // but we still store them for consistency (layout positions use y from computeLayout)
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && state.layout !== 'horizontal') {
      // For vertical/grid: adjust the y via a dedicated yOffsets map
      if (!state.yOffsets) state.yOffsets = {};
      const curY = state.yOffsets[idx] || 0;
      state.yOffsets[idx] = curY + (e.key === 'ArrowDown' ? step : -step);
    }
    scheduleRender();
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════════════ */

async function init() {
  wireInputs();
  wireGradientLayer();
  try { await document.fonts.ready; } catch (_) {}
  scheduleRender();
}

init();
