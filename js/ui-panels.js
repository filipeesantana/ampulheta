/*
 * Ampulheta — ui-panels.js
 * Menu lateral (lista de ampulhetas e ações gerais) e painel de detalhes.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { el, qs, clear, svgEl } = A.utils;
  const T = A.time;
  const F = A.format;

  let menu;
  let info;
  let infoTimer = 0;
  const E = {};

  function init() {
    menu = qs('#menu-panel');
    info = qs('#info-panel');
    [
      'menu-list', 'menu-empty', 'menu-archived', 'menu-archived-wrap', 'menu-archived-count',
      'info-title', 'info-status', 'info-bar', 'info-grain', 'info-start', 'info-end', 'info-duration',
      'info-elapsed', 'info-remaining', 'info-pct', 'info-pct-rest', 'info-grains', 'info-fallen',
      'info-left', 'info-grain-value', 'info-next', 'info-tz', 'act-archive'
    ].forEach((id) => (E[id] = qs('#' + id)));

    qs('#menu-new').addEventListener('click', () => {
      A.dialogs.close(menu);
      A.form.openCreate();
    });
    qs('#menu-export').addEventListener('click', () => A.app.exportData());
    qs('#menu-import').addEventListener('click', () => A.settingsUI.openImport());
    qs('#menu-settings').addEventListener('click', () => A.settingsUI.openSettings());
    qs('#menu-help').addEventListener('click', () => A.settingsUI.openHelp());

    qs('#act-edit').addEventListener('click', () => {
      const hg = A.app.current();
      if (hg) A.form.openEdit(hg);
    });
    qs('#act-duplicate').addEventListener('click', async () => {
      const hg = A.app.current();
      if (!hg) return;
      const copy = await A.store.duplicate(hg.id);
      A.app.select(copy.id, 1);
      A.dialogs.toast('Ampulheta duplicada.');
    });
    qs('#act-restart').addEventListener('click', async () => {
      const hg = A.app.current();
      if (!hg) return;
      const copy = await A.store.restart(hg.id);
      A.app.select(copy.id, 1);
      A.dialogs.toast('Nova ampulheta começando agora.');
    });
    qs('#act-archive').addEventListener('click', async () => {
      const hg = A.app.current();
      if (!hg) return;
      if (hg.archived) {
        await A.store.setArchived(hg.id, false);
        A.dialogs.toast('Ampulheta restaurada.');
      } else {
        const neighbor = A.app.neighborOf(hg.id);
        await A.store.setArchived(hg.id, true);
        A.dialogs.close(info);
        A.dialogs.toast('Ampulheta arquivada.');
        A.app.select(neighbor ? neighbor.id : null, 1);
      }
    });
    qs('#act-delete').addEventListener('click', async () => {
      const hg = A.app.current();
      if (!hg) return;
      const ok = await A.dialogs.confirm({
        title: 'Excluir “' + hg.name + '”?',
        text: 'A ampulheta será apagada deste navegador. Esta ação não pode ser desfeita — a não ser que você tenha um backup.',
        confirmLabel: 'Excluir',
        danger: true
      });
      if (!ok) return;
      A.dialogs.close(info);
      // A interface segue sozinha para a vizinha (ou para a introdução).
      await A.store.remove(hg.id);
      A.dialogs.toast('Ampulheta excluída.');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Menu                                                                 */
  /* ------------------------------------------------------------------ */

  /** Pequeno glifo de ampulheta com a areia proporcional ao progresso. */
  function glyph(progress) {
    const p = Math.max(0, Math.min(1, progress));
    const svg = svgEl('svg', { class: 'hg-item__glyph', viewBox: '0 0 16 22', 'aria-hidden': 'true', focusable: 'false' });
    const top = 8 * Math.sqrt(1 - p);
    const bot = 8 * Math.sqrt(p);
    if (top > 0.2) {
      svg.appendChild(
        svgEl('path', {
          d: 'M8 10.4 L' + (8 - top * 0.62) + ' ' + (10.4 - top) + ' L' + (8 + top * 0.62) + ' ' + (10.4 - top) + ' Z',
          fill: 'var(--sand)',
          opacity: '0.85'
        })
      );
    }
    if (bot > 0.2) {
      svg.appendChild(
        svgEl('path', {
          d: 'M' + (8 - bot * 0.72) + ' 20.2 L8 ' + (20.2 - bot) + ' L' + (8 + bot * 0.72) + ' 20.2 Z',
          fill: 'var(--sand)',
          opacity: '0.85'
        })
      );
    }
    svg.appendChild(
      svgEl('path', {
        d: 'M2.5 1.2h11M2.5 20.8h11M3.4 1.2C3.4 6.6 7.2 8.6 7.2 11S3.4 15.4 3.4 20.8M12.6 1.2C12.6 6.6 8.8 8.6 8.8 11s3.8 4.4 3.8 9.8',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1',
        'stroke-linecap': 'round',
        opacity: '0.7'
      })
    );
    return svg;
  }

  function metaText(hg, now) {
    const s = T.computeState(hg, now);
    if (s.status === 'pending') return 'começa em ' + F.formatDateShort(hg.start);
    if (s.status === 'finished') return 'terminou em ' + F.formatDateShort(hg.end);
    return 'até ' + F.formatDateShort(hg.end);
  }

  function item(hg, currentId, now) {
    const current = hg.id === currentId;
    const btn = el(
      'button',
      {
        class: 'hg-item',
        attrs: { type: 'button', 'aria-current': current ? 'true' : 'false' },
        on: {
          click: () => {
            A.dialogs.close(menu);
            A.app.select(hg.id, 0);
          }
        }
      },
      [
        glyph(T.computeState(hg, now).progress),
        el('span', { class: 'hg-item__text' }, [
          el('span', { class: 'hg-item__name', text: hg.name }),
          el('span', { class: 'hg-item__meta', text: metaText(hg, now) })
        ]),
        el('span', { class: 'hg-item__dot', attrs: { 'aria-hidden': 'true' } })
      ]
    );
    return el('li', null, [btn]);
  }

  function renderMenu() {
    const now = T.now();
    const cur = A.app.current();
    const currentId = cur ? cur.id : null;
    const active = A.store.active();
    const archived = A.store.archived();
    clear(E['menu-list']);
    active.forEach((hg) => E['menu-list'].appendChild(item(hg, currentId, now)));
    E['menu-empty'].hidden = active.length > 0;
    clear(E['menu-archived']);
    archived.forEach((hg) => E['menu-archived'].appendChild(item(hg, currentId, now)));
    E['menu-archived-wrap'].hidden = archived.length === 0;
    E['menu-archived-count'].textContent = archived.length ? '(' + archived.length + ')' : '';
    if (cur && cur.archived) E['menu-archived-wrap'].open = true;
  }

  function openMenu() {
    renderMenu();
    A.dialogs.open(menu, { initialFocus: qs('[data-close]', menu) });
  }

  /* ------------------------------------------------------------------ */
  /* Detalhes                                                             */
  /* ------------------------------------------------------------------ */

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function renderInfo() {
    const hg = A.app.current();
    if (!hg) return;
    const now = T.now();
    const s = T.computeState(hg, now);
    const model = A.grains.createModel(hg);
    const g = A.grains.describe(model, now);
    const withSec = F.needsSeconds(hg);
    const rate = 1000 / s.duration;

    setText(E['info-title'], hg.name);
    let status = s.status === 'pending' ? 'Ainda não começou' : s.status === 'finished' ? 'Concluída' : 'Em curso';
    if (hg.archived) status += ' · Arquivada';
    setText(E['info-status'], status);
    E['info-bar'].style.width = (s.progress * 100).toFixed(4) + '%';

    setText(E['info-grain'], 'Cada grão representa aproximadamente ' + F.formatDurationCompact(model.grainMs) + '.');
    setText(E['info-start'], F.formatDateTime(hg.start, withSec));
    setText(E['info-end'], F.formatDateTime(hg.end, withSec));
    setText(E['info-duration'], F.formatSpan(hg.start, hg.end, 3));
    setText(E['info-elapsed'], s.status === 'pending' ? '—' : F.formatSpan(hg.start, Math.min(now, hg.end), 3));
    setText(E['info-remaining'], s.status === 'finished' ? '—' : F.formatSpan(Math.max(now, hg.start), hg.end, 3));
    setText(E['info-pct'], F.formatPercent(s.progress, { ratePerSecond: rate }));
    setText(E['info-pct-rest'], F.formatPercent(s.remainingFraction, { ratePerSecond: rate }));
    setText(E['info-grains'], F.formatInteger(g.count));
    setText(E['info-fallen'], F.formatInteger(g.fallen));
    setText(E['info-left'], F.formatInteger(g.remaining));
    setText(E['info-grain-value'], '≈ ' + F.formatDurationCompact(model.grainMs));

    let next;
    if (s.status === 'finished') next = '— (todos caíram)';
    else if (model.grainMs < 1000) next = 'contínuo';
    else if (s.status === 'pending') next = 'em ' + F.formatSpan(now, now + g.nextIn, 2);
    else next = g.nextIn < 1000 ? 'agora' : 'em ≈ ' + F.formatDurationCompact(g.nextIn);
    setText(E['info-next'], next);

    const tz = T.timeZoneLabel(now);
    setText(E['info-tz'], tz ? 'Datas e horas no fuso local — ' + tz + '.' : '');

    const btn = E['act-archive'];
    const label = btn.querySelector('span');
    const use = btn.querySelector('use');
    setText(label, hg.archived ? 'Desarquivar' : 'Arquivar');
    use.setAttribute('href', hg.archived ? '#i-unarchive' : '#i-archive');
  }

  function scheduleInfoTick() {
    clearTimeout(infoTimer);
    if (!info.open || document.hidden) return;
    // Alinha as atualizações às viradas de segundo.
    const delay = 1000 - (Date.now() % 1000) + 5;
    infoTimer = setTimeout(() => {
      renderInfo();
      scheduleInfoTick();
    }, delay);
  }

  function openInfo() {
    if (!A.app.current()) return;
    renderInfo();
    A.dialogs.open(info, {
      initialFocus: qs('[data-close]', info),
      onClose: () => clearTimeout(infoTimer)
    });
    scheduleInfoTick();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && info && info.open) {
      renderInfo();
      scheduleInfoTick();
    }
  });

  function refresh() {
    if (menu && menu.open) renderMenu();
    if (info && info.open) {
      if (A.app.current()) renderInfo();
      else A.dialogs.close(info);
    }
  }

  A.panels = { init, openMenu, openInfo, renderMenu, renderInfo, refresh, menu: () => menu, info: () => info };
})(typeof globalThis !== 'undefined' ? globalThis : window);
