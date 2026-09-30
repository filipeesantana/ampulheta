/*
 * Ampulheta — import-export.js
 * Backup em JSON versionado.
 *
 * Formato (versão 2):
 * {
 *   "format": "hourglass-backup",
 *   "version": 2,
 *   "exportedAt": "2026-09-30T12:00:00.000Z",
 *   "preferences": { "sound": false, ... },
 *   "hourglasses": [
 *     { "id", "name", "start", "end", "mode", "duration", "tone", "archived", "order", "createdAt", "updatedAt" }
 *   ]
 * }
 * A versão 1 (sem "mode" e "duration") continua sendo aceita: a duração é
 * derivada de término − início durante a importação.
 * Instantes são ISO 8601 em UTC: o arquivo é inequívoco em qualquer fuso.
 * O conteúdo importado nunca é executado nem inserido como HTML.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const M = A.model;

  const FORMAT = 'hourglass-backup';
  const VERSION = 2;
  const MIN_VERSION = 1;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_RECORDS = 10000;

  function buildBackup() {
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date(A.time.now()).toISOString(),
      preferences: A.storage.settings.all(),
      hourglasses: A.store.all().map(M.toBackup)
    };
  }

  function backupFileName(at) {
    const d = new Date(at || A.time.now());
    const pad = (n) => String(n).padStart(2, '0');
    return 'ampulheta-backup-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
  }

  function exportAll() {
    const data = buildBackup();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    A.utils.downloadBlob(blob, backupFileName());
    return data.hourglasses.length;
  }

  /**
   * Analisa o texto de um backup sem alterar nada.
   * Retorna { ok: true, records, preferences, stats, exportedAt } ou { ok: false, error }.
   */
  function parseBackup(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: 'json' };
    }
    if (!M.isPlainObject(data) || data.format !== FORMAT) return { ok: false, error: 'format' };
    if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < MIN_VERSION) {
      return { ok: false, error: 'version-invalid' };
    }
    if (data.version > VERSION) return { ok: false, error: 'version-newer', version: data.version };
    if (!Array.isArray(data.hourglasses)) return { ok: false, error: 'format' };
    if (data.hourglasses.length > MAX_RECORDS) return { ok: false, error: 'too-many' };

    const records = [];
    const seen = new Set();
    const stats = { total: data.hourglasses.length, valid: 0, invalid: 0, duplicates: 0 };
    for (const raw of data.hourglasses) {
      const res = M.normalize(raw);
      if (!res.ok) {
        stats.invalid++;
        continue;
      }
      if (seen.has(res.value.id)) {
        stats.duplicates++;
        continue;
      }
      seen.add(res.value.id);
      records.push(res.value);
      stats.valid++;
    }
    records.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);

    const preferences = M.isPlainObject(data.preferences) ? A.storage.settings.sanitize(data.preferences) : null;
    const exportedAt = M.toTimestamp(data.exportedAt);

    return {
      ok: true,
      version: data.version,
      records,
      preferences,
      stats,
      exportedAt: isFinite(exportedAt) ? exportedAt : null
    };
  }

  async function readFile(file) {
    if (!file) return { ok: false, error: 'no-file' };
    if (file.size > MAX_FILE_BYTES) return { ok: false, error: 'too-large' };
    let text;
    try {
      text = typeof file.text === 'function' ? await file.text() : await readAsText(file);
    } catch (e) {
      return { ok: false, error: 'read' };
    }
    return parseBackup(text);
  }

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  /** Aplica uma importação já validada. mode: 'merge' | 'replace'. */
  async function applyImport(parsed, mode) {
    if (mode === 'replace') {
      await A.store.replaceAll(parsed.records);
      if (parsed.preferences) A.storage.settings.replace(parsed.preferences);
      return { mode, added: parsed.records.length, unchanged: 0, copies: 0 };
    }
    const stats = await A.store.merge(parsed.records);
    return Object.assign({ mode }, stats);
  }

  const ERROR_MESSAGES = {
    json: 'O arquivo não é um JSON válido.',
    format: 'Este arquivo não é um backup da Ampulheta.',
    'version-invalid': 'A versão do backup é inválida.',
    'version-newer': 'Este backup foi criado por uma versão mais nova da Ampulheta.',
    'too-many': 'O arquivo contém registros demais para ser importado.',
    'too-large': 'O arquivo é grande demais (máximo de 10 MB).',
    read: 'Não foi possível ler o arquivo.',
    'no-file': 'Nenhum arquivo selecionado.'
  };

  function errorMessage(code) {
    return ERROR_MESSAGES[code] || 'Não foi possível importar este arquivo.';
  }

  A.backup = {
    FORMAT,
    VERSION,
    buildBackup,
    backupFileName,
    exportAll,
    parseBackup,
    readFile,
    applyImport,
    errorMessage
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
