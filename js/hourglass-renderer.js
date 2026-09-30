/*
 * Ampulheta — hourglass-renderer.js
 * Desenho da ampulheta em Canvas 2D.
 *
 * Camadas (canvases empilhados, do tamanho da ampulheta — não da tela):
 *   1. fundo  (estático): base inferior, hastes, corpo do vidro;
 *   2. areia  (dinâmico): massa superior e inferior, filete e grãos;
 *   3. frente (estático): reflexos, contorno do vidro, base superior.
 * As camadas estáticas só são pintadas quando o tamanho muda. A massa de areia
 * fica num cache e só é repintada quando a superfície se move ≥ 0,2 px; entre
 * uma coisa e outra, um quadro custa uma cópia de bitmap e alguns grãos.
 * Quando nada visível muda, nenhum pixel é tocado.
 *
 * Os grãos visíveis são funções puras do tempo (ver grain-engine.js): o
 * renderizador não guarda estado de partículas.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { clamp, lerp, hash32, random01 } = A.utils;
  const Grains = A.grains;

  /** Achatamento das elipses: a câmera olha levemente de cima. */
  const ELEVATION = 0.15;
  const CAP_HEIGHT = 0.072;
  const ROD_RADIUS = 0.0155;

  /** Física visual da queda (unidades de altura de bulbo / s²). */
  const GRAVITY = 6.2;
  const V0 = 0.22;
  const RELEASE_Y = 0.004;
  const SETTLE_S = 0.32;
  const MAX_AIR_S = 0.75;
  /** Acima desta taxa (grãos/s) desenha-se também um filete contínuo. */
  const STREAM_RATE = 14;
  /** Abaixo desta taxa, cada pouso ganha um pequeno respingo. */
  const SPARSE_RATE = 1.2;
  const MAX_PARTICLES = 220;
  /** Janela em que um grão ainda está visível (no ar ou assentando). */
  const WINDOW_MS = (MAX_AIR_S + SETTLE_S) * 1000;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(rgb, a) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  }

  function mix(c1, c2, t) {
    return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
  }

  const TONE_HEX = {
    areia: { light: '#d9bf92', base: '#b39365', mid: '#957652', dark: '#5f4830', deep: '#2c2116', grain: '#e6cfa4' },
    marfim: { light: '#e6ddcb', base: '#c6bca8', mid: '#a59b88', dark: '#6c6559', deep: '#34312b', grain: '#f0e9dc' },
    cinza: { light: '#c2beb7', base: '#96938d', mid: '#7b7873', dark: '#4e4c49', deep: '#262523', grain: '#d3d0ca' },
    ferrugem: { light: '#cf9a76', base: '#a46d4b', mid: '#86563a', dark: '#553626', deep: '#2a1a11', grain: '#dba886' }
  };

  const TONES = {};
  for (const key of Object.keys(TONE_HEX)) {
    const t = TONE_HEX[key];
    TONES[key] = {};
    for (const k of Object.keys(t)) TONES[key][k] = hexToRgb(t[k]);
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
  }

  /** Limite de pixels por camada (evita canvases gigantes em telas de alta densidade). */
  const MAX_LAYER_PIXELS = 5.2e6;

  function createLayer(className) {
    const c = document.createElement('canvas');
    c.className = className;
    c.setAttribute('aria-hidden', 'true');
    return c;
  }

  /**
   * Cria o renderizador dentro de `host`.
   * Estrutura (todas as camadas têm o tamanho da ampulheta, não da tela):
   *   .hg-shadow        sombra no chão (CSS, fica no chão durante a virada)
   *   .hg-object        objeto (gira como um todo durante a virada)
   *     canvas back     base inferior, hastes, corpo do vidro   — estático
   *     canvas sand     areia, filete e grãos                    — dinâmico
   *     canvas front    reflexos, contorno, base superior        — estático
   */
  function createRenderer(host) {
    const glass = A.geometry.createGlass();
    const sand = A.geometry.createSandModel(glass);
    const R = glass.maxRadius;
    const CAP_R = R + 0.082;
    const ROD_X = CAP_R - 0.042;

    const shadowEl = document.createElement('div');
    shadowEl.className = 'hg-shadow';
    shadowEl.setAttribute('aria-hidden', 'true');
    const objectEl = document.createElement('div');
    objectEl.className = 'hg-object';
    const backCv = createLayer('hg-layer hg-layer--back');
    const sandCv = createLayer('hg-layer hg-layer--sand');
    const frontCv = createLayer('hg-layer hg-layer--front');
    objectEl.append(backCv, sandCv, frontCv);
    host.append(shadowEl, objectEl);
    const sctx = sandCv.getContext('2d');

    // Cache da massa de areia: só é redesenhado quando a areia se move ≥ 0,2 px.
    const sandCache = document.createElement('canvas');
    const cctx = sandCache.getContext('2d');

    let dpr = 1;
    let cssW = 0;
    let cssH = 0;
    let insets = { top: 0, bottom: 0, side: 0 };
    let L = null; // layout
    let staticReady = false;
    let sandCacheKey = null;
    let lastBlitKey = null;
    let lastDynamic = false;
    let solved = { key: null, top: null, bottom: null };
    const patterns = new WeakMap();
    const gradients = new WeakMap();

    /* -------------------------------------------------------------- */
    /* Layout                                                           */
    /* -------------------------------------------------------------- */

    function computeLayout(deviceRatio) {
      const unitsH = 2 + 2 * CAP_HEIGHT + 2 * CAP_R * ELEVATION + 0.06;
      const unitsW = 2 * CAP_R + 0.04;
      const availH = Math.max(40, cssH - insets.top - insets.bottom);
      const availW = Math.max(40, cssW - 2 * insets.side);
      const S = Math.max(10, Math.min(availH / unitsH, availW / unitsW));
      const cx = Math.round(cssW / 2);
      const cy = Math.round(insets.top + availH / 2);
      // Caixa simétrica em torno do gargalo: continua válida com a ampulheta virada.
      const halfW = CAP_R * 1.06 * S + 2;
      const halfH = (1 + CAP_HEIGHT + CAP_R * ELEVATION + 0.02) * S + 2;
      const x = Math.floor(cx - halfW);
      const y = Math.floor(cy - halfH);
      const w = Math.ceil(cx + halfW) - x;
      const h = Math.ceil(cy + halfH) - y;
      let ratio = clamp(deviceRatio || 1, 1, 2);
      if (w * h * ratio * ratio > MAX_LAYER_PIXELS) ratio = Math.max(1, Math.sqrt(MAX_LAYER_PIXELS / (w * h)));
      return { S, cx, cy, x, y, w, h, ox: cx - x, oy: cy - y, dpr: ratio };
    }

    const X = (x) => L.ox + x * L.S;
    const Y = (y) => L.oy - y * L.S;

    function sizeCanvas(c) {
      c.width = Math.max(1, Math.round(L.w * dpr));
      c.height = Math.max(1, Math.round(L.h * dpr));
    }

    function resize(width, height, ratio, newInsets) {
      cssW = Math.max(0, Math.round(width));
      cssH = Math.max(0, Math.round(height));
      if (newInsets) insets = Object.assign({}, insets, newInsets);
      if (!cssW || !cssH) {
        L = null;
        return;
      }
      const next = computeLayout(ratio);
      const same =
        L && next.x === L.x && next.y === L.y && next.w === L.w && next.h === L.h && next.dpr === L.dpr && next.S === L.S;
      if (same) return;
      L = next;
      dpr = L.dpr;
      objectEl.style.left = L.x + 'px';
      objectEl.style.top = L.y + 'px';
      objectEl.style.width = L.w + 'px';
      objectEl.style.height = L.h + 'px';
      objectEl.style.transformOrigin = L.ox + 'px ' + L.oy + 'px';
      [backCv, sandCv, frontCv, sandCache].forEach(sizeCanvas);
      // Sombra e poça de luz no chão.
      const baseY = L.cy + (1 + CAP_HEIGHT) * L.S;
      const sw = CAP_R * 5.2 * L.S;
      const sh = sw * 0.2;
      shadowEl.style.left = Math.round(L.cx - sw / 2) + 'px';
      shadowEl.style.top = Math.round(baseY - sh / 2) + 'px';
      shadowEl.style.width = Math.round(sw) + 'px';
      shadowEl.style.height = Math.round(sh) + 'px';
      staticReady = false;
      sandCacheKey = null;
      lastBlitKey = null;
    }

    function layout() {
      return L ? { S: L.S, cx: L.cx, cy: L.cy, box: { x: L.x, y: L.y, w: L.w, h: L.h } } : null;
    }

    /* -------------------------------------------------------------- */
    /* Caminhos                                                         */
    /* -------------------------------------------------------------- */

    const PROFILE_STEPS = 140;

    function traceOuter(c) {
      c.beginPath();
      for (let i = 0; i <= PROFILE_STEPS * 2; i++) {
        const y = -1 + i / PROFILE_STEPS;
        const x = glass.outer(y);
        if (i === 0) c.moveTo(X(x), Y(y));
        else c.lineTo(X(x), Y(y));
      }
      for (let i = PROFILE_STEPS * 2; i >= 0; i--) {
        const y = -1 + i / PROFILE_STEPS;
        c.lineTo(X(-glass.outer(y)), Y(y));
      }
      c.closePath();
    }

    /** Interior de um bulbo. dir = +1 (superior) ou −1 (inferior). */
    function traceInner(c, dir) {
      c.beginPath();
      c.moveTo(X(glass.inner(0)), Y(0));
      for (let i = 1; i <= PROFILE_STEPS; i++) {
        const s = i / PROFILE_STEPS;
        c.lineTo(X(glass.inner(s)), Y(dir * s));
      }
      for (let i = PROFILE_STEPS; i >= 0; i--) {
        const s = i / PROFILE_STEPS;
        c.lineTo(X(-glass.inner(s)), Y(dir * s));
      }
      c.closePath();
    }

    function ellipsePath(c, x, y, rx, ry) {
      c.beginPath();
      c.ellipse(X(x), Y(y), Math.max(0.01, rx * L.S), Math.max(0.01, ry * L.S), 0, 0, Math.PI * 2);
    }

    /* -------------------------------------------------------------- */
    /* Utilitários de pintura                                           */
    /* -------------------------------------------------------------- */

    /** Preenchimento desfocado via sombra deslocada (funciona em todos os navegadores). */
    function softFill(c, color, blurPx, build) {
      const OFF = 20000;
      c.save();
      c.shadowColor = color;
      c.shadowBlur = blurPx * dpr;
      c.shadowOffsetX = OFF * dpr;
      c.translate(-OFF, 0);
      c.fillStyle = '#000';
      build(c);
      c.fill();
      c.restore();
    }

    function hGradient(c, x0, x1, stops) {
      const g = c.createLinearGradient(X(x0), 0, X(x1), 0);
      for (const [o, col] of stops) g.addColorStop(o, col);
      return g;
    }

    function vGradient(c, y0, y1, stops) {
      const g = c.createLinearGradient(0, Y(y0), 0, Y(y1));
      for (const [o, col] of stops) g.addColorStop(o, col);
      return g;
    }

    /** Faixa que acompanha o perfil do vidro (reflexos). */
    function traceStreak(c, dir, s0, s1, centerK, widthK, taper) {
      const steps = 60;
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const s = lerp(s0, s1, i / steps);
        const env = Math.pow(Math.sin((Math.PI * i) / steps), taper);
        const r = glass.outer(s);
        pts.push([s, r * centerK, r * widthK * env]);
      }
      c.beginPath();
      pts.forEach(([s, cx, hw], i) => {
        const px = X(cx - hw);
        const py = Y(dir * s);
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      });
      for (let i = pts.length - 1; i >= 0; i--) {
        const [s, cx, hw] = pts[i];
        c.lineTo(X(cx + hw), Y(dir * s));
      }
      c.closePath();
    }

    /* -------------------------------------------------------------- */
    /* Camada de fundo                                                  */
    /* -------------------------------------------------------------- */

    /** Base cilíndrica. yTop/yBottom em unidades. */
    function drawCap(c, yBottom, yTop, isTop) {
      const rx = CAP_R;
      const ry = CAP_R * ELEVATION;
      const S = L.S;
      // Lateral
      c.beginPath();
      c.moveTo(X(-rx), Y(yTop));
      c.lineTo(X(-rx), Y(yBottom));
      c.ellipse(X(0), Y(yBottom), rx * S, ry * S, 0, Math.PI, 0, true);
      c.lineTo(X(rx), Y(yTop));
      c.ellipse(X(0), Y(yTop), rx * S, ry * S, 0, 0, Math.PI, false);
      c.closePath();
      c.fillStyle = hGradient(c, -rx, rx, [
        [0, '#1b1a18'],
        [0.07, '#34312d'],
        [0.2, '#403c37'],
        [0.42, '#26241f'],
        [0.75, '#161513'],
        [1, '#0b0b0a']
      ]);
      c.fill();
      // Friso inferior (luz rasante)
      c.save();
      c.beginPath();
      c.ellipse(X(0), Y(yBottom), rx * S, ry * S, 0, 0.1 * Math.PI, 0.9 * Math.PI, false);
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 1;
      c.stroke();
      c.restore();
      // Face superior
      c.beginPath();
      c.ellipse(X(0), Y(yTop), rx * S, ry * S, 0, 0, Math.PI * 2);
      const g = c.createRadialGradient(X(-rx * 0.35), Y(yTop) - ry * S * 0.4, 0, X(0), Y(yTop), rx * S * 1.1);
      g.addColorStop(0, isTop ? '#3a3632' : '#2f2c28');
      g.addColorStop(0.6, isTop ? '#221f1c' : '#1d1b18');
      g.addColorStop(1, '#141311');
      c.fillStyle = g;
      c.fill();
      // Chanfro: aresta frontal iluminada
      c.beginPath();
      c.ellipse(X(0), Y(yTop), rx * S - 0.5, ry * S - 0.5, 0, 0.05 * Math.PI, 0.95 * Math.PI, false);
      c.strokeStyle = 'rgba(255,238,215,0.13)';
      c.lineWidth = 1;
      c.stroke();
      c.beginPath();
      c.ellipse(X(0), Y(yTop), rx * S - 0.5, ry * S - 0.5, 0, 1.08 * Math.PI, 1.6 * Math.PI, false);
      c.strokeStyle = 'rgba(255,238,215,0.07)';
      c.stroke();
    }

    function drawRods(c) {
      const S = L.S;
      for (const side of [-1, 1]) {
        const x = side * ROD_X;
        c.beginPath();
        c.rect(X(x - ROD_RADIUS), Y(1), ROD_RADIUS * 2 * S, 2 * S);
        c.fillStyle = hGradient(c, x - ROD_RADIUS, x + ROD_RADIUS, [
          [0, '#0e0d0c'],
          [0.3, side < 0 ? '#57514a' : '#3a3632'],
          [0.5, '#2a2724'],
          [1, '#0b0a09']
        ]);
        c.fill();
        // pequenos colares nas extremidades
        for (const yy of [-1, 1]) {
          const h = 0.018 * (yy > 0 ? -1 : 1);
          c.beginPath();
          c.rect(X(x - ROD_RADIUS * 1.5), Y(Math.max(yy, yy + h)), ROD_RADIUS * 3 * S, Math.abs(h) * S);
          c.fillStyle = hGradient(c, x - ROD_RADIUS * 1.5, x + ROD_RADIUS * 1.5, [
            [0, '#121110'],
            [0.35, '#4a453f'],
            [1, '#0e0d0c']
          ]);
          c.fill();
        }
      }
    }

    function drawGlassBack(c) {
      // Corpo do vidro: véu muito tênue, mais claro junto às bordas.
      traceOuter(c);
      c.fillStyle = hGradient(c, -R, R, [
        [0, 'rgba(255,248,236,0.075)'],
        [0.18, 'rgba(255,248,236,0.025)'],
        [0.5, 'rgba(255,248,236,0.012)'],
        [0.85, 'rgba(255,248,236,0.02)'],
        [1, 'rgba(255,248,236,0.06)']
      ]);
      c.fill();
      // Luz ambiente vinda de cima.
      traceOuter(c);
      c.fillStyle = vGradient(c, 1, -1, [
        [0, 'rgba(255,245,230,0.035)'],
        [0.5, 'rgba(255,245,230,0)'],
        [1, 'rgba(0,0,0,0.08)']
      ]);
      c.fill();
    }

    /* -------------------------------------------------------------- */
    /* Camada da frente                                                 */
    /* -------------------------------------------------------------- */

    function drawGlassFront(c) {
      const S = L.S;
      // Véu sobre a areia: a areia está atrás do vidro.
      traceOuter(c);
      c.fillStyle = hGradient(c, -R, R, [
        [0, 'rgba(255,250,240,0.07)'],
        [0.25, 'rgba(255,250,240,0.012)'],
        [0.7, 'rgba(255,250,240,0.008)'],
        [1, 'rgba(255,250,240,0.05)']
      ]);
      c.fill();

      // Brilho de borda (Fresnel): anel suave por dentro do contorno.
      c.save();
      traceOuter(c);
      c.clip();
      traceOuter(c);
      c.strokeStyle = 'rgba(255,248,236,0.035)';
      c.lineWidth = 0.075 * S;
      c.stroke();
      c.strokeStyle = 'rgba(255,248,236,0.05)';
      c.lineWidth = 0.028 * S;
      c.stroke();
      // Parede interna (espessura do vidro)
      for (const dir of [1, -1]) {
        traceInner(c, dir);
        c.strokeStyle = 'rgba(255,248,236,0.06)';
        c.lineWidth = 0.8;
        c.stroke();
      }
      c.restore();

      // Reflexos principais (janela à esquerda, contraluz à direita).
      for (const dir of [1, -1]) {
        const k = dir > 0 ? 1 : 0.8;
        softFill(c, 'rgba(255,252,245,' + (0.2 * k) + ')', 3.2, (cc) => traceStreak(cc, dir, 0.2, 0.93, -0.72, 0.085, 0.7));
        softFill(c, 'rgba(255,252,245,' + (0.22 * k) + ')', 0.9, (cc) => traceStreak(cc, dir, 0.3, 0.86, -0.735, 0.022, 0.9));
        softFill(c, 'rgba(255,252,245,' + (0.075 * k) + ')', 2.2, (cc) => traceStreak(cc, dir, 0.32, 0.8, 0.8, 0.03, 0.8));
        softFill(c, 'rgba(255,252,245,' + (0.03 * k) + ')', 10, (cc) => traceStreak(cc, dir, 0.15, 0.95, -0.25, 0.16, 0.6));
      }

      // Ponto especular no ombro superior.
      const sh = 0.86;
      softFill(c, 'rgba(255,253,248,0.34)', 2.4, (cc) => {
        cc.beginPath();
        cc.ellipse(X(-glass.outer(sh) * 0.5), Y(sh), 0.038 * S, 0.014 * S, -0.35, 0, Math.PI * 2);
      });
      softFill(c, 'rgba(255,253,248,0.12)', 2.4, (cc) => {
        cc.beginPath();
        cc.ellipse(X(-glass.outer(sh) * 0.5), Y(-sh), 0.03 * S, 0.011 * S, 0.35, 0, Math.PI * 2);
      });

      // Contorno
      traceOuter(c);
      c.strokeStyle = hGradient(c, -R, R, [
        [0, 'rgba(255,250,240,0.42)'],
        [0.15, 'rgba(255,250,240,0.2)'],
        [0.5, 'rgba(255,250,240,0.1)'],
        [0.85, 'rgba(255,250,240,0.16)'],
        [1, 'rgba(255,250,240,0.3)']
      ]);
      c.lineWidth = 1;
      c.stroke();

      // Gargalo: pequeno brilho no vidro espesso da constrição.
      const rn = glass.outer(0);
      softFill(c, 'rgba(255,252,245,0.3)', 1.4, (cc) => {
        cc.beginPath();
        cc.ellipse(X(-rn * 0.55), Y(0), Math.max(0.6, 0.006 * S), 0.03 * S, 0, 0, Math.PI * 2);
      });

      // Bordas onde o vidro encontra as bases.
      const rc = glass.outer(1);
      for (const yy of [1, -1]) {
        c.beginPath();
        c.ellipse(X(0), Y(yy), rc * S, rc * ELEVATION * S, 0, 0, Math.PI);
        c.strokeStyle = 'rgba(255,250,240,0.13)';
        c.lineWidth = 1;
        c.stroke();
      }

      drawCap(c, 1, 1 + CAP_HEIGHT, true);
    }

    function paintStatic() {
      for (const [cv, painter] of [
        [backCv, (c) => {
          drawCap(c, -1 - CAP_HEIGHT, -1, false);
          drawRods(c);
          drawGlassBack(c);
        }],
        [frontCv, drawGlassFront]
      ]) {
        const c = cv.getContext('2d');
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, cv.width, cv.height);
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        painter(c);
      }
      staticReady = true;
    }

    /* -------------------------------------------------------------- */
    /* Areia                                                            */
    /* -------------------------------------------------------------- */

    let textureSource = null;
    let textureDpr = 0;

    /** Textura granular (gerada uma vez por densidade de pixels). */
    function patternFor(c) {
      if (!textureSource || textureDpr !== dpr) {
        const size = Math.round(96 * dpr);
        const cv = document.createElement('canvas');
        cv.width = size;
        cv.height = size;
        const tc = cv.getContext('2d');
        const img = tc.createImageData(size, size);
        let seed = 7;
        for (let i = 0; i < size * size; i++) {
          seed = hash32(seed + i);
          const r = seed / 4294967296;
          const o = i * 4;
          if (r < 0.1) {
            img.data[o + 3] = Math.round(20 + r * 500);
          } else if (r > 0.94) {
            img.data[o] = 255;
            img.data[o + 1] = 246;
            img.data[o + 2] = 228;
            img.data[o + 3] = Math.round((r - 0.94) * 1300);
          }
        }
        tc.putImageData(img, 0, 0);
        textureSource = cv;
        textureDpr = dpr;
      }
      let entry = patterns.get(c);
      if (!entry || entry.source !== textureSource) {
        const pattern = c.createPattern(textureSource, 'repeat');
        if (pattern && typeof pattern.setTransform === 'function' && typeof DOMMatrix === 'function') {
          pattern.setTransform(new DOMMatrix().scale(1 / dpr, 1 / dpr));
        }
        entry = { source: textureSource, pattern };
        patterns.set(c, entry);
      }
      return entry.pattern;
    }

    /** Gradientes por contexto, tom e layout (recriados só quando algo muda). */
    function tonePaint(c, tone) {
      let map = gradients.get(c);
      if (!map || map.layout !== L) {
        map = { layout: L, tones: {} };
        gradients.set(c, map);
      }
      if (map.tones[tone]) return map.tones[tone];
      const t = TONES[tone] || TONES.areia;
      const body = hGradient(c, -R, R, [
        [0, rgba(t.deep, 1)],
        [0.1, rgba(t.dark, 1)],
        [0.27, rgba(t.base, 1)],
        [0.36, rgba(mix(t.base, t.light, 0.35), 1)],
        [0.55, rgba(t.base, 1)],
        [0.8, rgba(t.mid, 1)],
        [0.94, rgba(t.dark, 1)],
        [1, rgba(t.deep, 1)]
      ]);
      const face = hGradient(c, -R, R, [
        [0, rgba(t.mid, 1)],
        [0.25, rgba(t.light, 1)],
        [0.55, rgba(mix(t.base, t.light, 0.5), 1)],
        [1, rgba(t.mid, 1)]
      ]);
      const cone = hGradient(c, -R, R, [
        [0, rgba(t.mid, 1)],
        [0.3, rgba(mix(t.base, t.light, 0.75), 1)],
        [0.5, rgba(mix(t.base, t.light, 0.3), 1)],
        [0.75, rgba(t.base, 1)],
        [1, rgba(t.dark, 1)]
      ]);
      map.tones[tone] = { t, body, face, cone, texture: patternFor(c) };
      return map.tones[tone];
    }

    function solveSand(progress, remainingFraction) {
      if (solved.key !== progress || solved.q !== remainingFraction) {
        solved = {
          key: progress,
          q: remainingFraction,
          top: sand.topState(remainingFraction),
          bottom: sand.bottomState(progress)
        };
      }
      return solved;
    }

    function drawTopSand(c, top, G) {
      if (top.empty) return;
      const S = L.S;
      const t = G.t;
      c.save();
      traceInner(c, 1);
      c.clip();
      // Corpo: tudo abaixo da superfície, até o gargalo.
      c.beginPath();
      c.rect(X(-R - 0.05), Y(top.level), (2 * R + 0.1) * S, top.level * S + 2);
      c.fillStyle = G.body;
      c.fill();
      if (G.texture) {
        c.fillStyle = G.texture;
        c.fill();
      }
      // Oclusão perto do gargalo.
      c.fillStyle = vGradient(c, top.level, 0, [
        [0, 'rgba(0,0,0,0)'],
        [0.06, 'rgba(0,0,0,0.1)'],
        [0.5, 'rgba(0,0,0,0.16)'],
        [1, 'rgba(0,0,0,0.42)']
      ]);
      c.fill();

      // Face superior (vista levemente de cima).
      const rr = top.rimRadius;
      ellipsePath(c, 0, top.level, rr, rr * ELEVATION);
      c.fillStyle = G.face;
      c.fill();
      if (G.texture) {
        c.fillStyle = G.texture;
        c.fill();
      }
      // Cratera: parede distante iluminada, parede próxima em sombra.
      const cr = top.craterRadius;
      if (cr > 0.002) {
        const cy = Y(top.level);
        const ry = cr * ELEVATION * S;
        c.beginPath();
        c.ellipse(X(0), cy, cr * S, ry, 0, 0, Math.PI * 2);
        const depth = clamp((top.level - top.vertex) / sand.craterDepthMax, 0, 1);
        const g = c.createLinearGradient(0, cy - ry, 0, cy + ry);
        g.addColorStop(0, rgba(mix(t.base, t.light, 0.55), 1));
        g.addColorStop(0.35, rgba(mix(t.base, t.mid, 0.3 + 0.4 * depth), 1));
        g.addColorStop(0.8, rgba(mix(t.mid, t.dark, 0.3 + 0.5 * depth), 1));
        g.addColorStop(1, rgba(mix(t.dark, t.deep, 0.4 * depth), 1));
        c.fillStyle = g;
        c.fill();
        const hole = c.createRadialGradient(X(0), cy + ry * 0.4, 0, X(0), cy + ry * 0.4, cr * S * 0.45);
        hole.addColorStop(0, rgba(t.deep, 0.55 * depth));
        hole.addColorStop(1, rgba(t.deep, 0));
        c.fillStyle = hole;
        c.fill();
      }
      // Aresta frontal iluminada
      c.beginPath();
      c.ellipse(X(0), Y(top.level), rr * S, rr * ELEVATION * S, 0, 0.12 * Math.PI, 0.88 * Math.PI);
      c.strokeStyle = rgba(t.light, 0.35);
      c.lineWidth = 0.8;
      c.stroke();
      c.restore();
    }

    function drawBottomSand(c, bottom, G) {
      if (bottom.empty) return;
      const S = L.S;
      const t = G.t;
      const yContact = -1 + bottom.contactZ;
      const yApex = -1 + bottom.apex;
      const rc = bottom.contactRadius;
      c.save();
      traceInner(c, -1);
      c.clip();
      if (bottom.contactZ > 0.0005) {
        c.beginPath();
        c.rect(X(-R - 0.05), Y(yContact), (2 * R + 0.1) * S, bottom.contactZ * S + 2);
        c.fillStyle = G.body;
        c.fill();
        if (G.texture) {
          c.fillStyle = G.texture;
          c.fill();
        }
        c.fillStyle = vGradient(c, yContact, -1, [
          [0, 'rgba(0,0,0,0)'],
          [1, 'rgba(0,0,0,0.3)']
        ]);
        c.fill();
      }
      // Cone (superfície livre)
      const apexRound = Math.min(0.018, (bottom.apex - bottom.contactZ) * 0.3);
      const tan = glass.tanRepose;
      c.beginPath();
      c.moveTo(X(-rc), Y(yContact));
      const ax = apexRound / tan;
      c.lineTo(X(-ax), Y(yApex - apexRound));
      c.quadraticCurveTo(X(0), Y(yApex), X(ax), Y(yApex - apexRound));
      c.lineTo(X(rc), Y(yContact));
      c.ellipse(X(0), Y(yContact), rc * S, rc * ELEVATION * S, 0, 0, Math.PI, false);
      c.closePath();
      c.fillStyle = G.cone;
      c.fill();
      if (G.texture) {
        c.fillStyle = G.texture;
        c.fill();
      }
      c.fillStyle = vGradient(c, yApex, yContact - rc * ELEVATION, [
        [0, 'rgba(255,248,235,0.06)'],
        [0.6, 'rgba(0,0,0,0)'],
        [1, 'rgba(0,0,0,0.14)']
      ]);
      c.fill();
      if (bottom.contactZ > 0.0005) {
        c.beginPath();
        c.ellipse(X(0), Y(yContact), rc * S, rc * ELEVATION * S, 0, 0.1 * Math.PI, 0.9 * Math.PI);
        c.strokeStyle = rgba(t.deep, 0.35);
        c.lineWidth = 1;
        c.stroke();
      }
      c.restore();
    }

    /** Pinta a massa de areia (sem grãos) num contexto já limpo. */
    function paintSand(c, top, bottom, tone) {
      const G = tonePaint(c, tone);
      drawTopSand(c, top, G);
      drawBottomSand(c, bottom, G);
    }

    /* -------------------------------------------------------------- */
    /* Grãos                                                            */
    /* -------------------------------------------------------------- */

    function landingY(bottom, x) {
      return -1 + sand.bottomSurfaceZ(bottom, x);
    }

    function drawStream(c, t, rate, bottom) {
      const neckR = glass.inner(0);
      const density = clamp((rate - STREAM_RATE) / 60, 0, 1);
      const w = Math.max(0.8, neckR * (0.5 + 0.35 * density) * L.S);
      const y0 = Y(0.004);
      const y1 = Y(landingY(bottom, 0)) + 1;
      const g = c.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, rgba(t.light, 0.8));
      g.addColorStop(0.2, rgba(t.grain, 0.5 + 0.3 * density));
      g.addColorStop(1, rgba(t.grain, 0.32 + 0.3 * density));
      c.fillStyle = g;
      c.fillRect(X(0) - w / 2, y0, w, y1 - y0);
    }

    /**
     * Desenha os grãos no ar. A posição do grão k depende apenas de
     * (agora − instante de queda de k): nada é acumulado entre quadros.
     * Quantidade lógica ≠ partículas desenhadas: no máximo MAX_PARTICLES por quadro.
     */
    function drawGrains(c, model, now, bottom, tone, seedBase) {
      const t = TONES[tone] || TONES.areia;
      const S = L.S;
      const fallen = Grains.fallenAt(model, now);
      if (fallen < 1) return;
      const oldest = Grains.fallenAt(model, now - WINDOW_MS) + 1;
      const span = fallen - oldest + 1;
      if (span <= 0) return;
      const neckR = glass.inner(0);
      const stream = now < model.end && model.rate >= STREAM_RATE;
      const step = span > MAX_PARTICLES ? Math.ceil(span / MAX_PARTICLES) : 1;
      const size = Math.max(1, 0.0052 * S);
      const sparse = model.rate < SPARSE_RATE;
      const shades = [rgba(t.grain, 1), rgba(t.light, 1), rgba(mix(t.base, t.light, 0.5), 1)];

      // Índices múltiplos de `step`: o subconjunto desenhado é estável entre quadros.
      for (let k = fallen - (fallen % step); k >= oldest; k -= step) {
        const release = Grains.releaseTime(model, k);
        const age = (now - release) / 1000;
        if (age < 0) continue;
        const h = hash32((k * 2654435761) ^ seedBase);
        const r1 = h / 4294967296;
        const r2 = random01(h + 1);
        const r3 = random01(h + 2);
        const x0 = (r1 - 0.5) * neckR * 0.9;
        const vx = (r2 - 0.5) * (stream ? 0.05 : 0.09);
        const xl = x0 + vx * 0.5; // ponto de pouso aproximado
        const yl = landingY(bottom, xl);
        const d = RELEASE_Y - yl;
        const tLand = (-V0 + Math.sqrt(V0 * V0 + 2 * GRAVITY * d)) / GRAVITY;
        const sz = size * (0.8 + r3 * 0.45);
        c.fillStyle = shades[(h >>> 3) % 3];
        if (age < tLand) {
          const x = x0 + vx * age;
          const y = RELEASE_Y - (V0 * age + 0.5 * GRAVITY * age * age);
          const vy = V0 + GRAVITY * age;
          const trail = Math.min(sz * 0.9, vy * 0.006 * S);
          c.fillRect(X(x) - sz / 2, Y(y) - sz / 2 - trail, sz, sz + trail);
        } else if (age < tLand + SETTLE_S) {
          const f = (age - tLand) / SETTLE_S;
          const x = x0 + vx * tLand;
          c.globalAlpha = (1 - f) * 0.9;
          c.fillRect(X(x) - sz / 2, Y(yl) - sz / 2 + f * sz * 0.6, sz, sz);
          if (sparse) {
            // Respingo mínimo: dois fragmentos que se afastam e assentam.
            for (const side of [-1, 1]) {
              const dx = side * (0.012 + r2 * 0.01) * f;
              const dy = 0.02 * Math.sin(Math.PI * Math.min(1, f * 1.4)) * (0.6 + r1 * 0.4);
              c.globalAlpha = (1 - f) * 0.55;
              c.fillRect(X(x + dx) - sz * 0.3, Y(landingY(bottom, x + dx) + dy) - sz * 0.3, sz * 0.6, sz * 0.6);
            }
          }
          c.globalAlpha = 1;
        }
      }
    }

    /* -------------------------------------------------------------- */
    /* Quadro                                                           */
    /* -------------------------------------------------------------- */

    function sandKey(top, bottom, tone) {
      const q = L.S * 2.5; // resolução de 0,4 px (imperceptível; poupa repinturas)
      return (
        tone + '|' +
        (top.empty ? 'e' : Math.round(top.level * q) + ',' + Math.round(top.craterRadius * q) + ',' + Math.round((top.level - top.vertex) * q)) + '|' +
        (bottom.empty ? 'e' : Math.round(bottom.apex * q) + ',' + Math.round(bottom.contactZ * q))
      );
    }

    /**
     * Desenha o estado da ampulheta no instante `now`.
     * options: { model, reducedMotion, progress (substitui o progresso real — usado
     * apenas em animações), stream (força o filete) }.
     * Retorna { animating, nextWakeAt, landed, stream, status, state }.
     */
    function draw(hourglass, now, options) {
      const opts = options || {};
      if (!L || !hourglass) return { animating: false, nextWakeAt: Infinity };
      if (!staticReady) paintStatic();

      const state = A.time.computeState(hourglass, now);
      const model = opts.model || Grains.createModel(hourglass);
      const tone = hourglass.tone || 'areia';
      const reduced = !!opts.reducedMotion;
      const override = typeof opts.progress === 'number';
      const p = override ? clamp(opts.progress, 0, 1) : state.progress;
      const q = override ? 1 - p : state.remainingFraction;
      const { top, bottom } = solveSand(p, q);

      const key = sandKey(top, bottom, tone);
      if (key !== sandCacheKey) {
        cctx.setTransform(1, 0, 0, 1, 0, 0);
        cctx.clearRect(0, 0, sandCache.width, sandCache.height);
        cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintSand(cctx, top, bottom, tone);
        sandCacheKey = key;
      }

      const running = state.status === 'running';
      const streamOn = override ? !!opts.stream : running && model.rate >= STREAM_RATE;
      const inFlight =
        !override && !reduced && now >= model.start && Grains.fallenAt(model, now) > Grains.fallenAt(model, now - WINDOW_MS);
      const dynamic = streamOn || inFlight;

      // Nada mudou desde o último quadro: não toca no canvas.
      if (key !== lastBlitKey || dynamic || lastDynamic) {
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, sandCv.width, sandCv.height);
        sctx.drawImage(sandCache, 0, 0);
        sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const t = TONES[tone] || TONES.areia;
        if (streamOn) drawStream(sctx, t, override ? 60 : model.rate, bottom);
        if (inFlight) drawGrains(sctx, model, now, bottom, tone, A.utils.hashString(hourglass.id || 'x'));
        lastBlitKey = key;
        lastDynamic = dynamic;
      }

      // Próximo momento em que algo visível muda.
      let nextWakeAt = Infinity;
      if (state.status === 'pending') nextWakeAt = state.start;
      else if (running) {
        const fallen = Grains.fallenAt(model, now);
        nextWakeAt = Math.min(Grains.releaseTime(model, fallen + 1), state.end);
        // Atualização da massa: quando a superfície se moveria ~0,35 px.
        const massInterval = clamp((state.duration * 0.35) / (L.S * 1.2), 250, 30000);
        nextWakeAt = Math.min(nextWakeAt, now + massInterval);
        if (reduced) nextWakeAt = Math.max(nextWakeAt, now + 1000);
      }

      const animating = !reduced && (inFlight || (streamOn && running));
      const landed = Grains.fallenAt(model, now - 480);
      return { animating, nextWakeAt, landed, stream: streamOn && running, status: state.status, state };
    }

    /** Força o redesenho completo no próximo quadro (ex.: troca de ampulheta). */
    function invalidate() {
      sandCacheKey = null;
      lastBlitKey = null;
    }

    /* -------------------------------------------------------------- */
    /* Virada (reinício)                                                */
    /* -------------------------------------------------------------- */

    const bulbPolys = { 1: sand.bulbPolygon(1), '-1': sand.bulbPolygon(-1) };

    /**
     * Areia como fluido: superfície perpendicular à gravidade dentro do bulbo
     * `dir`, com o objeto girado de `angle` (radianos, sentido horário na tela).
     */
    function paintFluid(c, dir, angle, area, tone) {
      const G = tonePaint(c, tone);
      const poly = bulbPolys[dir];
      const f = sand.fluidSurface(poly, angle, area);
      if (f.points.length < 3) return;
      const S = L.S;
      c.save();
      c.beginPath();
      f.points.forEach((pt, i) => (i ? c.lineTo(X(pt[0]), Y(pt[1])) : c.moveTo(X(pt[0]), Y(pt[1]))));
      c.closePath();
      c.fillStyle = G.body;
      c.fill();
      // Em pleno giro a textura não se percebe: poupa o preenchimento mais caro.
      const detail = Math.abs(Math.sin(angle)) < 0.3;
      if (G.texture && detail) {
        c.fillStyle = G.texture;
        c.fill();
      }
      // Face da superfície: elipse alinhada ao horizonte do mundo.
      if (f.chord.length >= 2) {
        const a = f.chord[0];
        const b = f.chord[f.chord.length - 1];
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
        if (half > 0.004) {
          c.save();
          traceInner(c, dir);
          c.clip();
          c.translate(X(mx), Y(my));
          c.rotate(-angle);
          c.beginPath();
          c.ellipse(0, 0, half * S, half * ELEVATION * S, 0, 0, Math.PI * 2);
          c.fillStyle = G.face;
          c.fill();
          if (G.texture && detail) {
            c.fillStyle = G.texture;
            c.fill();
          }
          c.beginPath();
          c.ellipse(0, 0, half * S, half * ELEVATION * S, 0, 0.12 * Math.PI, 0.88 * Math.PI);
          c.strokeStyle = rgba(G.t.light, 0.35);
          c.lineWidth = 0.8;
          c.stroke();
          c.restore();
        }
      }
      c.restore();
    }

    /**
     * Cria um "dublê" do objeto para a virada: cópias das camadas estáticas e
     * um canvas próprio de areia. Fica abaixo do objeto real.
     */
    function createFlipDouble() {
      if (!L) return null;
      if (!staticReady) paintStatic();
      const el = document.createElement('div');
      el.className = 'hg-object hg-object--double';
      el.style.cssText = objectEl.style.cssText;
      const layers = [backCv, sandCv, frontCv].map((src) => {
        const c = createLayer(src.className);
        c.width = src.width;
        c.height = src.height;
        return c;
      });
      const bctx = layers[0].getContext('2d');
      bctx.drawImage(backCv, 0, 0);
      layers[2].getContext('2d').drawImage(frontCv, 0, 0);
      layers[1].getContext('2d').drawImage(sandCv, 0, 0);
      el.append(...layers);
      host.insertBefore(el, objectEl);
      const dctx = layers[1].getContext('2d');
      return {
        el,
        /** Desenha a areia do dublê: pilha rígida (mix 0) → fluido (mix 1). */
        paint(angle, mix, finishedBottom, tone) {
          dctx.setTransform(1, 0, 0, 1, 0, 0);
          dctx.clearRect(0, 0, layers[1].width, layers[1].height);
          dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (mix > 0) {
            dctx.globalAlpha = mix;
            paintFluid(dctx, -1, angle, sand.V0, tone);
          }
          if (mix < 1) {
            dctx.globalAlpha = 1 - mix;
            paintSand(dctx, { empty: true }, finishedBottom, tone);
          }
          dctx.globalAlpha = 1;
        },
        destroy() {
          el.remove();
        }
      };
    }

    /** Areia do objeto real durante o fim da virada (bulbo superior, fluido). */
    function paintFluidMain(angle, tone) {
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, sandCv.width, sandCv.height);
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintFluid(sctx, 1, angle, sand.V0, tone);
      invalidate();
    }

    function finishedBottom() {
      return sand.bottomState(1);
    }

    return {
      resize,
      draw,
      layout,
      invalidate,
      createFlipDouble,
      paintFluidMain,
      finishedBottom,
      objectEl,
      shadowEl,
      ELEVATION
    };
  }

  A.renderer = { createRenderer, TONES: TONE_HEX };
})(typeof globalThis !== 'undefined' ? globalThis : window);
