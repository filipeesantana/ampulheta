/*
 * Ampulheta — ui-panels.js
 * Menu lateral, seletor rápido de ampulhetas, menu de ações e painel de
 * informações. Todo texto vindo dos dados entra via textContent.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { el, qs, qsa, clear, icon } = A.utils;
  const T = A.time;
  const F = A.format;

  /** Marcas diacríticas (para buscar "sao" e achar "São"). */
  const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

  let menu;
  let info;
  let picker;
  let actions;
  let infoTimer = 0;
  const E = {};

  function init() {
    menu = qs('#menu-panel');
    info = qs('#info-panel');
    picker = qs('#picker');
    actions = qs('#actions-menu');
    [
      'menu-list', 'menu-empty', 'menu-archived', 'menu-archived-wrap', 'menu-archived-count',
      'picker-list', 'picker-empty', 'picker-search', 'picker-search-wrap', 'actions-name',
      'info-title', 'info-status', 'info-bar', 'info-grain', 'info-start', 'info-end', 'info-duration',
      'info-elapsed', 'info-remaining', 'info-pct', 'info-pct-rest', 'info-grains', 'info-fallen',
      'info-left', 'info-next', 'info-tz', 'info-restart', 'btn-actions'
    ].forEach((id) => (E[id] = qs('#' + id)));

    // Menu
    qs('#menu-new').addEventListener('click', () => {
      A.dialogs.close(menu);
      A.form.openCreate();
    });
    qs('#menu-export').addEventListener('click', () => A.app.exportData());
    qs('#menu-import').addEventListener('click', () => A.settingsUI.openImport());
    qs('#menu-settings').addEventListener('click', () => A.settingsUI.openSettings());
    qs('#menu-help').addEventListener('click', () => A.settingsUI.openHelp());

    // Seletor rápido
    qs('#picker-new').addEventListener('click', () => {
      A.dialogs.close(picker);
      A.form.openCreate();
    });
    E['picker-search'].addEventListener('input', renderPicker);
    E['picker-search'].addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        const first = qs('.hg-item', E['picker-list']);
        if (first) first.focus();
      } else if (ev.key === 'Enter') {
        const first = qs('.hg-item', E['picker-list']);
        if (first) {
          ev.preventDefault();
          first.click();
        }
      }
    });
    E['picker-list'].addEventListener('keydown', (ev) => listKeys(ev, E['picker-list'], '.hg-item', E['picker-search']));

    // Ações
    actions.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      A.dialogs.close(actions);
      A.app.runAction(action);
    });
    actions.addEventListener('keydown', (ev) => listKeys(ev, actions, '.action-item:not(:disabled)'));

    // Informações
    qs('#info-edit').addEventListener('click', () => A.app.runAction('edit'));
    qs('#info-restart').addEventListener('click', () => A.app.runAction('restart'));
    qs('#info-more').addEventListener('click', (ev) => openActions(ev.currentTarget));
  }

  /** Navegação por setas dentro de listas e menus. */
  function listKeys(ev, container, selector, before) {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Home' && ev.key !== 'End') return;
    const items = qsa(selector, container);
    if (!items.length) return;
    ev.preventDefault();
    const idx = items.indexOf(document.activeElement);
    let next;
    if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = items.length - 1;
    else if (ev.key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(items.length - 1, idx + 1);
    else if (idx <= 0 && before && !before.closest('[hidden]')) {
      before.focus();
      return;
    } else next = Math.max(0, idx - 1);
    items[next].focus();
  }

  /* ------------------------------------------------------------------ */
  /* Itens de lista                                                       */
  /* ------------------------------------------------------------------ */

  function item(hg, currentId, now, onPick, role) {
    const current = hg.id === currentId;
    const attrs = { type: 'button' };
    if (role === 'option') {
      attrs.role = 'option';
      attrs['aria-selected'] = current ? 'true' : 'false';
    } else {
      attrs['aria-current'] = current ? 'true' : 'false';
    }
    const btn = el(
      'button',
      { class: 'hg-item', attrs, on: { click: () => onPick(hg) } },
      [
        el('span', { class: 'hg-item__text' }, [
          el('span', { class: 'hg-item__name', text: hg.name }),
          el('span', { class: 'hg-item__meta', text: F.describeStatus(hg, now).text })
        ]),
        icon('check', 'hg-item__check')
      ]
    );
    return el('li', { attrs: role === 'option' ? { role: 'presentation' } : null }, [btn]);
  }

  /* ------------------------------------------------------------------ */
  /* Menu                                                                 */
  /* ------------------------------------------------------------------ */

  function renderMenu() {
    const now = T.now();
    const cur = A.app.current();
    const currentId = cur ? cur.id : null;
    const active = A.store.active();
    const archived = A.store.archived();
    const pick = (hg) => {
      A.dialogs.close(menu);
      A.app.select(hg.id, 0);
    };
    clear(E['menu-list']);
    active.forEach((hg) => E['menu-list'].appendChild(item(hg, currentId, now, pick)));
    E['menu-empty'].hidden = active.length > 0;
    clear(E['menu-archived']);
    archived.forEach((hg) => E['menu-archived'].appendChild(item(hg, currentId, now, pick)));
    E['menu-archived-wrap'].hidden = archived.length === 0;
    E['menu-archived-count'].textContent = archived.length ? '(' + archived.length + ')' : '';
    if (cur && cur.archived) E['menu-archived-wrap'].open = true;
  }

  function openMenu() {
    renderMenu();
    A.dialogs.open(menu, { initialFocus: qs('[data-close]', menu) });
  }

  /* ------------------------------------------------------------------ */
  /* Seletor rápido                                                       */
  /* ------------------------------------------------------------------ */

  function renderPicker() {
    const now = T.now();
    const cur = A.app.current();
    const currentId = cur ? cur.id : null;
    const all = A.store.active();
    const query = E['picker-search'].value.trim().toLocaleLowerCase('pt-BR');
    const norm = (s) => s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(COMBINING_MARKS, '');
    const list = query ? all.filter((h) => norm(h.name).includes(norm(query))) : all;
    clear(E['picker-list']);
    list.forEach((hg) =>
      E['picker-list'].appendChild(
        item(
          hg,
          currentId,
          now,
          (h) => {
            A.dialogs.close(picker);
            A.app.select(h.id, 0);
          },
          'option'
        )
      )
    );
    E['picker-empty'].hidden = list.length > 0;
    E['picker-empty'].textContent = all.length ? 'Nenhuma ampulheta encontrada.' : 'Nenhuma ampulheta ainda.';
  }

  function openPicker(anchor) {
    const count = A.store.active().length;
    E['picker-search'].value = '';
    E['picker-search-wrap'].hidden = count <= 6;
    renderPicker();
    const current = qs('.hg-item[aria-selected="true"]', E['picker-list']);
    A.dialogs.open(picker, {
      anchor: anchor || qs('#btn-picker'),
      placement: 'above',
      initialFocus: count > 6 ? E['picker-search'] : current || qs('.hg-item', E['picker-list']) || qs('#picker-new')
    });
    if (current) current.scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------------------------------------------ */
  /* Ações                                                                */
  /* ------------------------------------------------------------------ */

  function openActions(anchor) {
    const hg = A.app.current();
    if (!hg) return;
    const btnAnchor = anchor || E['btn-actions'];
    E['actions-name'].textContent = hg.name;
    const archiveBtn = qs('[data-action="archive"]', actions);
    archiveBtn.querySelector('span').textContent = hg.archived ? 'Desarquivar' : 'Arquivar';
    archiveBtn.querySelector('use').setAttribute('href', hg.archived ? '#i-unarchive' : '#i-archive');
    E['btn-actions'].setAttribute('aria-expanded', 'true');
    A.dialogs.open(actions, {
      anchor: btnAnchor,
      placement: btnAnchor === E['btn-actions'] ? 'below-end' : 'above',
      initialFocus: qs('.action-item', actions),
      onClose: () => E['btn-actions'].setAttribute('aria-expanded', 'false')
    });
  }

  /* ------------------------------------------------------------------ */
  /* Informações                                                          */
  /* ------------------------------------------------------------------ */

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  let lastBar = -1;

  function renderInfo() {
    const hg = A.app.current();
    if (!hg) return;
    const now = T.now();
    const s = T.computeState(hg, now);
    const model = A.grains.createModel(hg);
    const g = A.grains.describe(model, now);
    const withSec = F.needsSeconds(hg);

    setText(E['info-title'], hg.name);
    let status = s.status === 'pending' ? 'Ainda não começou' : s.status === 'finished' ? 'Terminou' : 'Em andamento';
    if (hg.archived) status += ' · Arquivada';
    setText(E['info-status'], status);

    setText(E['info-pct'], F.formatPercentHuman(s.progress));
    setText(E['info-pct-rest'], F.formatPercentHuman(s.remainingFraction));
    const bar = Math.round(s.progress * 10000) / 10000;
    if (bar !== lastBar) {
      E['info-bar'].style.transform = 'scaleX(' + bar + ')';
      lastBar = bar;
    }

    setText(E['info-elapsed'], s.status === 'pending' ? '—' : F.formatSpan(hg.start, Math.min(now, hg.end), 3));
    setText(E['info-remaining'], s.status === 'finished' ? '—' : F.formatSpan(Math.max(now, hg.start), hg.end, 3));
    setText(E['info-duration'], F.formatDurationParts(hg.duration, 3));
    setText(E['info-start'], F.formatDateTime(hg.start, withSec));
    setText(E['info-end'], F.formatDateTime(hg.end, withSec));
    const tz = T.timeZoneLabel(now);
    setText(E['info-tz'], tz ? 'No fuso horário local — ' + tz + '.' : '');

    setText(E['info-grain'], 'Cada grão representa cerca de ' + F.formatDurationCompact(model.grainMs) + '.');
    setText(E['info-grains'], F.formatInteger(g.count));
    setText(E['info-fallen'], F.formatInteger(g.fallen));
    setText(E['info-left'], F.formatInteger(g.remaining));
    let next;
    if (s.status === 'finished') next = '—';
    else if (model.grainMs < 1000) next = 'contínuo';
    else if (s.status === 'pending') next = 'em ' + F.formatSpan(now, now + g.nextIn, 2);
    else next = g.nextIn < 1000 ? 'agora' : 'em ' + F.formatDurationCompact(g.nextIn);
    setText(E['info-next'], next);
  }

  function scheduleInfoTick() {
    clearTimeout(infoTimer);
    infoTimer = 0;
    if (!info.open || document.hidden) return;
    // Alinha as atualizações às viradas de segundo.
    const delay = 1000 - (Date.now() % 1000) + 5;
    infoTimer = setTimeout(() => {
      infoTimer = 0;
      renderInfo();
      scheduleInfoTick();
    }, delay);
  }

  function openInfo() {
    if (!A.app.current()) return;
    lastBar = -1;
    renderInfo();
    A.dialogs.open(info, {
      initialFocus: qs('[data-close]', info),
      onClose: () => {
        clearTimeout(infoTimer);
        infoTimer = 0;
      }
    });
    scheduleInfoTick();
  }

  document.addEventListener('visibilitychange', () => {
    if (!info) return;
    if (document.hidden) {
      clearTimeout(infoTimer);
      infoTimer = 0;
    } else if (info.open) {
      renderInfo();
      scheduleInfoTick();
    }
  });

  function refresh() {
    if (menu && menu.open) renderMenu();
    if (picker && picker.open) renderPicker();
    if (info && info.open) {
      if (A.app.current()) renderInfo();
      else A.dialogs.close(info);
    }
    if (actions && actions.open && !A.app.current()) A.dialogs.close(actions);
  }

  function closeAll() {
    [menu, picker, actions, info].forEach((d) => d && d.open && A.dialogs.close(d));
  }

  A.panels = { init, openMenu, openInfo, openPicker, openActions, refresh, closeAll };
})(typeof globalThis !== 'undefined' ? globalThis : window);
