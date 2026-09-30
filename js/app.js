/*
 * Ampulheta — app.js
 * Inicialização e coordenação: qual ampulheta está à vista, navegação,
 * atalhos de teclado, preferências e service worker.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { isTypingTarget } = A.utils;

  A.VERSION = '1.0.0';

  let currentId = null;
  let lastNavIndex = 0;

  /* ------------------------------------------------------------------ */
  /* Seleção                                                              */
  /* ------------------------------------------------------------------ */

  function current() {
    return currentId ? A.store.get(currentId) : null;
  }

  /** Lista navegável: ativas; se a atual estiver arquivada, ela é visitável a partir do menu. */
  function navList() {
    return A.store.active();
  }

  function neighborOf(id) {
    const list = navList();
    const idx = list.findIndex((h) => h.id === id);
    if (idx === -1) return list[0] || null;
    return list[idx + 1] || list[idx - 1] || null;
  }

  function select(id, direction) {
    const hg = id ? A.store.get(id) : null;
    if (!hg) {
      const first = navList()[0];
      if (first && first.id !== id) return select(first.id, direction);
      currentId = null;
      A.storage.ui.set('lastId', null);
      A.stage.showIntro();
      A.stage.updatePager([], null);
      A.panels.refresh();
      return;
    }
    const changed = hg.id !== currentId;
    currentId = hg.id;
    const navIdx = navList().findIndex((h) => h.id === hg.id);
    if (navIdx !== -1) lastNavIndex = navIdx;
    A.storage.ui.set('lastId', hg.id);
    if (!changed && A.stage.mode() === 'normal') A.stage.refreshSubject(hg);
    else A.stage.show(hg, direction || 0);
    A.stage.updatePager(navList(), hg);
    A.panels.refresh();
  }

  function step(delta) {
    const list = navList();
    if (!list.length) return;
    const idx = list.findIndex((h) => h.id === currentId);
    let next;
    if (idx === -1) next = delta > 0 ? 0 : list.length - 1;
    else next = (idx + delta + list.length) % list.length;
    if (list[next].id === currentId) return;
    select(list[next].id, delta);
  }

  /** Mantém a interface coerente após qualquer alteração nos dados. */
  function onStoreChange(ev) {
    const hg = current();
    const reason = ev ? ev.reason : '';
    if (!hg) {
      const list = navList();
      // A atual deixou de existir, ou chegaram dados de outra aba/importação.
      if (list.length && (currentId || reason === 'external' || reason === 'merge' || reason === 'replace')) {
        // Ao excluir, segue para a vizinha na mesma posição.
        const idx = Math.max(0, Math.min(lastNavIndex, list.length - 1));
        select(list[idx].id, currentId ? 1 : 0);
        return;
      }
      if (currentId) {
        select(null);
        return;
      }
      if (reason === 'create' && ev.id && A.store.get(ev.id)) {
        select(ev.id, 1);
        return;
      }
      A.stage.updatePager([], null);
      A.panels.refresh();
      return;
    }
    if (reason === 'update' || reason === 'external' || reason === 'replace') A.stage.refreshSubject(hg);
    A.stage.updatePager(navList(), hg);
    A.panels.refresh();
  }

  function afterImport() {
    const hg = current();
    if (hg) {
      A.stage.refreshSubject(hg);
      A.stage.updatePager(navList(), hg);
    } else {
      const first = navList()[0];
      select(first ? first.id : null, 1);
    }
    applySettings();
  }

  function exportData() {
    const count = A.store.all().length;
    if (!count) {
      A.dialogs.toast('Ainda não há ampulhetas para exportar.');
      return;
    }
    try {
      A.backup.exportAll();
      A.dialogs.toast(count === 1 ? '1 ampulheta exportada.' : count + ' ampulhetas exportadas.');
    } catch (err) {
      console.error(err);
      A.dialogs.toast('Não foi possível exportar.', { tone: 'error' });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Preferências                                                         */
  /* ------------------------------------------------------------------ */

  function reducedMotionActive() {
    return A.storage.settings.get('reduceMotion') || A.utils.systemPrefersReducedMotion();
  }

  function applySettings() {
    const s = A.storage.settings.all();
    document.body.classList.toggle('reduce-motion', reducedMotionActive());
    document.body.classList.toggle('hide-label', !s.showLabel);
    A.stage.setReducedMotion(reducedMotionActive());
    if (A.sound.isEnabled() !== s.sound) A.sound.setEnabled(s.sound);
  }

  function toggleSound() {
    const next = !A.storage.settings.get('sound');
    A.storage.settings.set('sound', next);
    A.sound.setEnabled(next);
    A.dialogs.toast(next ? 'Som dos grãos ligado.' : 'Som desligado.');
  }

  /* ------------------------------------------------------------------ */
  /* Teclado                                                              */
  /* ------------------------------------------------------------------ */

  function onKeyDown(ev) {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (isTypingTarget(ev.target)) return;
    if (A.dialogs.anyOpen()) return; // diálogos cuidam do próprio ESC
    const key = ev.key;
    const intro = A.stage.mode() === 'intro';
    let handled = true;
    switch (key) {
      case 'ArrowLeft':
        if (!intro) step(-1);
        break;
      case 'ArrowRight':
        if (!intro) step(1);
        break;
      case 'c':
      case 'C':
        if (!intro) A.stage.toggleContemplation();
        break;
      case 'f':
      case 'F':
        A.stage.toggleFullscreen();
        break;
      case 'i':
      case 'I':
        if (!intro) A.panels.openInfo();
        break;
      case 'm':
      case 'M':
        A.panels.openMenu();
        break;
      case 'n':
      case 'N':
        A.form.openCreate();
        break;
      case 's':
      case 'S':
        toggleSound();
        break;
      case '?':
        A.settingsUI.openHelp();
        break;
      case 'Escape':
        if (A.stage.isContemplating()) A.stage.exitContemplation();
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) ev.preventDefault();
    else if (A.stage.isContemplating()) A.stage.showControlsBriefly();
  }

  /* ------------------------------------------------------------------ */
  /* Granulação de fundo (gerada localmente)                              */
  /* ------------------------------------------------------------------ */

  function paintFilmGrain() {
    const target = document.querySelector('.stage__grain');
    if (!target) return;
    try {
      const size = 160;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(size, size);
      for (let i = 0; i < size * size; i++) {
        const v = Math.random() * 255;
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = Math.random() < 0.5 ? 60 : 0;
      }
      ctx.putImageData(img, 0, 0);
      target.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
    } catch (e) {
      /* sem granulação */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Inicialização                                                        */
  /* ------------------------------------------------------------------ */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    const register = () => navigator.serviceWorker.register('./sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else root.addEventListener('load', register, { once: true });
  }

  async function main() {
    A.stage.init();
    A.form.init();
    A.panels.init();
    A.settingsUI.init();
    paintFilmGrain();

    try {
      await A.storage.init();
      await A.store.load();
    } catch (err) {
      console.error('[Ampulheta] Falha ao carregar os dados.', err);
      A.dialogs.toast('Não foi possível ler os dados salvos neste navegador.', { tone: 'error' });
    }
    if (A.storage.getAdapter() && A.storage.getAdapter().kind === 'memory') {
      A.dialogs.toast('Armazenamento indisponível: as ampulhetas não serão guardadas.', { tone: 'error', duration: 6000 });
    }

    applySettings();
    A.storage.settings.on('change', applySettings);
    const mq = A.utils.mediaQuery('(prefers-reduced-motion: reduce)');
    if (mq && mq.addEventListener) mq.addEventListener('change', applySettings);
    root.addEventListener('storage', (ev) => {
      if (ev.key === A.storage.SETTINGS_KEY) A.storage.settings.reload();
    });

    A.store.on('change', onStoreChange);

    // Controles
    document.getElementById('btn-menu').addEventListener('click', () => A.panels.openMenu());
    document.getElementById('btn-info').addEventListener('click', () => A.panels.openInfo());
    document.getElementById('intro-create').addEventListener('click', () => A.form.openCreate());
    document.getElementById('intro-import').addEventListener('click', () => A.settingsUI.openImport());
    document.addEventListener('keydown', onKeyDown);
    // Libera o áudio no primeiro gesto (se o som estiver ligado).
    const unlock = () => A.sound.unlock();
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);

    // Ampulheta inicial: a última vista, ou a primeira ativa.
    const last = A.storage.ui.get('lastId');
    const lastHg = last ? A.store.get(last) : null;
    const first = A.store.active()[0];
    select(lastHg ? lastHg.id : first ? first.id : null, 0);

    // Entrada suave.
    document.body.classList.add('is-arriving');
    requestAnimationFrame(() => {
      setTimeout(() => document.body.classList.remove('is-booting'), 80);
      setTimeout(() => document.body.classList.remove('is-arriving'), 2800);
    });

    registerServiceWorker();
  }

  A.app = { current, select, step, neighborOf, exportData, afterImport, applySettings };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})(typeof globalThis !== 'undefined' ? globalThis : window);
