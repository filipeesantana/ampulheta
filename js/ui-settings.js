/*
 * Ampulheta — ui-settings.js
 * Configurações, ajuda e o fluxo de importação.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { qs } = A.utils;
  const F = A.format;

  let settingsDialog;
  let helpDialog;
  let importDialog;
  let pendingImport = null;
  const E = {};

  function init() {
    settingsDialog = qs('#settings-dialog');
    helpDialog = qs('#help-dialog');
    importDialog = qs('#import-dialog');
    [
      's-sound', 's-fullscreen', 's-motion', 's-motion-note', 's-label', 's-storage',
      'import-file', 'import-drop', 'import-file-label', 'import-summary', 'import-summary-text',
      'import-error', 'import-confirm', 'help-version'
    ].forEach((id) => (E[id] = qs('#' + id)));

    const S = A.storage.settings;
    E['s-sound'].addEventListener('change', (ev) => {
      S.set('sound', ev.target.checked);
      A.sound.setEnabled(ev.target.checked);
      if (ev.target.checked && !A.sound.available()) A.dialogs.toast('Este navegador não oferece áudio sintetizado.');
    });
    E['s-fullscreen'].addEventListener('change', (ev) => S.set('contemplationFullscreen', ev.target.checked));
    E['s-motion'].addEventListener('change', (ev) => S.set('reduceMotion', ev.target.checked));
    E['s-label'].addEventListener('change', (ev) => S.set('showLabel', ev.target.checked));

    qs('#s-export').addEventListener('click', () => A.app.exportData());
    qs('#s-import').addEventListener('click', () => openImport());
    qs('#s-clear').addEventListener('click', clearAll);

    // Importação
    E['import-file'].addEventListener('change', () => {
      const file = E['import-file'].files && E['import-file'].files[0];
      if (file) analyze(file);
    });
    const drop = E['import-drop'];
    ['dragenter', 'dragover'].forEach((type) =>
      drop.addEventListener(type, (ev) => {
        ev.preventDefault();
        drop.classList.add('is-dragging');
      })
    );
    ['dragleave', 'dragend', 'drop'].forEach((type) =>
      drop.addEventListener(type, () => drop.classList.remove('is-dragging'))
    );
    drop.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) analyze(file);
    });
    E['import-confirm'].addEventListener('click', confirmImport);

    E['help-version'].textContent = 'versão ' + A.VERSION;
  }

  /* ------------------------------------------------------------------ */
  /* Configurações                                                        */
  /* ------------------------------------------------------------------ */

  async function describeStorage() {
    const adapter = A.storage.getAdapter();
    const kind = adapter ? adapter.kind : 'memory';
    const count = A.store.all().length;
    const noun = count === 1 ? '1 ampulheta' : F.formatInteger(count) + ' ampulhetas';
    let text;
    if (kind === 'indexeddb') text = noun + ' guardadas neste navegador.';
    else if (kind === 'localstorage') text = noun + ' guardadas neste navegador (modo alternativo de armazenamento).';
    else text = 'Armazenamento indisponível: as ampulhetas desta sessão não serão guardadas. Exporte antes de sair.';
    if (count === 1) text = text.replace('guardadas', 'guardada');
    const persist = await A.storage.persistenceStatus();
    if (kind !== 'memory') {
      if (persist === 'persistent') text += ' O navegador foi instruído a não apagá-las por falta de espaço.';
      else text += ' Exporte um backup de vez em quando.';
    }
    E['s-storage'].textContent = text;
  }

  function openSettings() {
    const s = A.storage.settings.all();
    E['s-sound'].checked = s.sound;
    E['s-sound'].disabled = !A.sound.available();
    E['s-fullscreen'].checked = s.contemplationFullscreen;
    E['s-label'].checked = s.showLabel;
    const system = A.utils.systemPrefersReducedMotion();
    E['s-motion'].checked = s.reduceMotion || system;
    E['s-motion'].disabled = system;
    E['s-motion-note'].textContent = system
      ? 'Seu sistema já pede movimento reduzido. A areia continua exata.'
      : 'Os grãos deixam de cair e a ampulheta não gira ao reiniciar. A areia continua exata.';
    describeStorage();
    A.dialogs.open(settingsDialog, { initialFocus: qs('[data-close]', settingsDialog) });
  }

  async function clearAll() {
    const count = A.store.all().length;
    if (!count) {
      A.dialogs.toast('Não há ampulhetas para apagar.');
      return;
    }
    const ok = await A.dialogs.confirm({
      title: 'Apagar todas as ampulhetas?',
      text:
        (count === 1 ? 'A ampulheta' : 'As ' + F.formatInteger(count) + ' ampulhetas') +
        ' deste navegador, inclusive as arquivadas, serão apagadas. Se quiser guardá-las, exporte um backup antes.',
      confirmLabel: 'Apagar tudo',
      danger: true
    });
    if (!ok) return;
    await A.store.clearAll();
    A.dialogs.close(settingsDialog);
    A.dialogs.toast('Todas as ampulhetas foram apagadas.');
  }

  /* ------------------------------------------------------------------ */
  /* Ajuda                                                                */
  /* ------------------------------------------------------------------ */

  function openHelp() {
    A.dialogs.open(helpDialog);
  }

  /* ------------------------------------------------------------------ */
  /* Importação                                                           */
  /* ------------------------------------------------------------------ */

  function resetImport() {
    pendingImport = null;
    E['import-file'].value = '';
    E['import-file-label'].textContent = 'Escolher arquivo';
    E['import-summary'].hidden = true;
    E['import-error'].textContent = '';
    E['import-confirm'].disabled = true;
    const merge = qs('input[name="importMode"][value="merge"]', importDialog);
    if (merge) merge.checked = true;
  }

  function openImport() {
    resetImport();
    A.dialogs.open(importDialog, { initialFocus: E['import-file'] });
  }

  async function analyze(file) {
    E['import-error'].textContent = '';
    E['import-summary'].hidden = true;
    E['import-confirm'].disabled = true;
    E['import-file-label'].textContent = file.name;
    const parsed = await A.backup.readFile(file);
    if (!parsed.ok) {
      pendingImport = null;
      E['import-error'].textContent = A.backup.errorMessage(parsed.error);
      return;
    }
    const { stats } = parsed;
    if (!parsed.records.length) {
      pendingImport = null;
      E['import-error'].textContent =
        stats.total === 0
          ? 'O arquivo é um backup válido, mas não contém ampulhetas.'
          : 'Nenhum registro do arquivo pôde ser lido: todos estão incompletos ou corrompidos.';
      return;
    }
    pendingImport = parsed;
    const n = parsed.records.length;
    let text = n === 1 ? '1 ampulheta pronta para importar' : F.formatInteger(n) + ' ampulhetas prontas para importar';
    if (parsed.exportedAt) text += ', exportadas em ' + F.formatDateTime(parsed.exportedAt);
    text += '.';
    const notes = [];
    if (stats.invalid) notes.push(stats.invalid === 1 ? '1 registro corrompido' : stats.invalid + ' registros corrompidos');
    if (stats.duplicates) notes.push(stats.duplicates === 1 ? '1 repetido' : stats.duplicates + ' repetidos');
    if (notes.length) text += ' Serão ignorados: ' + F.joinList(notes) + '.';
    E['import-summary-text'].textContent = text;
    E['import-summary'].hidden = false;
    E['import-confirm'].disabled = false;
  }

  async function confirmImport() {
    if (!pendingImport) return;
    const modeInput = qs('input[name="importMode"]:checked', importDialog);
    const mode = modeInput ? modeInput.value : 'merge';
    if (mode === 'replace' && A.store.all().length) {
      const ok = await A.dialogs.confirm({
        title: 'Substituir tudo?',
        text:
          'As ' + F.formatInteger(A.store.all().length) + ' ampulhetas atuais serão apagadas e trocadas pelas ' +
          F.formatInteger(pendingImport.records.length) + ' do arquivo.',
        confirmLabel: 'Substituir',
        danger: true
      });
      if (!ok) return;
    }
    E['import-confirm'].disabled = true;
    E['import-confirm'].classList.add('is-loading');
    try {
      await A.stage.settle();
      const result = await A.backup.applyImport(pendingImport, mode);
      A.dialogs.close(importDialog);
      A.dialogs.close(settingsDialog);
      let msg;
      if (mode === 'replace') msg = 'Backup importado: ' + F.formatInteger(result.added) + (result.added === 1 ? ' ampulheta.' : ' ampulhetas.');
      else {
        const parts = [];
        if (result.added) parts.push(result.added === 1 ? '1 nova' : result.added + ' novas');
        if (result.copies) parts.push(result.copies === 1 ? '1 como cópia' : result.copies + ' como cópias');
        if (result.unchanged) parts.push(result.unchanged === 1 ? '1 já existia' : result.unchanged + ' já existiam');
        msg = parts.length ? 'Backup importado: ' + F.joinList(parts) + '.' : 'Nada a importar.';
      }
      A.dialogs.toast(msg, { duration: 3600 });
      A.app.afterImport();
    } catch (err) {
      console.error(err);
      E['import-error'].textContent = 'Não foi possível gravar os dados importados.';
      E['import-confirm'].disabled = false;
    } finally {
      E['import-confirm'].classList.remove('is-loading');
    }
  }

  A.settingsUI = { init, openSettings, openHelp, openImport };
})(typeof globalThis !== 'undefined' ? globalThis : window);
