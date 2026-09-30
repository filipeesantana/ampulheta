/*
 * Ampulheta — scene.js
 * Agendador de renderização.
 *
 * O relógio (Date.now) é a única fonte da verdade; este módulo apenas decide
 * QUANDO redesenhar:
 *   - requestAnimationFrame enquanto há grãos no ar ou filete contínuo;
 *   - um único setTimeout até o próximo evento visível (próximo grão, mudança
 *     perceptível de massa, início ou fim) quando a ampulheta está imóvel;
 *   - nada quando a aba está oculta. Ao voltar (visibilitychange, focus,
 *     pageshow), redesenha imediatamente no estado correto — sem "replay".
 * Esperas longas são limitadas a 30 s (também protege contra suspensão do
 * sistema e contra o limite de 2³¹ ms do setTimeout).
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { clamp } = A.utils;

  const MAX_IDLE_WAIT = 30000;

  function createScene(host) {
    const renderer = A.renderer.createRenderer(host);
    const emitter = A.utils.createEmitter();
    let subject = null;
    let model = null;
    let rafId = 0;
    let timerId = 0;
    let reduced = false;
    let lastLanded = null;
    let lastStatus = null;
    let lastStream = false;
    let paused = false;

    function cancel() {
      if (rafId) cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
      rafId = 0;
      timerId = 0;
    }

    function invalidate() {
      cancel();
      if (paused || document.hidden || !subject) return;
      rafId = requestAnimationFrame(frame);
    }

    function frame() {
      rafId = 0;
      if (paused || document.hidden || !subject) return;
      const now = A.time.now();
      const out = renderer.draw(subject, now, { model, reducedMotion: reduced });

      if (out.status && out.status !== lastStatus) {
        const prev = lastStatus;
        lastStatus = out.status;
        emitter.emit('status', { status: out.status, prev, subject });
      }
      if (lastLanded === null || out.landed < lastLanded) lastLanded = out.landed;
      else if (out.landed > lastLanded) {
        emitter.emit('landed', { count: out.landed - lastLanded, rate: model.rate, stream: out.stream });
        lastLanded = out.landed;
      }
      const streaming = !!out.stream && out.status === 'running' && !reduced;
      if (streaming !== lastStream) {
        lastStream = streaming;
        emitter.emit('stream', { active: streaming, rate: model.rate });
      }

      if (out.animating) {
        rafId = requestAnimationFrame(frame);
      } else if (isFinite(out.nextWakeAt)) {
        const delay = clamp(out.nextWakeAt - now, 16, MAX_IDLE_WAIT);
        timerId = setTimeout(() => {
          timerId = 0;
          rafId = requestAnimationFrame(frame);
        }, delay);
      }
    }

    function setSubject(hourglass, options) {
      const prev = subject;
      subject = hourglass || null;
      model = subject ? A.grains.createModel(subject) : null;
      lastLanded = null;
      // Mesmo assunto atualizado (ex.: reiniciado): mantém o status para detectar mudanças ao vivo.
      if (!prev || !subject || prev.id !== subject.id || (options && options.resetStatus)) lastStatus = null;
      renderer.invalidate();
      invalidate();
    }

    function resize(width, height, dpr, insets) {
      renderer.resize(width, height, dpr, insets);
      invalidate();
    }

    function setReducedMotion(value) {
      reduced = !!value;
      invalidate();
    }

    function setPaused(value) {
      paused = !!value;
      if (paused) {
        cancel();
        if (lastStream) {
          lastStream = false;
          emitter.emit('stream', { active: false });
        }
      } else invalidate();
    }

    function resync() {
      // Evita "rajadas" de som/eventos acumulados durante a ausência.
      lastLanded = null;
      invalidate();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancel();
        if (lastStream) {
          lastStream = false;
          emitter.emit('stream', { active: false });
        }
      } else resync();
    });
    root.addEventListener('focus', resync);
    root.addEventListener('pageshow', resync);

    return {
      setSubject,
      resize,
      invalidate,
      resync,
      setReducedMotion,
      setPaused,
      layout: () => renderer.layout(),
      renderer: () => renderer,
      isPaused: () => paused,
      getSubject: () => subject,
      getModel: () => model,
      on: (type, fn) => emitter.on(type, fn)
    };
  }

  A.scene = { createScene };
})(typeof globalThis !== 'undefined' ? globalThis : window);
