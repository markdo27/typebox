/* ═══════════════════════════════════════════════════════════════════
   GradientEngine — WebGL distance-field gradient renderer
   Ported and extended from Gradientor (afterimage.cc)
   Architecture:
     • One WebGL canvas (hidden, same size as poster)
     • Two framebuffers per "page" (ping-pong for accumulation)
     • Up to 8 pages × 4 channels = 32 group slots (we expose 30)
     • Data pass: each stroke segment feeds datatexture shader
     • Render pass: combines all distance maps into final gradient
   ═══════════════════════════════════════════════════════════════════ */

class GradientEngine {
  constructor() {
    this.canvas  = document.createElement('canvas');
    this.gl      = null;
    this.width   = 800;
    this.height  = 800;

    // Shader programs
    this._dataProg   = null;
    this._renderProg = null;

    // Distance-field framebuffers — 8 pages, each holds 4 channels (= 4 groups)
    // Each page has 2 FBOs for ping-pong accumulation
    this.MAX_PAGES  = 8;
    this.MAX_GROUPS = 30;
    this._pages     = []; // [{fbo0, fbo1, tex0, tex1, active}, ...]
    this._activePage = 0; // which of the two ping-pong FBOs is "current"

    // Group colors (RGB, 0..1)
    this._colors     = new Float32Array(30 * 3);  // u_colors[30]
    this._groupCount = 0;

    // Full-screen quad
    this._quadBuf = null;
    this._texBuf  = null;

    // Uniform locations — data shader
    this._dataLoc = {};
    // Uniform locations — render shader
    this._renderLoc = {};

    this._ready = false;
  }

  // ─── Public API ──────────────────────────────────────────────────

  /** Initialize WebGL context and compile shaders. Returns promise. */
  async init(width, height) {
    this.width  = width;
    this.height = height;
    this.canvas.width  = width;
    this.canvas.height = height;

    const gl = this.canvas.getContext('webgl', {
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      alpha: true,
    });

    if (!gl) {
      console.error('[GradientEngine] WebGL not available');
      return false;
    }

    this.gl = gl;

    // Check required extensions
    const ext = gl.getExtension('OES_texture_float');
    if (!ext) {
      console.warn('[GradientEngine] OES_texture_float not available — falling back to half precision');
    }
    gl.getExtension('OES_texture_float_linear');

    // Load & compile shaders
    const [vertSrc, dataSrc, renderSrc] = await Promise.all([
      this._fetchShader('./gradient.vert'),
      this._fetchShader('./gradient-data.frag'),
      this._fetchShader('./gradient-render.frag'),
    ]);

    this._dataProg   = this._compileProgram(vertSrc, dataSrc);
    this._renderProg = this._compileProgram(vertSrc, renderSrc);

    if (!this._dataProg || !this._renderProg) return false;

    // Cache uniform locations — data shader
    gl.useProgram(this._dataProg);
    this._dataLoc = {
      aPosition:   gl.getAttribLocation(this._dataProg, 'aPosition'),
      aTexCoord:   gl.getAttribLocation(this._dataProg, 'aTexCoord'),
      u_prevState: gl.getUniformLocation(this._dataProg, 'u_prevState'),
      u_ptA:       gl.getUniformLocation(this._dataProg, 'u_ptA'),
      u_ptB:       gl.getUniformLocation(this._dataProg, 'u_ptB'),
      u_groupIndex:gl.getUniformLocation(this._dataProg, 'u_groupIndex'),
      u_res:       gl.getUniformLocation(this._dataProg, 'u_res'),
    };

    // Cache uniform locations — render shader
    gl.useProgram(this._renderProg);
    this._renderLoc = {
      aPosition:   gl.getAttribLocation(this._renderProg, 'aPosition'),
      aTexCoord:   gl.getAttribLocation(this._renderProg, 'aTexCoord'),
      u_dist:      [],
      u_colors:    gl.getUniformLocation(this._renderProg, 'u_colors'),
      u_groupCount:gl.getUniformLocation(this._renderProg, 'u_groupCount'),
      u_grain:     gl.getUniformLocation(this._renderProg, 'u_grain'),
      u_grainAmount:gl.getUniformLocation(this._renderProg, 'u_grainAmount'),
      u_opacity:   gl.getUniformLocation(this._renderProg, 'u_opacity'),
    };
    for (let i = 0; i < this.MAX_PAGES; i++) {
      this._renderLoc.u_dist.push(
        gl.getUniformLocation(this._renderProg, `u_dist[${i}]`)
      );
    }

    // Create full-screen quad
    this._createQuad();

    // Init framebuffer pages (all clear)
    for (let i = 0; i < this.MAX_PAGES; i++) {
      this._pages.push(this._createPage());
    }

    this._clearAllPages();
    this._ready = true;
    return true;
  }

  /** Resize the engine (recreates framebuffers). */
  resize(width, height) {
    this.width  = width;
    this.height = height;
    this.canvas.width  = width;
    this.canvas.height = height;
    if (!this._ready) return;
    for (const page of this._pages) this._destroyPage(page);
    this._pages = [];
    for (let i = 0; i < this.MAX_PAGES; i++) this._pages.push(this._createPage());
    this._clearAllPages();
  }

  /**
   * Add a stroke segment for a group.
   * @param {number} groupId  — 0-indexed group
   * @param {{x,y}} ptA — start (pixel coords)
   * @param {{x,y}} ptB — end   (pixel coords)
   */
  addSegment(groupId, ptA, ptB) {
    if (!this._ready || groupId >= this.MAX_GROUPS) return;
    const gl = this.gl;

    const pageIdx = Math.floor(groupId / 4);
    const page    = this._pages[pageIdx];
    const slotInPage = groupId % 4; // which channel in this page's texture

    // Normalise pixel → 0..1
    const ax = ptA.x / this.width,  ay = ptA.y / this.height;
    const bx = ptB.x / this.width,  by = ptB.y / this.height;

    // Bind the data shader
    gl.useProgram(this._dataProg);
    gl.viewport(0, 0, this.width, this.height);

    // Ping-pong: read from current FBO, write to the other
    const readFBO  = page.active === 0 ? page.fbo0 : page.fbo1;
    const writeFBO = page.active === 0 ? page.fbo1 : page.fbo0;
    const readTex  = page.active === 0 ? page.tex0 : page.tex1;

    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO);

    // Bind previous state texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    gl.uniform1i(this._dataLoc.u_prevState, 0);

    gl.uniform2f(this._dataLoc.u_ptA, ax, ay);
    gl.uniform2f(this._dataLoc.u_ptB, bx, by);
    gl.uniform1f(this._dataLoc.u_groupIndex, slotInPage);
    gl.uniform2f(this._dataLoc.u_res, this.width, this.height);

    this._drawQuad(this._dataLoc.aPosition, this._dataLoc.aTexCoord);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Swap active
    page.active = page.active === 0 ? 1 : 0;

    this.render();
  }

  /**
   * Add a new color group. Returns the new groupId.
   * @param {string} hex — e.g. '#ff3300'
   */
  addGroup(hex) {
    const id = this._groupCount;
    if (id >= this.MAX_GROUPS) return -1;
    const [r, g, b] = this._hexToRgb(hex);
    this._colors[id * 3 + 0] = r;
    this._colors[id * 3 + 1] = g;
    this._colors[id * 3 + 2] = b;
    this._groupCount++;
    return id;
  }

  /** Update the color of an existing group. */
  updateGroupColor(groupId, hex) {
    if (groupId < 0 || groupId >= this._groupCount) return;
    const [r, g, b] = this._hexToRgb(hex);
    this._colors[groupId * 3 + 0] = r;
    this._colors[groupId * 3 + 1] = g;
    this._colors[groupId * 3 + 2] = b;
    this.render();
  }

  /** Clear all strokes and groups. */
  clear() {
    this._groupCount = 0;
    this._colors.fill(0);
    this._clearAllPages();
    this.render();
  }

  /**
   * Render the gradient to the WebGL canvas.
   * @param {{grain, grainAmount, opacity}} opts
   */
  render(opts = {}) {
    if (!this._ready) return;
    const gl = this.gl;
    const { grain = false, grainAmount = 0, opacity = 1 } = opts;

    gl.useProgram(this._renderProg);
    gl.viewport(0, 0, this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Bind each page's current texture to a texture unit
    for (let i = 0; i < this.MAX_PAGES; i++) {
      const page   = this._pages[i];
      const curTex = page.active === 0 ? page.tex0 : page.tex1;
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, curTex);
      gl.uniform1i(this._renderLoc.u_dist[i], i);
    }

    gl.uniform3fv(this._renderLoc.u_colors, this._colors);
    gl.uniform1i(this._renderLoc.u_groupCount, this._groupCount);
    gl.uniform1i(this._renderLoc.u_grain, grain ? 1 : 0);
    gl.uniform1f(this._renderLoc.u_grainAmount, grainAmount);
    gl.uniform1f(this._renderLoc.u_opacity, opacity);

    this._drawQuad(this._renderLoc.aPosition, this._renderLoc.aTexCoord);
  }

  /** Returns the WebGL canvas (use with ctx.drawImage). */
  getCanvas() { return this.canvas; }

  /** True if engine is ready. */
  get ready() { return this._ready; }

  // ─── Private helpers ─────────────────────────────────────────────

  async _fetchShader(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`[GradientEngine] Failed to load shader: ${url}`);
    return r.text();
  }

  _compileShader(src, type) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[GradientEngine] Shader compile error:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  _compileProgram(vertSrc, fragSrc) {
    const gl   = this.gl;
    const vert = this._compileShader(vertSrc, gl.VERTEX_SHADER);
    const frag = this._compileShader(fragSrc, gl.FRAGMENT_SHADER);
    if (!vert || !frag) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[GradientEngine] Program link error:', gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  _createQuad() {
    const gl = this.gl;
    // Full-screen quad: two triangles covering NDC -1..1
    const pos = new Float32Array([-1,-1,0,  1,-1,0,  -1,1,0,  1,1,0]);
    const tex = new Float32Array([ 0, 0,   1, 0,    0,1,   1,1 ]);
    this._quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    this._texBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._texBuf);
    gl.bufferData(gl.ARRAY_BUFFER, tex, gl.STATIC_DRAW);
  }

  _drawQuad(posLoc, texLoc) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuf);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._texBuf);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(texLoc);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _createPage() {
    const gl = this.gl;
    const type = gl.getExtension('OES_texture_float') ? gl.FLOAT : gl.UNSIGNED_BYTE;
    const internalFmt = gl.RGBA;

    const mkTex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, this.width, this.height, 0, internalFmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };

    const mkFBO = (tex) => {
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return fbo;
    };

    const tex0 = mkTex(), tex1 = mkTex();
    return { tex0, tex1, fbo0: mkFBO(tex0), fbo1: mkFBO(tex1), active: 0 };
  }

  _destroyPage(page) {
    const gl = this.gl;
    gl.deleteFramebuffer(page.fbo0);
    gl.deleteFramebuffer(page.fbo1);
    gl.deleteTexture(page.tex0);
    gl.deleteTexture(page.tex1);
  }

  _clearAllPages() {
    const gl = this.gl;
    for (const page of this._pages) {
      for (const fbo of [page.fbo0, page.fbo1]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        // Fill with 9999.0 (max distance) — use max float hack via UNSIGNED_BYTE + normalized
        // We clear to 1.0 which the shader interprets as "very far"
        gl.clearColor(1, 1, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      page.active = 0;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
}

// Singleton
const gradientEngine = new GradientEngine();
