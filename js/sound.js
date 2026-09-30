/*
 * Ampulheta — sound.js
 * Som opcional, desativado por padrão, sintetizado (sem arquivos de áudio).
 *  - grão: um sopro curtíssimo de ruído filtrado, em volume muito baixo;
 *  - filete: um chiado contínuo e abafado quando muitos grãos caem por segundo.
 * O AudioContext só é criado após uma interação do usuário (política dos navegadores).
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;

  let ctx = null;
  let master = null;
  let noise = null;
  let enabled = false;
  let streamSrc = null;
  let streamGain = null;
  let lastGrainAt = 0;

  function available() {
    return !!(root.AudioContext || root.webkitAudioContext);
  }

  function ensureContext() {
    if (!available()) return null;
    if (!ctx) {
      const Ctor = root.AudioContext || root.webkitAudioContext;
      try {
        ctx = new Ctor();
      } catch (e) {
        return null;
      }
      master = ctx.createGain();
      master.gain.value = 0.9;
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 7000;
      master.connect(soften).connect(ctx.destination);
      // 1 s de ruído branco reutilizável.
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /** Deve ser chamado a partir de um gesto do usuário para liberar o áudio. */
  function unlock() {
    if (enabled) ensureContext();
  }

  function setEnabled(value) {
    enabled = !!value;
    if (enabled) ensureContext();
    else stopStream();
  }

  function ready() {
    return enabled && ctx && ctx.state === 'running';
  }

  function grain(intensity) {
    if (!ready()) return;
    const nowMs = performance.now();
    if (nowMs - lastGrainAt < 70) return; // no máximo ~14 por segundo
    lastGrainAt = nowMs;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2400 + Math.random() * 2600;
    band.Q.value = 1.3;
    const gain = ctx.createGain();
    const peak = 0.045 * (intensity || 1);
    const decay = 0.035 + Math.random() * 0.035;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(band).connect(gain).connect(master);
    src.start(t, Math.random() * 0.8, decay + 0.02);
  }

  function startStream(rate) {
    if (!ready()) return;
    if (!streamSrc) {
      streamSrc = ctx.createBufferSource();
      streamSrc.buffer = noise;
      streamSrc.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 3200;
      band.Q.value = 0.7;
      streamGain = ctx.createGain();
      streamGain.gain.value = 0.0001;
      streamSrc.connect(band).connect(streamGain).connect(master);
      streamSrc.start();
    }
    const level = Math.min(0.022, 0.006 + (rate || 0) / 6000);
    streamGain.gain.setTargetAtTime(level, ctx.currentTime, 0.4);
  }

  function stopStream() {
    if (!streamSrc || !ctx) return;
    const src = streamSrc;
    streamGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
    streamSrc = null;
    setTimeout(() => {
      try {
        src.stop();
      } catch (e) {
        /* já parado */
      }
    }, 1200);
  }

  function stream(active, rate) {
    if (active) startStream(rate);
    else stopStream();
  }

  A.sound = { available, unlock, setEnabled, grain, stream, isEnabled: () => enabled };
})(typeof globalThis !== 'undefined' ? globalThis : window);
