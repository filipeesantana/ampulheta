/*
 * Ampulheta — app.js
 * Inicialização e coordenação: qual ampulheta está à vista, navegação,
 * ações sobre a ampulheta atual, atalhos de teclado, preferências e
 * service worker.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { isTypingTarget } = A.utils;
  const F = A.format;

  A.VERSION = '2.1.0';

  let currentId = null;
  let lastNavIndex = 0;

  /* ------------------------------------------------------------------ */
  /* Seleção                                                              */
  /* ------------------------------------------------------------------ */

  function current() {
    return currentId ? A.store.get(currentId) : null;
  }

  /** Lista navegável: só as ativas (arquivadas são abertas pelo menu). */
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
    // Uma virada em andamento é concluída antes de trocar.
    if (A.stage.isFlipping()) {
      A.stage.settle().then(() => select(id, direction));
      return;
    }
    const hg = id ? A.store.get(id) : null;
    if (!hg) {
      const first = navList()[0];
      if (first && first.id !== id) {
        select(first.id, direction);
        return;
      }
      currentId = null;
      A.storage.ui.set('lastId', null);
      A.stage.showIntro();
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
      A.panels.refresh();
      return;
    }
    const refreshReasons = ['update', 'external', 'replace', 'restart'];
    if (refreshReasons.includes(reason) && !A.stage.isFlipping()) A.stage.refreshSubject(hg);
    else A.stage.updateDock(hg);
    A.panels.refresh();
  }

  function afterImport() {
    const hg = current();
    if (hg) A.stage.refreshSubject(hg);
    else {
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
      A.dialogs.toast('Backup exportado (' + (count === 1 ? '1 ampulheta' : count + ' ampulhetas') + ').');
    } catch (err) {
      console.error('[Ampulheta]', err);
      A.dialogs.toast('Não foi possível exportar o backup.', { tone: 'error' });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Ações sobre a ampulheta atual                                        */
  /* ------------------------------------------------------------------ */

  async function confirmRestart(hg) {
    const s = A.time.computeState(hg);
    // Terminada: reiniciar não perde nada — sem pergunta.
    if (s.status === 'finished') return true;
    return A.dialogs.confirm({
      title: 'Reiniciar “' + hg.name + '”?',
      text: 'Ela recomeça agora, com a mesma duração: ' + F.formatDurationParts(hg.duration, 3) + '.',
      confirmLabel: 'Reiniciar'
    });
  }

  async function runAction(action) {
    const hg = current();
    if (!hg) return;
    try {
      switch (action) {
        case 'info':
          A.panels.openInfo();
          break;
        case 'edit':
          await A.stage.settle();
          A.form.openEdit(current());
          break;
        case 'restart': {
          if (A.stage.isFlipping()) return;
          if (!(await confirmRestart(hg))) return;
          // Enquanto a pergunta esteve aberta, a ampulheta pode ter mudado.
          const target = current();
          if (!target || target.id !== hg.id || A.stage.isFlipping()) return;
          A.panels.closeAll();
          const record = await A.stage.restart(target);
          if (record) A.dialogs.toast('Ampulheta reiniciada.');
          break;
        }
        case 'duplicate': {
          await A.stage.settle();
          const copy = await A.store.duplicate(hg.id);
          select(copy.id, 1);
          A.dialogs.toast('Ampulheta duplicada.');
          break;
        }
        case 'archive': {
          await A.stage.settle();
          if (hg.archived) {
            await A.store.setArchived(hg.id, false);
            A.dialogs.toast('Ampulheta desarquivada.');
          } else {
            const neighbor = neighborOf(hg.id);
            await A.store.setArchived(hg.id, true);
            A.panels.closeAll();
            A.dialogs.toast('Ampulheta arquivada.');
            select(neighbor && neighbor.id !== hg.id ? neighbor.id : null, 1);
          }
          break;
        }
        case 'delete': {
          const ok = await A.dialogs.confirm({
            title: 'Excluir “' + hg.name + '”?',
            text: 'Ela será apagada deste navegador. Não é possível desfazer, a não ser por um backup.',
            confirmLabel: 'Excluir',
            danger: true
          });
          if (!ok) return;
          await A.stage.settle();
          A.panels.closeAll();
          // A interface segue sozinha para a vizinha (ou para o primeiro uso).
          await A.store.remove(hg.id);
          A.dialogs.toast('Ampulheta excluída.');
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error('[Ampulheta]', err);
      A.dialogs.toast('Não foi possível concluir a ação. Tente novamente.', { tone: 'error' });
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
    const reduced = reducedMotionActive();
    document.body.classList.toggle('reduce-motion', reduced);
    document.body.classList.toggle('hide-name', !s.showLabel);
    A.stage.setReducedMotion(reduced);
    if (A.sound.isEnabled() !== s.sound) A.sound.setEnabled(s.sound);
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
        if (intro) handled = false;
        else step(-1);
        break;
      case 'ArrowRight':
        if (intro) handled = false;
        else step(1);
        break;
      case 'l':
      case 'L':
        if (!intro) A.panels.openPicker();
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
      case 'r':
      case 'R':
        if (intro) handled = false;
        else runAction('restart');
        break;
      case 'm':
      case 'M':
        A.panels.openMenu();
        break;
      case 'n':
      case 'N':
        A.form.openCreate();
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
  /* Granulação de fundo (gerada localmente, uma única vez)               */
  /* ------------------------------------------------------------------ */

  function paintFilmGrain() {
    const target = document.querySelector('.stage__backdrop');
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
        img.data[i * 4 + 3] = Math.random() < 0.5 ? 255 : 0;
      }
      ctx.putImageData(img, 0, 0);
      target.style.setProperty('--grain', 'url(' + c.toDataURL('image/png') + ')');
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
    const register = () =>
      navigator.serviceWorker
        .register('./sw.js', { updateViaCache: 'none' })
        .then((reg) => reg.update && reg.update().catch(() => {}))
        .catch(() => {});
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
      A.dialogs.toast('Não foi possível ler as ampulhetas salvas neste navegador. Recarregue a página.', {
        tone: 'error',
        duration: 7000
      });
    }
    const adapter = A.storage.getAdapter();
    if (adapter && adapter.kind === 'memory') {
      A.dialogs.toast('O navegador bloqueou o armazenamento local: as ampulhetas não serão guardadas depois que a página for fechada.', {
        tone: 'error',
        duration: 8000
      });
    } else if (adapter && adapter.kind === 'localstorage') {
      A.dialogs.toast('Usando um modo alternativo de armazenamento neste navegador.', { duration: 4000 });
    }
    A.storage.on('versionchange', () => {
      A.dialogs.toast('A Ampulheta foi atualizada em outra aba. Recarregue esta página para continuar salvando.', {
        tone: 'error',
        duration: 10000
      });
    });

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
    document.getElementById('btn-new').addEventListener('click', () => A.form.openCreate());
    document.getElementById('btn-info').addEventListener('click', () => A.panels.openInfo());
    document.getElementById('btn-actions').addEventListener('click', (ev) => A.panels.openActions(ev.currentTarget));
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

    requestAnimationFrame(() => document.body.classList.remove('is-booting'));

    registerServiceWorker();
  }

  A.app = { current, select, step, neighborOf, runAction, exportData, afterImport, applySettings };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})(typeof globalThis !== 'undefined' ? globalThis : window);
