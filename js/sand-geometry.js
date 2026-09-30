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
 * Dado o progresso p, resolvemos numericamente (bisseção) a altura da
 * superfície que contém exatamente (1 − p)·M₀ em cima e p·M₀ embaixo.
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
    const V0 = topVolume(L0);

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
      let lo = 0;
      let hi = 1;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        if (topVolume(mid) < target) lo = mid;
        else hi = mid;
      }
      const level = (lo + hi) / 2;
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
      let lo = 0;
      let hi = 1.6;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        if (bottomVolume(mid) < target) lo = mid;
        else hi = mid;
      }
      const apex = (lo + hi) / 2;
      // Onde a superfície do cone encontra o vidro (ou o fundo).
      const floorR = glass.inner(1);
      let contactZ = 0;
      let contactRadius = apex / tan;
      if (contactRadius > floorR) {
        // Procura a primeira altura em que o cone fica dentro do vidro.
        let a = 0;
        let b = Math.min(apex, 1);
        const f = (z) => (apex - z) / tan - glass.inner(1 - z);
        // varredura grosseira para achar a mudança de sinal
        const steps = 64;
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
        for (let it = 0; it < 30; it++) {
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

    return {
      V0,
      craterDepthMax,
      topVolume,
      bottomVolume,
      topState,
      bottomState,
      bottomSurfaceZ
    };
  }

  A.geometry = { GLASS, createGlass, createSandModel };
})(typeof globalThis !== 'undefined' ? globalThis : window);
