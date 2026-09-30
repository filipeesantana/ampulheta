/*
 * Ampulheta — flip.js
 * A virada: animação de reinício de uma ampulheta.
 *
 * Sequência:
 *   1. (se ainda havia areia em cima) a areia restante escoa depressa;
 *   2. a ampulheta é erguida e gira 180° com peso e inércia — a areia
 *      acompanha a gravidade dentro do bulbo, como um fluido granular;
 *   3. perto do fim, a ampulheta "real" (já na orientação normal) assume;
 *   4. o novo intervalo é gravado (início = agora, mesma duração) e o ciclo recomeça.
 *
 * A animação é pura representação: o reinício só é gravado no fim, com o
 * horário daquele instante. Nenhum timer, partícula ou laço sobrevive a ela.
 * Com movimento reduzido: um esmaecimento curto, sem rotação.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { clamp } = A.utils;

  const DRAIN_MS = 620;
  const FLIP_MS = 1450;
  const HANDOFF = 0.78; // fração da rotação a partir da qual o objeto real assume

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

  function createFlip(scene) {
    let active = null;

    function isRunning() {
      return !!active;
    }

    /**
     * Executa a virada e grava o reinício.
     * options: { reducedMotion, commit: async () => registro atualizado }
     * Retorna uma Promise com o registro atualizado (ou lança o erro do commit).
     */
    function run(hourglass, options) {
      if (active) return active.promise;
      const opts = options || {};
      const renderer = scene.renderer();
      const obj = renderer.objectEl;
      const shadow = renderer.shadowEl;
      const layout = renderer.layout();
      const tone = hourglass.tone || 'areia';
      const model = A.grains.createModel(hourglass);
      const p0 = A.time.computeState(hourglass).progress;
      const needDrain = p0 < 0.999 && !opts.reducedMotion;
      const liftPx = layout ? 0.045 * layout.S : 0;
      // Deitada, a ampulheta ocupa na horizontal a sua altura: se não couber, ela
      // se afasta um pouco durante o giro (como a câmera recuando).
      const stageW = document.documentElement.clientWidth;
      const fitScale = layout ? Math.min(1, (stageW - 24) / (layout.box.h * 0.94)) : 1;

      let rafId = 0;
      let double = null;
      let skip = false;
      let phase = needDrain ? 'drain' : 'flip';
      let phaseStart = performance.now();
      let resolveFn;
      let rejectFn;
      const promise = new Promise((res, rej) => {
        resolveFn = res;
        rejectFn = rej;
      });

      scene.setPaused(true);
      document.body.classList.add('is-flipping');

      function cleanupVisuals() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        // O objeto real já mostra a areia toda em cima enquanto o reinício é gravado.
        if (!opts.reducedMotion) renderer.paintFluidMain(0, tone);
        if (double) double.destroy();
        double = null;
        obj.style.transform = '';
        obj.style.opacity = opts.reducedMotion ? '0' : '';
        shadow.style.transform = '';
        shadow.style.opacity = '';
      }

      async function finish() {
        cleanupVisuals();
        let record = null;
        let error = null;
        try {
          record = await opts.commit();
        } catch (err) {
          error = err;
        }
        document.body.classList.remove('is-flipping');
        active = null;
        if (record) scene.setSubject(record);
        scene.setPaused(false);
        if (opts.reducedMotion) {
          requestAnimationFrame(() => {
            obj.style.transition = '';
            obj.style.opacity = '';
          });
        }
        if (error) rejectFn(error);
        else resolveFn(record);
      }

      function frame(nowPerf) {
        rafId = 0;
        if (document.hidden) skip = true;
        const elapsed = nowPerf - phaseStart;

        if (phase === 'drain') {
          const u = skip ? 1 : clamp(elapsed / DRAIN_MS, 0, 1);
          const p = p0 + (1 - p0) * easeInOutSine(u);
          renderer.draw(hourglass, A.time.now(), { model, progress: p, stream: u < 0.985 });
          if (u >= 1) {
            phase = 'flip';
            phaseStart = nowPerf;
          }
          rafId = requestAnimationFrame(frame);
          return;
        }

        // Virada
        if (!double) {
          renderer.draw(hourglass, A.time.now(), { model, progress: 1 });
          double = renderer.createFlipDouble();
          obj.style.opacity = '0';
        }
        const u = skip ? 1 : clamp(elapsed / FLIP_MS, 0, 1);
        const e = easeInOutCubic(u);
        const angle = Math.PI * e;
        const lift = -Math.sin(Math.PI * u) * liftPx;
        const scale = 1 - (1 - fitScale) * Math.sin(Math.PI * e);
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

        if (u >= 1) {
          finish();
          return;
        }
        rafId = requestAnimationFrame(frame);
      }

      if (opts.reducedMotion) {
        // Reinício acessível: esmaecer, gravar, reaparecer.
        obj.style.transition = 'opacity 140ms linear';
        obj.style.opacity = '0';
        setTimeout(finish, 150);
      } else {
        rafId = requestAnimationFrame(frame);
      }

      active = {
        promise,
        /** Conclui imediatamente (ex.: o usuário trocou de ampulheta). */
        skip() {
          skip = true;
          if (opts.reducedMotion) return;
          if (!rafId) rafId = requestAnimationFrame(frame);
        }
      };
      return promise;
    }

    /** Pede a conclusão imediata e espera o reinício ser gravado. */
    function settle() {
      if (!active) return Promise.resolve(null);
      active.skip();
      return active.promise.catch(() => null);
    }

    return { run, settle, isRunning };
  }

  A.flip = { createFlip };
})(typeof globalThis !== 'undefined' ? globalThis : window);
