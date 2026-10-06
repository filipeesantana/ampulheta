/*
 * Ampulheta — flip.js
 * A virada: transição visual do reinício de uma ampulheta.
 *
 * O reinício é atômico e a animação nunca é a fonte do tempo:
 *   1. calcula-se o novo início (o instante em que a ampulheta pousa de pé);
 *   2. o novo intervalo é gravado (mesma duração, novo início);
 *   3. só então a transição é exibida, a partir do retrato anterior;
 *   4. ao final — ou se ela for interrompida — a cena volta a desenhar o
 *      registro já gravado, calculado pelo relógio.
 * Se a gravação falhar, nada muda na tela e o erro é devolvido a quem chamou.
 *
 * Transição completa:
 *   a. (se ainda havia areia em cima) a areia restante escoa depressa;
 *   b. a ampulheta é erguida e gira 180° com peso e inércia — a areia
 *      acompanha a gravidade dentro do bulbo, como um fluido granular;
 *   c. perto do fim, a ampulheta "real" (já na orientação normal) assume.
 * Com movimento reduzido: a ampulheta esmaece e reaparece cheia, sem rotação.
 *
 * A virada sobrevive a mudanças de tamanho (tela cheia, contemplação, rotação
 * do aparelho): o enquadramento é refeito e o giro continua do mesmo ponto.
 * Nenhum timer, laço ou transformação sobrevive a ela.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { clamp } = A.utils;

  const DRAIN_MS = 620;
  const FLIP_MS = 1450;
  const HANDOFF = 0.78; // fração da rotação a partir da qual o objeto real assume
  const REDUCED_OUT_MS = 170;
  const REDUCED_IN_MS = 240;
  const COMMIT_MARGIN_MS = 30; // folga para a gravação antes de a animação começar

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  }

  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /** Duração total da transição (ms) para um progresso inicial. */
  function transitionMs(progress, reducedMotion) {
    if (reducedMotion) return REDUCED_OUT_MS;
    return (progress < 0.999 ? DRAIN_MS : 0) + FLIP_MS;
  }

  function createFlip(scene) {
    let active = null;

    function isRunning() {
      return !!active;
    }

    /**
     * Grava o reinício e exibe a virada.
     * options: {
     *   reducedMotion,
     *   commit: async (novoInicio) => registro gravado,
     *   latest: () => registro atual no armazenamento (ou null se foi excluído)
     * }
     * Retorna uma Promise com o registro gravado (ou rejeita com o erro da gravação).
     */
    function run(hourglass, options) {
      if (active) return active.promise;
      const opts = options || {};
      const reduced = !!opts.reducedMotion;
      const renderer = scene.renderer();
      const obj = renderer.objectEl;
      const shadow = renderer.shadowEl;
      const tone = hourglass.tone || 'areia';
      const model = A.grains.createModel(hourglass);
      const clickAt = A.time.now();
      const p0 = A.time.computeState(hourglass, clickAt).progress;
      const needDrain = p0 < 0.999 && !reduced;
      const startAt = Math.round(clickAt + transitionMs(p0, reduced) + COMMIT_MARGIN_MS);

      let rafId = 0;
      let double = null;
      let geometry = measure();
      let phase = 'commit'; // 'commit' → 'drain' → 'flip' | 'out' → 'in'
      let phaseStart = 0;
      let record = null;
      let skipRequested = false;
      let done = false;
      let resolveFn;
      let rejectFn;
      const promise = new Promise((res, rej) => {
        resolveFn = res;
        rejectFn = rej;
      });

      /** Medidas que dependem do enquadramento atual. */
      function measure() {
        const layout = renderer.layout();
        const stage = obj.parentNode;
        const stageW = (stage && stage.clientWidth) || document.documentElement.clientWidth;
        const room = Math.max(1, stageW - 24);
        return {
          liftPx: layout ? 0.045 * layout.S : 0,
          room,
          tall: layout ? layout.box.h * 0.94 : 0,
          wide: layout ? Math.min(layout.box.w, room) : 0
        };
      }

      /**
       * Inclinada, a ampulheta ocupa mais largura (deitada, a sua altura inteira).
       * Onde não couber — celulares em pé — ela se afasta só o necessário em cada
       * ângulo, como a câmera recuando, e nunca é cortada pelas bordas.
       */
      function fitScale(angle) {
        const span = geometry.tall * Math.abs(Math.sin(angle)) + geometry.wide * Math.abs(Math.cos(angle));
        return span > geometry.room ? geometry.room / span : 1;
      }

      function clearVisuals() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        if (double) double.destroy();
        double = null;
        obj.style.transform = '';
        obj.style.opacity = '';
        shadow.style.transform = '';
        shadow.style.opacity = '';
      }

      function release() {
        document.body.classList.remove('is-flipping');
        active = null;
      }

      /** Encerra a transição e devolve a cena ao registro gravado. */
      function finish() {
        if (done) return;
        done = true;
        // O objeto real mostra a areia toda em cima até o próximo quadro da cena.
        if (!reduced && renderer.layout()) renderer.paintFluidMain(0, tone);
        clearVisuals();
        release();
        const subject = scene.getSubject();
        if (subject && subject.id === hourglass.id) {
          const latest = typeof opts.latest === 'function' ? opts.latest() : null;
          scene.setSubject(latest || record);
        }
        scene.setPaused(false);
        resolveFn(record);
      }

      /** A gravação falhou: nada mudou na tela nem nos dados. */
      function abort(error) {
        if (done) return;
        done = true;
        clearVisuals();
        release();
        scene.setPaused(false);
        rejectFn(error);
      }

      function ensureDouble() {
        if (double) return;
        renderer.draw(hourglass, A.time.now(), { model, progress: 1 });
        double = renderer.createFlipDouble();
        if (double) double.el.style.opacity = '';
        obj.style.opacity = '0';
      }

      function frameDrain(elapsed, nowPerf) {
        const u = clamp(elapsed / DRAIN_MS, 0, 1);
        const p = p0 + (1 - p0) * easeInOutSine(u);
        renderer.draw(hourglass, A.time.now(), { model, progress: p, stream: u < 0.985 });
        if (u >= 1) {
          phase = 'flip';
          phaseStart = nowPerf;
        }
        return false;
      }

      function frameFlip(elapsed) {
        ensureDouble();
        const u = clamp(elapsed / FLIP_MS, 0, 1);
        const e = easeInOutCubic(u);
        const angle = Math.PI * e;
        const lift = -Math.sin(Math.PI * u) * geometry.liftPx;
        const scale = fitScale(angle);
        const move = 'translate3d(0,' + lift.toFixed(2) + 'px,0) scale(' + scale.toFixed(4) + ') ';
        if (double) {
          double.el.style.transform = move + 'rotate(' + angle.toFixed(5) + 'rad)';
          // Pilha rígida no começo; depois a areia escorre como fluido.
          double.paint(angle, smoothstep(0.05, 0.14, e), renderer.finishedBottom(), tone);
        }
        const air = Math.sin(Math.PI * u);
        shadow.style.opacity = (1 - 0.5 * air).toFixed(3);
        shadow.style.transform = 'scale(' + (1 - 0.08 * air).toFixed(3) + ')';

        // Passagem para o objeto real, já em orientação normal (rotação − 180°).
        if (u >= HANDOFF) {
          const k = smoothstep(HANDOFF, 1, u);
          obj.style.opacity = k.toFixed(3);
          obj.style.transform = move + 'rotate(' + (angle - Math.PI).toFixed(5) + 'rad)';
          renderer.paintFluidMain(angle - Math.PI, tone);
        }
        return u >= 1;
      }

      /** Movimento reduzido: esmaece, troca o conteúdo e reaparece. */
      function frameReduced(elapsed, nowPerf) {
        if (phase === 'out') {
          const u = clamp(elapsed / REDUCED_OUT_MS, 0, 1);
          obj.style.opacity = (1 - u).toFixed(3);
          if (u >= 1) {
            renderer.invalidate();
            renderer.draw(record, A.time.now(), { reducedMotion: true });
            phase = 'in';
            phaseStart = nowPerf;
          }
          return false;
        }
        const u = clamp(elapsed / REDUCED_IN_MS, 0, 1);
        obj.style.opacity = u.toFixed(3);
        return u >= 1;
      }

      function frame(nowPerf) {
        rafId = 0;
        if (done) return;
        if (skipRequested || document.hidden) {
          finish();
          return;
        }
        const elapsed = nowPerf - phaseStart;
        let ended;
        if (phase === 'drain') ended = frameDrain(elapsed, nowPerf);
        else if (phase === 'flip') ended = frameFlip(elapsed);
        else ended = frameReduced(elapsed, nowPerf);
        if (ended) finish();
        else rafId = requestAnimationFrame(frame);
      }

      function begin() {
        if (skipRequested || document.hidden) {
          finish();
          return;
        }
        phase = reduced ? 'out' : needDrain ? 'drain' : 'flip';
        phaseStart = performance.now();
        rafId = requestAnimationFrame(frame);
      }

      scene.setPaused(true);
      document.body.classList.add('is-flipping');

      active = {
        promise,
        /** Conclui já: o registro gravado passa a valer na tela imediatamente. */
        skip() {
          skipRequested = true;
          if (phase !== 'commit') finish();
        },
        /** O enquadramento mudou (tela cheia, contemplação, rotação): continua do mesmo ponto. */
        relayout() {
          if (done || phase === 'commit') return;
          geometry = measure();
          if (double) {
            double.destroy();
            double = null;
          }
          if (reduced) {
            renderer.invalidate();
            renderer.draw(phase === 'in' ? record : hourglass, A.time.now(), { reducedMotion: true });
          }
          if (!rafId) rafId = requestAnimationFrame(frame);
        }
      };

      // 1) grava; 2) só então anima.
      Promise.resolve()
        .then(() => opts.commit(startAt))
        .then(
          (saved) => {
            record = saved;
            if (!record) abort(new Error('Reinício não gravado'));
            else begin();
          },
          (error) => abort(error)
        );

      return promise;
    }

    /** Conclui a transição imediatamente e espera o reinício estar gravado. */
    function settle() {
      if (!active) return Promise.resolve(null);
      const pending = active.promise.catch(() => null);
      active.skip();
      return pending;
    }

    /** Refaz o enquadramento da transição em andamento. */
    function relayout() {
      if (active) active.relayout();
    }

    return { run, settle, relayout, isRunning };
  }

  A.flip = { createFlip, transitionMs };
})(typeof globalThis !== 'undefined' ? globalThis : window);
