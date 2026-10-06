/*
 * Ampulheta — ui-stage.js
 * O palco: a ampulheta, a navegação inferior (nome, setas, posição, estado),
 * o gesto de deslizar, as transições entre ampulhetas, o reinício com virada
 * e o modo contemplação.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { qs, wait } = A.utils;
  const T = A.time;
  const F = A.format;

  let scene;
  let flip;
  let host;
  let E = {};
  let mode = 'normal'; // 'intro' | 'normal'
  let contemplating = false;
  let switchSeq = 0;
  let idleTimer = 0;
  let wakeLock = null;
  let enteredFullscreen = false;
  let resizeRaf = 0;
  let lastAria = '';

  function init() {
    host = qs('#glass-wrap');
    E = {
      dock: qs('#dock'),
      status: qs('#dock-status'),
      statusText: qs('#dock-status-text'),
      restart: qs('#dock-restart'),
      name: qs('#current-name'),
      picker: qs('#btn-picker'),
      position: qs('#dock-position'),
      prev: qs('#btn-prev'),
      next: qs('#btn-next'),
      contemplate: qs('#btn-contemplate'),
      intro: qs('#intro')
    };
    scene = A.scene.createScene(host);
    flip = A.flip.createFlip(scene);

    scene.on('status', onStatus);
    scene.on('landed', (ev) => {
      if (!A.sound.isEnabled() || ev.stream) return;
      A.sound.grain(ev.rate < 1 ? 1 : 0.7);
    });
    scene.on('stream', (ev) => {
      if (A.sound.isEnabled()) A.sound.stream(ev.active, ev.rate);
    });

    E.prev.addEventListener('click', () => A.app.step(-1));
    E.next.addEventListener('click', () => A.app.step(1));
    E.picker.addEventListener('click', () => A.panels.openPicker(E.picker));
    E.restart.addEventListener('click', () => A.app.runAction('restart'));
    E.contemplate.addEventListener('click', () => toggleContemplation());

    setupSwipe();
    setupIdle();

    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleResize) : null;
    if (ro) ro.observe(qs('#stage'));
    // Também cobre mudanças de densidade de pixels (ex.: janela levada a outro monitor).
    root.addEventListener('resize', scheduleResize);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (contemplating) requestWakeLock();
      updateAria();
    });
    applyLayout();
  }

  /* ------------------------------------------------------------------ */
  /* Layout                                                               */
  /* ------------------------------------------------------------------ */

  function insetsFor(w, h) {
    const small = w <= 600;
    const low = h <= 620;
    if (contemplating) {
      // Em baixo cabem o nome e, quando os controles reaparecem, a linha de
      // estado com "Reiniciar" — sem encostar na ampulheta.
      const m = Math.max(20, Math.round(h * 0.04));
      const bottom = h <= 460 ? m + 36 : low ? m + 62 : Math.max(m + 68, 104);
      return { top: m, bottom, side: small ? 12 : 40 };
    }
    if (mode === 'intro') {
      if (h <= 460) return { top: 48, bottom: 150, side: 16 };
      return {
        top: small ? 60 : Math.max(64, Math.round(h * 0.07)),
        bottom: low ? 190 : small ? 230 : 250,
        side: 16
      };
    }
    if (h <= 460) return { top: 52, bottom: 60, side: small ? 12 : 48 };
    if (low) return { top: 56, bottom: 100, side: small ? 12 : 48 };
    return { top: small ? 60 : 68, bottom: small ? 122 : 132, side: small ? 12 : 48 };
  }

  function applyLayout() {
    const stage = qs('#stage');
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    scene.resize(w, h, root.devicePixelRatio || 1, insetsFor(w, h));
    // Uma virada em andamento continua do mesmo ponto no novo enquadramento.
    if (flip && flip.isRunning()) flip.relayout();
  }

  function scheduleResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      applyLayout();
    });
  }

  /** Transição FLIP ao mudar o enquadramento (contemplação). */
  function relayoutAnimated() {
    const before = scene.layout();
    applyLayout();
    const after = scene.layout();
    if (!before || !after || reducedMotion()) return;
    const k = before.S / after.S;
    const dx = before.cx - after.cx;
    const dy = before.cy - after.cy;
    if (Math.abs(k - 1) < 0.001 && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    host.classList.remove('is-scaling');
    host.style.transformOrigin = after.cx + 'px ' + after.cy + 'px';
    host.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + k + ')';
    requestAnimationFrame(() => {
      host.classList.add('is-scaling');
      host.style.transform = '';
      setTimeout(() => host.classList.remove('is-scaling'), 750);
    });
  }

  function reducedMotion() {
    return document.body.classList.contains('reduce-motion');
  }

  /* ------------------------------------------------------------------ */
  /* Assunto (ampulheta exibida)                                          */
  /* ------------------------------------------------------------------ */

  /** Exibe uma ampulheta. direction: −1, 0 ou 1 (sentido da transição). */
  async function show(hourglass, direction) {
    const seq = ++switchSeq;
    const previous = scene.getSubject();
    const animate = !!previous && previous.id !== hourglass.id;
    if (!animate) host.classList.remove('is-leaving', 'is-entering');
    if (animate) {
      const shift = reducedMotion() ? 0 : (direction || 0) * 14;
      host.style.setProperty('--shift', shift + 'px');
      host.classList.remove('is-entering');
      host.classList.add('is-leaving');
      E.name.style.opacity = '0';
      await wait(reducedMotion() ? 60 : 130);
      if (seq !== switchSeq) return;
    }
    setMode('normal');
    scene.setSubject(hourglass);
    updateDock(hourglass);
    updateAria();
    if (animate) {
      host.classList.remove('is-leaving');
      host.classList.add('is-entering');
      void host.offsetWidth; // aplica o estado inicial antes de animar
      requestAnimationFrame(() => {
        if (seq !== switchSeq) return;
        host.classList.remove('is-entering');
        E.name.style.opacity = '';
      });
    } else {
      E.name.style.opacity = '';
    }
  }

  /** Atualiza a ampulheta atual sem transição (ex.: após edição). */
  function refreshSubject(hourglass) {
    scene.setSubject(hourglass);
    updateDock(hourglass);
    updateAria();
  }

  function todayHourglass() {
    const start = T.startOfLocalDay(T.now());
    return { id: '__hoje__', name: 'Hoje', start, end: T.addDays(start, 1), tone: 'areia' };
  }

  /** Primeiro uso: a ampulheta de hoje (não é salva) e um único botão. */
  function showIntro() {
    ++switchSeq;
    host.classList.remove('is-leaving', 'is-entering');
    E.name.style.opacity = '';
    setMode('intro');
    const hoje = todayHourglass();
    scene.setSubject(hoje);
    host.setAttribute('aria-label', 'Ampulheta de hoje: ' + F.formatPercentShort(T.computeState(hoje).progress) + ' do dia já passou.');
  }

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    document.body.classList.toggle('is-intro', mode === 'intro');
    E.intro.hidden = mode !== 'intro';
    if (mode === 'intro' && contemplating) exitContemplation();
    applyLayout();
  }

  function onStatus(ev) {
    const subject = ev.subject;
    if (subject && subject.id === '__hoje__') {
      // Virou o dia: uma nova ampulheta de hoje.
      if (ev.status === 'finished' && mode === 'intro') setTimeout(showIntro, 1500);
      return;
    }
    const current = A.app.current();
    if (!current || current.id !== subject.id) return;
    updateDock(current);
    updateAria();
    if (ev.prev != null) A.panels.refresh();
  }

  /* ------------------------------------------------------------------ */
  /* Navegação inferior                                                   */
  /* ------------------------------------------------------------------ */

  function statusFor(hg) {
    const s = T.computeState(hg);
    if (s.status === 'finished') return { text: 'Terminou.', restart: true };
    // Recém-reiniciada: o início é o instante em que ela pousa — não é uma espera.
    if (s.status === 'pending' && s.untilStart <= T.STARTING_WINDOW) return hg.archived ? { text: 'Arquivada.', restart: false } : null;
    if (s.status === 'pending') return { text: 'Começa em ' + F.formatDateLong(hg.start) + '.', restart: false };
    if (hg.archived) return { text: 'Arquivada.', restart: false };
    return null;
  }

  function updateDock(hg) {
    if (!hg) return;
    if (E.name.textContent !== hg.name) E.name.textContent = hg.name;
    E.picker.setAttribute('aria-label', 'Ampulheta atual: ' + hg.name + '. Escolher outra');

    const list = A.store.active();
    const idx = list.findIndex((h) => h.id === hg.id);
    const multi = list.length > 1 || (hg.archived && list.length > 0);
    E.prev.disabled = !multi;
    E.next.disabled = !multi;
    const pos = idx >= 0 && list.length > 1 ? idx + 1 + ' / ' + list.length : '';
    if (E.position.textContent !== pos) E.position.textContent = pos;

    const st = statusFor(hg);
    if (!st) {
      E.status.hidden = true;
    } else {
      if (E.statusText.textContent !== st.text || E.status.hidden) {
        E.statusText.textContent = st.text;
        E.status.hidden = false;
      }
      E.restart.hidden = !st.restart;
    }
  }

  function updateAria() {
    const hg = A.app.current();
    if (!hg || mode === 'intro') return;
    const s = T.computeState(hg);
    let text = hg.name + ': ';
    const waiting = s.status === 'pending' && s.untilStart > T.STARTING_WINDOW;
    if (waiting) text += 'ainda não começou; começa em ' + F.formatDateTime(hg.start) + '.';
    else if (s.status === 'finished') text += 'terminou em ' + F.formatDateTime(hg.end) + '.';
    else text += F.formatPercentShort(s.progress) + ' do tempo já passou; termina em ' + F.formatDateTime(hg.end) + '.';
    if (text !== lastAria) {
      host.setAttribute('aria-label', text);
      lastAria = text;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Reinício com virada                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Reinicia a ampulheta: grava o novo intervalo (mesma duração, novo início)
   * e só então exibe a virada. Funciona da mesma forma na tela normal, em tela
   * cheia e na contemplação — o estado vem sempre do registro gravado.
   */
  async function restart(hourglass) {
    if (!hourglass || flip.isRunning()) return null;
    if (contemplating) showControlsBriefly();
    const id = hourglass.id;
    const record = await flip.run(hourglass, {
      reducedMotion: reducedMotion(),
      commit: (startAt) => A.store.restart(id, startAt),
      latest: () => A.store.get(id)
    });
    const current = A.app.current();
    if (current && current.id === id) {
      updateDock(current);
      updateAria();
    }
    return record;
  }

  function settle() {
    return flip ? flip.settle() : Promise.resolve(null);
  }

  /* ------------------------------------------------------------------ */
  /* Gesto de deslizar                                                    */
  /* ------------------------------------------------------------------ */

  function setupSwipe() {
    const stage = qs('#stage');
    let start = null;
    stage.addEventListener(
      'pointerdown',
      (ev) => {
        if (ev.pointerType === 'mouse' || !ev.isPrimary) return;
        start = { x: ev.clientX, y: ev.clientY, t: performance.now(), id: ev.pointerId };
      },
      { passive: true }
    );
    const end = (ev) => {
      if (!start || ev.pointerId !== start.id) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      const dt = performance.now() - start.t;
      start = null;
      if (mode !== 'normal' || dt > 700 || A.dialogs.anyOpen()) return;
      // Horizontal, decidido e longe o bastante — não confunde com rolagem ou toque.
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) A.app.step(dx < 0 ? 1 : -1);
    };
    stage.addEventListener('pointerup', end, { passive: true });
    stage.addEventListener('pointercancel', () => (start = null), { passive: true });
  }

  /* ------------------------------------------------------------------ */
  /* Contemplação                                                         */
  /* ------------------------------------------------------------------ */

  const CONTROLS_SELECTOR = '.topbar, .dock';
  const IDLE_MS = 3200;
  let overControls = false;

  /** Há um controle sob o cursor ou com foco de teclado? Então não é hora de esconder. */
  function controlsInUse() {
    if (overControls) return true;
    const el = document.activeElement;
    if (!el || el === document.body || !el.closest || !el.closest(CONTROLS_SELECTOR)) return false;
    try {
      return el.matches(':focus-visible');
    } catch (e) {
      return false;
    }
  }

  function armIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      if (!contemplating) return;
      if (A.dialogs.anyOpen()) return; // reaparece ao fechar (onDialogChange)
      if (flip.isRunning() || controlsInUse()) {
        armIdleTimer();
        return;
      }
      document.body.classList.remove('show-controls');
      document.body.classList.add('is-idle');
    }, IDLE_MS);
  }

  /** Mostra os controles da contemplação; eles se recolhem sozinhos após um tempo parado. */
  function showControlsBriefly() {
    if (!contemplating) return;
    document.body.classList.add('show-controls');
    document.body.classList.remove('is-idle');
    armIdleTimer();
  }

  function setupIdle() {
    let lastMove = 0;
    document.addEventListener(
      'pointermove',
      (ev) => {
        if (!contemplating) return;
        if (ev.pointerType === 'mouse') {
          overControls = !!(ev.target && ev.target.closest && ev.target.closest(CONTROLS_SELECTOR));
          if (Math.abs(ev.movementX || 0) + Math.abs(ev.movementY || 0) < 2) return;
        }
        const now = performance.now();
        if (now - lastMove < 150) return;
        lastMove = now;
        showControlsBriefly();
      },
      { passive: true }
    );
    document.documentElement.addEventListener('pointerleave', () => (overControls = false), { passive: true });
    const reveal = () => {
      if (contemplating) showControlsBriefly();
    };
    // Qualquer interação traz os controles de volta — nunca ficam "presentes, mas inalcançáveis".
    document.addEventListener('pointerdown', reveal, { passive: true, capture: true });
    document.addEventListener('keydown', reveal, { capture: true });
    document.addEventListener('focusin', reveal);
    document.addEventListener('wheel', reveal, { passive: true });
  }

  function canFullscreen() {
    const d = document.documentElement;
    return !!(d.requestFullscreen || d.webkitRequestFullscreen);
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  /**
   * Pede tela cheia para o documento inteiro: palco, controles, painéis, menus,
   * confirmações e avisos ficam todos dentro da raiz e continuam utilizáveis.
   * Se o navegador recusar (agora ou depois), `onFail` é chamado.
   */
  function requestFullscreen(onFail) {
    const d = document.documentElement;
    const fail = () => {
      if (typeof onFail === 'function') onFail();
    };
    try {
      const p = d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(fail);
      return true;
    } catch (e) {
      fail();
      return false;
    }
  }

  function exitFullscreen() {
    try {
      const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen && document.webkitExitFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {
      /* ignora */
    }
  }

  function toggleFullscreen() {
    if (!canFullscreen()) {
      A.dialogs.toast('Tela cheia não é suportada neste navegador.');
      return;
    }
    if (isFullscreen()) exitFullscreen();
    else requestFullscreen();
  }

  async function requestWakeLock() {
    try {
      if (navigator.wakeLock && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
      }
    } catch (e) {
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  function setContemplateButton(on) {
    E.contemplate.setAttribute('aria-pressed', on ? 'true' : 'false');
    E.contemplate.setAttribute('aria-label', on ? 'Sair do modo contemplação' : 'Modo contemplação');
    E.contemplate.title = on ? 'Sair do modo contemplação (C ou Esc)' : 'Modo contemplação (C)';
    E.contemplate.querySelector('use').setAttribute('href', on ? '#i-focus-exit' : '#i-focus');
  }

  function enterContemplation() {
    if (contemplating || mode === 'intro') return;
    contemplating = true;
    A.panels.closeAll();
    document.body.classList.add('is-contemplating');
    setContemplateButton(true);
    relayoutAnimated();
    if (A.storage.settings.get('contemplationFullscreen') && canFullscreen() && !isFullscreen()) {
      enteredFullscreen = requestFullscreen(() => (enteredFullscreen = false));
    }
    requestWakeLock();
    showControlsBriefly();
  }

  function exitContemplation() {
    if (!contemplating) return;
    contemplating = false;
    overControls = false;
    clearTimeout(idleTimer);
    idleTimer = 0;
    document.body.classList.remove('is-contemplating', 'show-controls', 'is-idle');
    setContemplateButton(false);
    relayoutAnimated();
    if (enteredFullscreen && isFullscreen()) exitFullscreen();
    enteredFullscreen = false;
    releaseWakeLock();
  }

  function toggleContemplation() {
    if (contemplating) exitContemplation();
    else enterContemplation();
  }

  /**
   * A tela cheia pode mudar por fora da interface (Esc, F11, gestos do sistema):
   * a interface se sincroniza sempre a partir deste evento, nunca por suposição.
   */
  function onFullscreenChange() {
    const on = isFullscreen();
    if (!on && contemplating && enteredFullscreen) {
      enteredFullscreen = false;
      exitContemplation();
    }
    if (!on) enteredFullscreen = false;
    if (contemplating) showControlsBriefly();
    scheduleResize();
  }

  function onDialogChange(open) {
    // Com um diálogo aberto, a contemplação não esconde nada.
    if (!contemplating) return;
    if (open) {
      clearTimeout(idleTimer);
      document.body.classList.add('show-controls');
      document.body.classList.remove('is-idle');
    } else showControlsBriefly();
  }

  function setReducedMotion(value) {
    scene.setReducedMotion(value);
  }

  A.stage = {
    init,
    show,
    showIntro,
    refreshSubject,
    updateDock,
    restart,
    settle,
    isFlipping: () => !!(flip && flip.isRunning()),
    toggleContemplation,
    exitContemplation,
    toggleFullscreen,
    isContemplating: () => contemplating,
    isFullscreen,
    showControlsBriefly,
    onDialogChange,
    setReducedMotion,
    mode: () => mode,
    scene: () => scene
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
