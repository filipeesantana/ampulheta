/*
 * Ampulheta — ui-stage.js
 * O palco: canvas da ampulheta, legenda, paginação, setas, gesto de
 * deslizar, transições entre ampulhetas e modo contemplação.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { el, qs, clear, icon, wait, clamp } = A.utils;
  const T = A.time;
  const F = A.format;

  let scene;
  let canvas;
  let wrap;
  let E = {};
  let mode = 'normal'; // 'intro' | 'normal'
  let contemplating = false;
  let switchSeq = 0;
  let idleTimer = 0;
  let wakeLock = null;
  let enteredFullscreen = false;
  let resizeRaf = 0;

  function init() {
    canvas = qs('#hourglass');
    wrap = qs('#glass-wrap');
    E = {
      caption: qs('#caption'),
      name: qs('#caption-name'),
      status: qs('#caption-status'),
      pager: qs('#pager'),
      prev: qs('#btn-prev'),
      next: qs('#btn-next'),
      contemplate: qs('#btn-contemplate'),
      intro: qs('#intro'),
      introText: qs('#intro-text')
    };
    scene = A.scene.createScene(canvas);

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
    E.name.addEventListener('click', () => A.panels.openInfo());
    E.contemplate.addEventListener('click', () => toggleContemplation());

    setupSwipe();
    setupIdle();

    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleResize) : null;
    if (ro) ro.observe(qs('#stage'));
    root.addEventListener('resize', scheduleResize);
    root.addEventListener('orientationchange', scheduleResize);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && contemplating) requestWakeLock();
      if (!document.hidden) updateAria();
    });
    applyLayout();
  }

  /* ------------------------------------------------------------------ */
  /* Layout                                                               */
  /* ------------------------------------------------------------------ */

  function insetsFor(w, h) {
    const small = w <= 480;
    const low = h <= 520;
    if (contemplating) {
      const m = Math.max(18, Math.round(h * 0.035));
      return { top: m, bottom: m, side: small ? 12 : 40 };
    }
    if (mode === 'intro') {
      if (low) return { top: 40, bottom: 110, side: 16 };
      return {
        top: small ? 64 : Math.max(70, Math.round(h * 0.075)),
        bottom: small ? clamp(Math.round(h * 0.3), 200, 250) : clamp(Math.round(h * 0.27), 210, 270),
        side: 16
      };
    }
    if (low) return { top: 44, bottom: 56, side: small ? 12 : 64 };
    return {
      top: small ? 58 : 72,
      bottom: small ? 84 : 104,
      side: small ? 12 : 72
    };
  }

  function applyLayout() {
    const stage = qs('#stage');
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    scene.resize(w, h, root.devicePixelRatio || 1, insetsFor(w, h));
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
    if (!before || !after || document.body.classList.contains('reduce-motion')) return;
    const k = before.S / after.S;
    const dx = before.cx - after.cx;
    const dy = before.cy - after.cy;
    wrap.classList.remove('is-scaling');
    wrap.style.transformOrigin = after.cx + 'px ' + after.cy + 'px';
    wrap.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + k + ')';
    void wrap.offsetWidth;
    requestAnimationFrame(() => {
      wrap.classList.add('is-scaling');
      wrap.style.transform = '';
      setTimeout(() => wrap.classList.remove('is-scaling'), 950);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Assunto (ampulheta exibida)                                          */
  /* ------------------------------------------------------------------ */

  function reducedMotion() {
    return document.body.classList.contains('reduce-motion');
  }

  /** Exibe uma ampulheta. direction: −1, 0 ou 1 (sentido da transição). */
  async function show(hourglass, direction, options) {
    const opts = options || {};
    const seq = ++switchSeq;
    const previous = scene.getSubject();
    const animate = !opts.instant && previous && previous.id !== hourglass.id;
    if (!animate) wrap.classList.remove('is-leaving', 'is-entering');
    if (animate) {
      const shift = reducedMotion() ? 0 : (direction || 0) * 22;
      wrap.style.setProperty('--shift', shift + 'px');
      wrap.classList.add('is-leaving');
      E.caption.style.opacity = '0';
      await wait(reducedMotion() ? 120 : 250);
      if (seq !== switchSeq) return;
    }
    setMode('normal');
    scene.setSubject(hourglass);
    updateCaption(hourglass, false);
    updateAria();
    if (animate) {
      wrap.classList.remove('is-leaving');
      wrap.classList.add('is-entering');
      void wrap.offsetWidth;
      requestAnimationFrame(() => {
        if (seq !== switchSeq) return;
        wrap.classList.remove('is-entering');
        E.caption.style.opacity = '';
      });
    } else {
      E.caption.style.opacity = '';
    }
  }

  /** Atualiza a ampulheta atual sem transição (ex.: após edição). */
  function refreshSubject(hourglass) {
    scene.setSubject(hourglass);
    updateCaption(hourglass, false);
    updateAria();
  }

  function todayHourglass() {
    const start = T.startOfLocalDay(T.now());
    return { id: '__hoje__', name: 'Hoje', start, end: T.addDays(start, 1), tone: 'areia' };
  }

  /** Tela de primeiro uso, com a ampulheta de hoje (não é salva). */
  function showIntro() {
    ++switchSeq;
    wrap.classList.remove('is-leaving', 'is-entering');
    E.caption.style.opacity = '';
    const hoje = todayHourglass();
    setMode('intro');
    scene.setSubject(hoje);
    const model = A.grains.createModel(hoje);
    E.introText.textContent =
      'Esta é a ampulheta de hoje. Cada grão que cai equivale a cerca de ' + F.formatDuration(model.grainMs, 1) + '.';
    canvas.setAttribute('aria-label', 'Ampulheta de hoje: ' + F.formatPercent(T.computeState(hoje).progress) + ' do dia já passou.');
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
    // Transição ao vivo (ex.: terminou agora): o texto aparece devagar.
    const live = ev.prev != null;
    updateCaption(current, live);
    updateAria();
    if (live) A.panels.refresh();
  }

  function captionStatus(hg) {
    const s = T.computeState(hg);
    if (s.status === 'finished') return 'Terminou.';
    if (s.status === 'pending') return 'Começa em ' + F.formatDateLong(hg.start) + '.';
    if (hg.archived) return 'Arquivada.';
    return '';
  }

  function updateCaption(hg, live) {
    E.name.textContent = hg.name;
    E.name.setAttribute('aria-label', hg.name + ' — ver detalhes');
    E.name.title = 'Ver detalhes (I)';
    const text = captionStatus(hg);
    const node = E.status;
    if (node.textContent !== text) {
      node.classList.remove('is-visible');
      node.textContent = text;
      if (text) {
        if (live) {
          setTimeout(() => node.classList.add('is-visible'), 900);
        } else {
          void node.offsetWidth;
          node.classList.add('is-visible');
        }
      }
    } else if (text) node.classList.add('is-visible');
  }

  function updateAria() {
    const hg = A.app.current();
    if (!hg || mode === 'intro') return;
    const s = T.computeState(hg);
    let text = hg.name + ': ';
    if (s.status === 'pending') text += 'ainda não começou; começa em ' + F.formatDateTime(hg.start) + '.';
    else if (s.status === 'finished') text += 'concluída em ' + F.formatDateTime(hg.end) + '.';
    else text += F.formatPercent(s.progress, { minDecimals: 0 }) + ' transcorrido; termina em ' + F.formatDateTime(hg.end) + '.';
    canvas.setAttribute('aria-label', text);
  }

  /* ------------------------------------------------------------------ */
  /* Paginação                                                            */
  /* ------------------------------------------------------------------ */

  function updatePager(list, current) {
    clear(E.pager);
    const idx = current ? list.findIndex((h) => h.id === current.id) : -1;
    const multi = list.length > 1 || (current && current.archived && list.length > 0);
    E.prev.classList.toggle('is-hidden', !multi);
    E.next.classList.toggle('is-hidden', !multi);
    E.prev.disabled = !multi;
    E.next.disabled = !multi;
    if (list.length <= 1) {
      E.pager.hidden = true;
      return;
    }
    E.pager.hidden = false;
    if (list.length <= 12) {
      list.forEach((hg, i) => {
        E.pager.appendChild(
          el('button', {
            class: 'pager__dot',
            attrs: {
              type: 'button',
              'aria-label': hg.name + ' (' + (i + 1) + ' de ' + list.length + ')',
              'aria-current': i === idx ? 'true' : 'false',
              title: hg.name
            },
            on: { click: () => A.app.select(hg.id, i > idx ? 1 : -1) }
          })
        );
      });
    } else {
      E.pager.appendChild(
        el('button', { class: 'pager__step', attrs: { type: 'button', 'aria-label': 'Anterior' }, on: { click: () => A.app.step(-1) } }, [icon('prev')])
      );
      E.pager.appendChild(
        el('span', { class: 'pager__count', text: (idx >= 0 ? idx + 1 : '–') + ' / ' + list.length, attrs: { 'aria-live': 'polite' } })
      );
      E.pager.appendChild(
        el('button', { class: 'pager__step', attrs: { type: 'button', 'aria-label': 'Próxima' }, on: { click: () => A.app.step(1) } }, [icon('next')])
      );
    }
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
        if (ev.pointerType === 'mouse') return;
        start = { x: ev.clientX, y: ev.clientY, t: performance.now() };
      },
      { passive: true }
    );
    const end = (ev) => {
      if (!start) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      const dt = performance.now() - start.t;
      start = null;
      if (mode !== 'normal' || dt > 800) return;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) A.app.step(dx < 0 ? 1 : -1);
    };
    stage.addEventListener('pointerup', end, { passive: true });
    stage.addEventListener('pointercancel', () => (start = null), { passive: true });
  }

  /* ------------------------------------------------------------------ */
  /* Contemplação                                                         */
  /* ------------------------------------------------------------------ */

  function showControlsBriefly() {
    if (!contemplating) return;
    document.body.classList.add('show-controls');
    document.body.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      document.body.classList.remove('show-controls');
      document.body.classList.add('is-idle');
    }, 2600);
  }

  function setupIdle() {
    const wake = () => showControlsBriefly();
    let lastMove = 0;
    document.addEventListener(
      'pointermove',
      (ev) => {
        // Ignora micro-movimentos e eventos sintéticos repetidos.
        if (Math.abs(ev.movementX || 0) + Math.abs(ev.movementY || 0) < 2 && ev.pointerType === 'mouse') return;
        const now = performance.now();
        if (now - lastMove < 120) return;
        lastMove = now;
        wake();
      },
      { passive: true }
    );
    document.addEventListener('pointerdown', wake, { passive: true });
  }

  function canFullscreen() {
    const d = document.documentElement;
    return !!(d.requestFullscreen || d.webkitRequestFullscreen);
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function requestFullscreen() {
    const d = document.documentElement;
    try {
      const p = d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return true;
    } catch (e) {
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

  function enterContemplation() {
    if (contemplating || mode === 'intro') return;
    contemplating = true;
    document.body.classList.add('is-contemplating');
    E.contemplate.setAttribute('aria-pressed', 'true');
    E.contemplate.setAttribute('aria-label', 'Sair do modo contemplação');
    E.contemplate.querySelector('use').setAttribute('href', '#i-focus-exit');
    relayoutAnimated();
    if (A.storage.settings.get('contemplationFullscreen') && canFullscreen() && !isFullscreen()) {
      enteredFullscreen = requestFullscreen();
    }
    requestWakeLock();
    showControlsBriefly();
  }

  function exitContemplation() {
    if (!contemplating) return;
    contemplating = false;
    clearTimeout(idleTimer);
    document.body.classList.remove('is-contemplating', 'show-controls', 'is-idle');
    E.contemplate.setAttribute('aria-pressed', 'false');
    E.contemplate.setAttribute('aria-label', 'Modo contemplação');
    E.contemplate.querySelector('use').setAttribute('href', '#i-focus');
    relayoutAnimated();
    if (enteredFullscreen && isFullscreen()) exitFullscreen();
    enteredFullscreen = false;
    releaseWakeLock();
  }

  function toggleContemplation() {
    if (contemplating) exitContemplation();
    else enterContemplation();
  }

  function onFullscreenChange() {
    if (!isFullscreen() && contemplating && enteredFullscreen) {
      enteredFullscreen = false;
      exitContemplation();
    }
    scheduleResize();
  }

  function onDialogChange(open) {
    // Diálogos abertos: a contemplação não esconde nada.
    if (open && contemplating) document.body.classList.add('show-controls');
    else if (!open && contemplating) showControlsBriefly();
  }

  function setReducedMotion(value) {
    scene.setReducedMotion(value);
  }

  A.stage = {
    init,
    show,
    showIntro,
    refreshSubject,
    updatePager,
    updateCaption,
    toggleContemplation,
    exitContemplation,
    toggleFullscreen,
    isContemplating: () => contemplating,
    showControlsBriefly,
    onDialogChange,
    setReducedMotion,
    mode: () => mode,
    scene: () => scene
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
