/*
 * Ampulheta — ui-dialogs.js
 * Abertura/fechamento animados de <dialog>, confirmação própria e avisos.
 * Nada de alert()/confirm() do navegador.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { el, qs } = A.utils;

  const CLOSE_MS = 440;
  const state = new WeakMap();
  const openStack = [];

  function reducedMotion() {
    return document.body.classList.contains('reduce-motion');
  }

  function wire(dialog) {
    if (dialog.dataset.wired) return;
    dialog.dataset.wired = '1';
    // ESC: anima o fechamento em vez de fechar abruptamente.
    dialog.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      const s = state.get(dialog);
      if (s && s.dismissable === false) return;
      close(dialog);
    });
    // Clique fora (no backdrop): o alvo é o próprio <dialog>.
    let downOnBackdrop = false;
    dialog.addEventListener('pointerdown', (ev) => {
      downOnBackdrop = ev.target === dialog;
    });
    dialog.addEventListener('click', (ev) => {
      const s = state.get(dialog);
      if (ev.target === dialog && downOnBackdrop && (!s || s.backdropClose !== false)) close(dialog);
      downOnBackdrop = false;
    });
    // Qualquer fechamento real (inclusive ESC repetido, que o navegador pode forçar).
    dialog.addEventListener('close', () => finalize(dialog));
    dialog.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => close(dialog));
    });
  }

  function open(dialog, options) {
    const opts = options || {};
    wire(dialog);
    const prev = state.get(dialog);
    if (prev && prev.closingTimer) {
      clearTimeout(prev.closingTimer);
    }
    state.set(dialog, {
      onClose: opts.onClose || null,
      returnFocus: opts.returnFocus || document.activeElement,
      backdropClose: opts.backdropClose !== false,
      dismissable: opts.dismissable !== false,
      closingTimer: 0,
      finalized: false
    });
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch (e) {
        dialog.setAttribute('open', '');
      }
    }
    if (!openStack.includes(dialog)) openStack.push(dialog);
    document.body.classList.add('dialog-open');
    // Força o estado inicial antes de animar.
    void dialog.offsetWidth;
    requestAnimationFrame(() => dialog.classList.add('is-open'));
    const focusTarget = opts.initialFocus || dialog.querySelector('[autofocus]');
    if (focusTarget) {
      setTimeout(() => {
        try {
          focusTarget.focus({ preventScroll: true });
        } catch (e) {
          focusTarget.focus();
        }
      }, 30);
    }
    if (A.stage && A.stage.onDialogChange) A.stage.onDialogChange(true);
  }

  /** Limpeza comum a qualquer fechamento (inclusive o forçado pelo navegador). */
  function finalize(dialog) {
    const s = state.get(dialog) || {};
    if (s.finalized) return;
    s.finalized = true;
    if (s.closingTimer) clearTimeout(s.closingTimer);
    s.closingTimer = 0;
    dialog.classList.remove('is-open');
    const idx = openStack.indexOf(dialog);
    if (idx !== -1) openStack.splice(idx, 1);
    if (!openStack.length) document.body.classList.remove('dialog-open');
    const target = s.returnFocus;
    if (target && document.contains(target) && typeof target.focus === 'function') {
      try {
        target.focus({ preventScroll: true });
      } catch (e) {
        /* ignora */
      }
    }
    if (typeof s.onClose === 'function') s.onClose();
    if (!openStack.length && A.stage && A.stage.onDialogChange) A.stage.onDialogChange(false);
  }

  function close(dialog) {
    if (!dialog.open) return;
    const s = state.get(dialog) || {};
    if (s.closingTimer) return;
    dialog.classList.remove('is-open');
    s.closingTimer = setTimeout(() => {
      s.closingTimer = 0;
      try {
        dialog.close();
      } catch (e) {
        dialog.removeAttribute('open');
        finalize(dialog);
      }
    }, reducedMotion() ? 10 : CLOSE_MS);
    state.set(dialog, s);
  }

  function isOpen(dialog) {
    return dialog.open && dialog.classList.contains('is-open');
  }

  function anyOpen() {
    return openStack.length > 0;
  }

  /* ------------------------------------------------------------------ */
  /* Confirmação                                                          */
  /* ------------------------------------------------------------------ */

  function confirmAction(options) {
    const dialog = qs('#confirm-dialog');
    const title = qs('#confirm-title');
    const text = qs('#confirm-text');
    const ok = qs('#confirm-ok');
    const cancel = qs('#confirm-cancel');
    title.textContent = options.title || 'Confirmar';
    text.textContent = options.text || '';
    ok.textContent = options.confirmLabel || 'Confirmar';
    ok.className = 'btn ' + (options.danger ? 'btn--danger-solid' : 'btn--primary');
    cancel.textContent = options.cancelLabel || 'Cancelar';

    return new Promise((resolve) => {
      let result = false;
      const onOk = () => {
        result = true;
        close(dialog);
      };
      const onCancel = () => close(dialog);
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      open(dialog, {
        initialFocus: cancel,
        onClose: () => {
          ok.removeEventListener('click', onOk);
          cancel.removeEventListener('click', onCancel);
          resolve(result);
        }
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Avisos                                                               */
  /* ------------------------------------------------------------------ */

  function toast(message, options) {
    const opts = options || {};
    const region = qs('#toasts');
    if (!region) return;
    // Com a Popover API, o aviso fica acima de qualquer diálogo aberto.
    if (typeof region.showPopover === 'function') {
      if (!region.hasAttribute('popover')) region.setAttribute('popover', 'manual');
      try {
        if (region.matches(':popover-open')) region.hidePopover();
        region.showPopover();
      } catch (e) {
        /* sem suporte completo */
      }
    }
    while (region.children.length >= 3) region.firstChild.remove();
    const node = el('div', { class: 'toast' + (opts.tone === 'error' ? ' toast--error' : '') }, [
      opts.tone === 'error' ? null : el('span', { class: 'toast__mark', attrs: { 'aria-hidden': 'true' } }),
      String(message)
    ]);
    region.appendChild(node);
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('is-visible')));
    const duration = opts.duration || (opts.tone === 'error' ? 4200 : 2600);
    setTimeout(() => {
      node.classList.remove('is-visible');
      setTimeout(() => {
        node.remove();
        if (!region.children.length && typeof region.hidePopover === 'function') {
          try {
            if (region.matches(':popover-open')) region.hidePopover();
          } catch (e) {
            /* ignora */
          }
        }
      }, 520);
    }, duration);
  }

  A.dialogs = { open, close, isOpen, anyOpen, confirm: confirmAction, toast };
})(typeof globalThis !== 'undefined' ? globalThis : window);
