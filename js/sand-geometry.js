/*
 * Ampulheta — sand-geometry.js
 * Geometria do vidro e da areia, independente de pixels.
 *
 * Sistema de coordenadas (unidades relativas):
 *   - o gargalo está em y = 0;
 *   - cada bulbo tem altura 1 (o superior vai de 0 a 1, o inferior de 0 a −1);
 *   - r(s) é o raio do vidro à distância s ∈ [0, 1] do gargalo (os bulbos são simétricos).
 *
 * "Massa visual": a quantidade de areia é medida pela área que ela ocupa na
 * silhueta vista de frente — exatamente o que o olho compara. Se 37,5% do
 * tempo passou, 37,5% da areia visível está embaixo.
 *   - Bulbo superior: a superfície desce pelo perfil do vidro; uma cratera
 *     cônica (ângulo de repouso) se forma no centro — ela é desenhada na face
 *     superior, vista levemente de cima, e não altera a massa.
 *   - Bulbo inferior: um cone (pilha) com o mesmo ângulo de repouso cresce a
 *     partir do centro, preenchendo a base e depois subindo.
 * Dado o progresso p, obtemos a altura da superfície que contém exatamente
 * (1 − p)·M₀ em cima e p·M₀ embaixo. As funções área→altura são tabeladas uma
 * única vez; a cada quadro basta uma busca binária (custo desprezível).
 *
 * Virada da ampulheta: durante a rotação a areia se comporta como um fluido
 * granular — a superfície fica perpendicular à gravidade e a área contida no
 * bulbo é conservada (recorte de polígono + bisseção).
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { clamp } = A.utils;

  /* Proporções do vidro (relativas à altura de um bulbo). */
  const GLASS = {
    neckRadius: 0.03, // raio externo no gargalo
    maxRadius: 0.405, // raio máximo do bulbo
    widest: 0.57, // distância do gargalo em que o bulbo é mais largo
    capRadius: 0.215, // raio do vidro onde encontra a base
    thickness: 0.014, // espessura aparente da parede
    reposeAngle: (31 * Math.PI) / 180, // ângulo de repouso da areia
    initialFill: 0.69, // altura inicial da areia no bulbo superior
    craterDepthFactor: 0.78 // profundidade máxima da cratera, relativa a R·tanθ
  };

  /* ------------------------------------------------------------------ */
  /* Perfil do vidro                                                      */
  /* ------------------------------------------------------------------ */

  function cubic(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  }

  /**
   * Constrói uma tabela r(s) a partir de duas curvas de Bézier:
   *   1) do gargalo até a parte mais larga (funil com leve curvatura);
   *   2) da parte mais larga até o ombro que encontra a base.
   */
  function buildProfile(g) {
    const rn = g.neckRadius;
    const R = g.maxRadius;
    const sc = g.widest;
    const rc = g.capRadius;
    const segments = [
      // [r0, s0], [r1, s1], [r2, s2], [r3, s3]
      [[rn, 0], [rn + 0.012, 0.075], [R * 0.98, sc - 0.3], [R, sc]],
      [[R, sc], [R * 1.01, sc + 0.22], [rc + 0.075, 1.0], [rc, 1.0]]
    ];
    const pts = [];
    for (const seg of segments) {
      for (let i = 0; i <= 240; i++) {
        const t = i / 240;
        pts.push([
          cubic(seg[0][0], seg[1][0], seg[2][0], seg[3][0], t),
          cubic(seg[0][1], seg[1][1], seg[2][1], seg[3][1], t)
        ]);
      }
    }
    // Reamostra em s uniforme.
    const N = 1024;
    const table = new Float64Array(N + 1);
    let j = 0;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      while (j < pts.length - 2 && pts[j + 1][1] < s) j++;
      const a = pts[j];
      const b = pts[j + 1];
      const span = b[1] - a[1];
      const t = span > 1e-9 ? clamp((s - a[1]) / span, 0, 1) : 1;
      table[i] = a[0] + (b[0] - a[0]) * t;
    }
    table[N] = rc;
    return table;
  }

  function createGlass(overrides) {
    const g = Object.assign({}, GLASS, overrides || {});
    const table = buildProfile(g);
    const N = table.length - 1;

    /** Raio externo em |y| = s. */
    function outer(s) {
      const x = clamp(Math.abs(s), 0, 1) * N;
      const i = Math.floor(x);
      if (i >= N) return table[N];
      const f = x - i;
      return table[i] + (table[i + 1] - table[i]) * f;
    }

    /** Raio interno (onde a areia pode estar). */
    function inner(s) {
      return Math.max(g.neckRadius * 0.42, outer(s) - g.thickness);
    }

    return Object.assign(g, { outer, inner, tanRepose: Math.tan(g.reposeAngle) });
  }

  /* ------------------------------------------------------------------ */
  /* Modelo da areia                                                      */
  /* ------------------------------------------------------------------ */

  const SLICES = 480;

  function createSandModel(glass) {
    const tan = glass.tanRepose;
    const ds = 1 / SLICES;
    // Raio interno amostrado no centro de cada fatia.
    const r1 = new Float64Array(SLICES);
    for (let i = 0; i < SLICES; i++) r1[i] = glass.inner((i + 0.5) * ds);
    const craterDepthMax = glass.craterDepthFactor * glass.maxRadius * tan;

    /** Área visível da areia no bulbo superior com a superfície na altura L. */
    function topVolume(L) {
      if (L <= 0) return 0;
      let v = 0;
      const full = Math.min(SLICES, Math.floor(L / ds));
      for (let i = 0; i <= full && i < SLICES; i++) {
        const w = i < full ? ds : L - full * ds;
        if (w <= 0) break;
        v += 2 * r1[i] * w;
      }
      return v;
    }

    /**
     * Área visível da pilha no bulbo inferior, com o ápice na altura h
     * (medida a partir da base, 0 = fundo, 1 = gargalo).
     */
    function bottomVolume(h) {
      if (h <= 0) return 0;
      let v = 0;
      const top = Math.min(h, 1);
      const full = Math.min(SLICES, Math.floor(top / ds));
      for (let i = 0; i <= full && i < SLICES; i++) {
        const z = (i + 0.5) * ds;
        const w = i < full ? ds : top - full * ds;
        if (w <= 0) break;
        // fatia i a partir do fundo ↔ distância do gargalo s = 1 − z
        const wall = r1[SLICES - 1 - i];
        const rho = (h - z) / tan;
        v += 2 * (rho > 0 ? Math.min(wall, rho) : 0) * w;
      }
      return v;
    }

    const L0 = glass.initialFill;

    // Tabela acumulada do bulbo superior: área até o topo de cada fatia.
    const topCum = new Float64Array(SLICES + 1);
    for (let i = 0; i < SLICES; i++) topCum[i + 1] = topCum[i] + 2 * r1[i] * ds;
    const V0 = topVolume(L0);

    /** Inversa exata de topVolume (área → altura). */
    function topLevelFor(area) {
      if (area <= 0) return 0;
      let lo = 0;
      let hi = SLICES;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (topCum[mid] <= area) lo = mid;
        else hi = mid;
      }
      const w = 2 * r1[Math.min(lo, SLICES - 1)];
      return Math.min(1, lo * ds + (area - topCum[lo]) / w);
    }

    // Tabela do bulbo inferior: área em função da altura do ápice.
    const BOTTOM_MAX = 1.6;
    const BOTTOM_STEPS = 1000;
    const bottomTab = new Float64Array(BOTTOM_STEPS + 1);
    for (let i = 0; i <= BOTTOM_STEPS; i++) bottomTab[i] = bottomVolume((i / BOTTOM_STEPS) * BOTTOM_MAX);

    function bottomApexFor(area) {
      if (area <= 0) return 0;
      let lo = 0;
      let hi = BOTTOM_STEPS;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (bottomTab[mid] <= area) lo = mid;
        else hi = mid;
      }
      const a = bottomTab[lo];
      const b = bottomTab[hi];
      const f = b > a ? (area - a) / (b - a) : 0;
      return ((lo + clamp(f, 0, 1)) / BOTTOM_STEPS) * BOTTOM_MAX;
    }

    /** A cratera se aprofunda durante os primeiros 6% do escoamento. */
    function craterWeight(p) {
      const t = clamp(p / 0.06, 0, 1);
      return 1 - (1 - t) * (1 - t);
    }

    /** Estado do bulbo superior para uma fração restante q = 1 − p. */
    function topState(remainingFraction) {
      const q = clamp(remainingFraction, 0, 1);
      const target = V0 * q;
      if (target <= V0 * 1e-9) return { empty: true, level: 0, vertex: 0, rimRadius: 0, craterRadius: 0 };
      const level = topLevelFor(target);
      const w = craterWeight(1 - q);
      const vertex = Math.max(0, level - w * craterDepthMax);
      const rimRadius = glass.inner(level);
      const craterRadius = Math.min(rimRadius, (level - vertex) / tan);
      return { empty: false, level, vertex, rimRadius, craterRadius };
    }

    /** Estado do bulbo inferior para uma fração acumulada p. */
    function bottomState(progress) {
      const target = V0 * clamp(progress, 0, 1);
      if (target <= V0 * 1e-9) return { empty: true, apex: 0, contactZ: 0, contactRadius: 0 };
      const apex = bottomApexFor(target);
      // Onde a superfície do cone encontra o vidro (ou o fundo).
      const floorR = glass.inner(1);
      let contactZ = 0;
      let contactRadius = apex / tan;
      if (contactRadius > floorR) {
        let a = 0;
        let b = Math.min(apex, 1);
        const f = (z) => (apex - z) / tan - glass.inner(1 - z);
        const steps = 48;
        let prev = 0;
        for (let i = 1; i <= steps; i++) {
          const z = (b * i) / steps;
          if (f(z) <= 0) {
            a = prev;
            b = z;
            break;
          }
          prev = z;
        }
        for (let it = 0; it < 24; it++) {
          const m = (a + b) / 2;
          if (f(m) > 0) a = m;
          else b = m;
        }
        contactZ = (a + b) / 2;
        contactRadius = glass.inner(1 - contactZ);
      }
      return { empty: false, apex, contactZ, contactRadius };
    }

    /** Altura (a partir do fundo) da superfície da pilha na posição x. */
    function bottomSurfaceZ(bottom, x) {
      if (bottom.empty) return 0;
      return Math.max(0, bottom.apex - Math.abs(x) * tan);
    }

    /* -------------------------------------------------------------- */
    /* Areia como fluido granular (durante a virada)                    */
    /* -------------------------------------------------------------- */

    /** Polígono do interior de um bulbo (dir = +1 superior, −1 inferior), fechado no gargalo. */
    function bulbPolygon(dir) {
      const steps = 120;
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        pts.push([glass.inner(t), dir * t]);
      }
      for (let i = steps; i >= 0; i--) {
        const t = i / steps;
        pts.push([-glass.inner(t), dir * t]);
      }
      return pts;
    }

    /**
     * Recorta o polígono ao semiplano "abaixo" da superfície: pontos cuja altura
     * (ao longo da antigravidade u) é ≤ h. Retorna { area, points, chord }.
     */
    function clipBelow(poly, ux, uy, h) {
      const out = [];
      const chord = [];
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        const ha = a[0] * ux + a[1] * uy - h;
        const hb = b[0] * ux + b[1] * uy - h;
        if (ha <= 0) out.push(a);
        if ((ha <= 0) !== (hb <= 0)) {
          const t = ha / (ha - hb);
          const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          out.push(p);
          chord.push(p);
        }
      }
      let area = 0;
      for (let i = 0, m = out.length; i < m; i++) {
        const a = out[i];
        const b = out[(i + 1) % m];
        area += a[0] * b[1] - b[0] * a[1];
      }
      return { area: Math.abs(area) / 2, points: out, chord };
    }

    /**
     * Superfície da areia contida num polígono quando a gravidade forma o
     * ângulo `angle` com o eixo do objeto (rotação horária do objeto na tela).
     * Retorna { h, ux, uy, points, chord } com a área `area` conservada.
     */
    function fluidSurface(poly, angle, area) {
      // Direção "para cima" (contra a gravidade) no referencial do objeto.
      const ux = -Math.sin(angle);
      const uy = Math.cos(angle);
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of poly) {
        const v = p[0] * ux + p[1] * uy;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      let res = null;
      for (let it = 0; it < 26; it++) {
        const mid = (lo + hi) / 2;
        res = clipBelow(poly, ux, uy, mid);
        if (res.area < area) lo = mid;
        else hi = mid;
      }
      const h = (lo + hi) / 2;
      res = clipBelow(poly, ux, uy, h);
      return { h, ux, uy, points: res.points, chord: res.chord, area: res.area };
    }

    return {
      V0,
      L0,
      craterDepthMax,
      topVolume,
      bottomVolume,
      topLevelFor,
      bottomApexFor,
      topState,
      bottomState,
      bottomSurfaceZ,
      bulbPolygon,
      clipBelow,
      fluidSurface
    };
  }

  A.geometry = { GLASS, createGlass, createSandModel };
})(typeof globalThis !== 'undefined' ? globalThis : window);
