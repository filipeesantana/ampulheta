/*
 * Ampulheta — grain-engine.js
 *
 * GRAIN ENGINE
 * ============
 * Um grão não é uma partícula decorativa: é uma unidade abstrata de tempo.
 *
 * Cada ampulheta é dividida em N grãos lógicos de mesma duração:
 *
 *     tempoPorGrao = duracaoTotal / N
 *
 * O grão k (1 … N) cai exatamente no instante  início + k · tempoPorGrao.
 * Entre dois grãos, nada cai. Numa ampulheta de 94 anos isso significa
 * horas de imobilidade — e isso é intencional:
 *
 *     "O tempo não precisa parecer que está passando para estar passando."
 *
 * Escolha de N (resolução adaptativa)
 * ----------------------------------
 * N cresce com a duração, mas de forma logarítmica: dobrar a duração não
 * dobra a quantidade de grãos, porque o que importa para a percepção é a
 * *escala* do intervalo, não o seu valor absoluto.
 *
 *     u = log10(duração em s) / log10(90 anos em s)       (0 → 1 s, 1 → 90 anos)
 *     N = N_MIN + (N_MAX − N_MIN) · u^γ                   (3 algarismos significativos)
 *
 * Com N_MIN = 200, N_MAX = 50 000 e γ = 2,75 obtemos:
 *
 *     duração      grãos     cada grão         comportamento
 *     10 s           303     ≈ 33 ms           fluxo contínuo
 *     10 min       1 920     ≈ 0,3 s           chuva perceptível
 *     1 h          3 590     ≈ 1 s             um grão por segundo
 *     1 dia        8 540     ≈ 10 s            quedas espaçadas
 *     1 mês       17 400     ≈ 2,5 min         raras
 *     1 ano       26 500     ≈ 20 min          silêncio
 *     10 anos     37 400     ≈ 2,4 h           longo silêncio
 *     94 anos     50 000     ≈ 16h 29min       quase imóvel
 *
 * Duas âncoras com significado humano calibram a curva: 1 hora corresponde
 * a ~1 grão por segundo; 90 anos — uma vida longa — atinge o teto de
 * 50 000 grãos. Acima disso N permanece fixo e cada grão apenas passa a
 * valer mais tempo. Abaixo de 1 s não há ampulhetas (duração mínima).
 *
 * Massa × grãos
 * -------------
 * A massa de areia (quanto está em cima e embaixo) é contínua e deriva do
 * progresso exato. Os grãos são eventos discretos que atravessam o gargalo.
 * As partículas visíveis são funções puras do tempo: a posição do grão k no
 * instante t depende apenas de (t − instanteDeQueda(k)). Não há estado a
 * perder quando a aba dorme; ao voltar, nada é "reproduzido" — só os grãos
 * que estariam no ar naquele instante aparecem.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { clamp, roundSignificant } = A.utils;
  const T = A.time;

  const GRAIN_MIN = 200;
  const GRAIN_MAX = 50000;
  const GAMMA = 2.75;
  const REF_MAX_SECONDS = (90 * T.AVG_YEAR) / 1000;
  const LOG_REF_MAX = Math.log10(REF_MAX_SECONDS);

  /** Quantidade lógica de grãos para uma duração (ms). */
  function grainCount(durationMs) {
    const seconds = Math.max(1, durationMs / 1000);
    const u = clamp(Math.log10(seconds) / LOG_REF_MAX, 0, 1);
    const raw = GRAIN_MIN + (GRAIN_MAX - GRAIN_MIN) * Math.pow(u, GAMMA);
    return clamp(Math.round(roundSignificant(raw, 3)), GRAIN_MIN, GRAIN_MAX);
  }

  /**
   * Modelo de grãos de uma ampulheta.
   * rate: grãos por segundo (densidade temporal da queda).
   */
  function createModel(hourglass) {
    const duration = Math.max(1, hourglass.end - hourglass.start);
    const count = grainCount(duration);
    return {
      start: hourglass.start,
      end: hourglass.end,
      duration,
      count,
      grainMs: duration / count,
      rate: count / (duration / 1000)
    };
  }

  /** Instante (epoch ms) em que o grão k cai. k ∈ [1, count]. */
  function releaseTime(model, k) {
    return model.start + (k * model.duration) / model.count;
  }

  /** Quantos grãos já caíram no instante t. */
  function fallenAt(model, t) {
    if (t <= model.start) return 0;
    if (t >= model.end) return model.count;
    const elapsed = t - model.start;
    return Math.min(model.count, Math.floor((elapsed * model.count) / model.duration));
  }

  /** Resumo usado pelo painel de informações. */
  function describe(model, t) {
    const fallen = fallenAt(model, t);
    const remaining = model.count - fallen;
    let nextIn = null;
    if (t < model.start) nextIn = releaseTime(model, 1) - t;
    else if (fallen < model.count) nextIn = Math.max(0, releaseTime(model, fallen + 1) - t);
    return {
      count: model.count,
      fallen,
      remaining,
      grainMs: model.grainMs,
      nextIn
    };
  }

  A.grains = {
    GRAIN_MIN,
    GRAIN_MAX,
    GAMMA,
    grainCount,
    createModel,
    releaseTime,
    fallenAt,
    describe
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
