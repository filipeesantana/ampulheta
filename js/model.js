/*
 * Ampulheta — model.js
 * Esquema de uma ampulheta, criação, migração e validação de registros.
 * Usado ao carregar do armazenamento e ao importar backups: todo dado
 * externo é tratado apenas como dado, validado campo a campo.
 *
 * Esquema atual (schemaVersion 2):
 * {
 *   schemaVersion: 2,
 *   id, name, tone, archived, order, createdAt, updatedAt,
 *   start, end,          // instantes absolutos (epoch ms, UTC) — a verdade temporal
 *   mode,                // 'duration' | 'dates' — como o intervalo foi definido
 *   duration             // { years, months, days, hours, minutes, seconds }
 * }
 * `duration` é a intenção temporal canônica: é ela que o "Reiniciar" usa
 * (início = agora, término = agora + duração), inclusive para meses e anos.
 *
 * Versão 1 (sem schemaVersion, mode e duration) é migrada automaticamente:
 * a duração é derivada de término − início (diferença de calendário).
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const T = A.time;

  const NAME_MAX = 80;
  /** Caracteres de controle e invisíveis (inclui marcas de direção de texto). */
  const INVISIBLE_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u206F\\uFEFF]', 'g');
  const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
  const ISO_PATTERN = /^[+-]?\d{4,6}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

  const TONES = [
    { id: 'areia', label: 'Areia' },
    { id: 'marfim', label: 'Marfim' },
    { id: 'cinza', label: 'Cinza' },
    { id: 'ferrugem', label: 'Ferrugem' }
  ];
  const TONE_IDS = TONES.map((t) => t.id);
  const DEFAULT_TONE = 'areia';

  const SCHEMA_VERSION = 2;
  const MODES = ['duration', 'dates'];
  const DURATION_KEYS = ['years', 'months', 'days', 'hours', 'minutes', 'seconds'];
  /** Limites generosos por unidade (tudo acima disso ultrapassa o ano 9999 de qualquer forma). */
  const DURATION_MAX = { years: 9999, months: 120000, days: 3660000, hours: 87840000, minutes: 5270400000, seconds: 316224000000 };

  /** Valida uma duração de calendário. Retorna o objeto limpo ou null. */
  function cleanDuration(raw) {
    if (!isPlainObject(raw)) return null;
    const out = {};
    let total = 0;
    for (const key of DURATION_KEYS) {
      const v = raw[key] == null ? 0 : raw[key];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > DURATION_MAX[key]) return null;
      out[key] = v;
      total += v;
    }
    return total > 0 ? out : null;
  }

  /** Duração canônica derivada de dois instantes (usada na migração e no modo datas). */
  function deriveDuration(start, end) {
    const d = T.diffCalendar(start, end);
    const out = {};
    for (const key of DURATION_KEYS) out[key] = d[key] || 0;
    if (d.milliseconds >= 500) out.seconds += 1;
    if (DURATION_KEYS.every((k) => out[k] === 0)) out.seconds = 1;
    return out;
  }

  function isEmptyDuration(d) {
    return !d || DURATION_KEYS.every((k) => !d[k]);
  }

  /**
   * Instantes de um reinício: começa agora e dura exatamente a duração canônica.
   * Se, por algum motivo, a soma de calendário for inválida, preserva a duração em ms.
   */
  function restartInterval(hourglass, at) {
    const start = typeof at === 'number' ? at : T.now();
    let end = T.addDuration(start, hourglass.duration || {});
    if (!T.isValidTimestamp(end) || end - start < T.MIN_DURATION) end = start + Math.max(T.MIN_DURATION, hourglass.end - hourglass.start);
    return { start, end };
  }

  /** Remove caracteres de controle, normaliza espaços e limita o tamanho. */
  function cleanName(value) {
    if (typeof value !== 'string') return '';
    const cleaned = value
      .replace(INVISIBLE_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return Array.from(cleaned).slice(0, NAME_MAX).join('').trim();
  }

  /** Aceita epoch (número) ou ISO 8601 com fuso explícito. Nunca interpreta outra coisa. */
  function toTimestamp(value) {
    if (typeof value === 'number') return isFinite(value) ? Math.round(value) : NaN;
    if (typeof value === 'string' && value.length <= 40 && ISO_PATTERN.test(value.trim())) {
      const ms = Date.parse(value.trim());
      return isFinite(ms) ? ms : NaN;
    }
    return NaN;
  }

  function toIso(ms) {
    return new Date(ms).toISOString();
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /**
   * Valida e normaliza um registro. Retorna { ok, value } ou { ok: false, reason }.
   * Campos desconhecidos são descartados.
   */
  function normalize(raw, options) {
    const opts = options || {};
    const now = opts.now || T.now();
    if (!isPlainObject(raw)) return { ok: false, reason: 'not-object' };

    let id = typeof raw.id === 'string' ? raw.id.trim() : '';
    let idRegenerated = false;
    if (!ID_PATTERN.test(id)) {
      id = A.utils.uuid();
      idRegenerated = true;
    }

    const name = cleanName(raw.name);
    if (!name) return { ok: false, reason: 'name' };

    const start = toTimestamp(raw.start);
    const end = toTimestamp(raw.end);
    if (!T.isValidTimestamp(start) || !T.isValidTimestamp(end)) return { ok: false, reason: 'dates' };
    if (end - start < T.MIN_DURATION) return { ok: false, reason: 'duration' };

    let createdAt = toTimestamp(raw.createdAt);
    if (!T.isValidTimestamp(createdAt)) createdAt = now;
    let updatedAt = toTimestamp(raw.updatedAt);
    if (!T.isValidTimestamp(updatedAt)) updatedAt = createdAt;

    const tone = TONE_IDS.includes(raw.tone) ? raw.tone : DEFAULT_TONE;
    const order = typeof raw.order === 'number' && isFinite(raw.order) ? raw.order : 0;

    // Migração: registros sem duração canônica a derivam de término − início.
    let duration = cleanDuration(raw.duration);
    let migrated = raw.schemaVersion !== SCHEMA_VERSION;
    if (!duration) {
      duration = deriveDuration(start, end);
      migrated = true;
    }
    const mode = MODES.includes(raw.mode) ? raw.mode : 'dates';

    return {
      ok: true,
      idRegenerated,
      migrated,
      value: {
        schemaVersion: SCHEMA_VERSION,
        id,
        name,
        start,
        end,
        mode,
        duration,
        tone,
        archived: raw.archived === true,
        order,
        createdAt,
        updatedAt
      }
    };
  }

  function create(data) {
    const now = T.now();
    return {
      schemaVersion: SCHEMA_VERSION,
      id: A.utils.uuid(),
      name: cleanName(data.name),
      start: data.start,
      end: data.end,
      mode: MODES.includes(data.mode) ? data.mode : 'dates',
      duration: cleanDuration(data.duration) || deriveDuration(data.start, data.end),
      tone: TONE_IDS.includes(data.tone) ? data.tone : DEFAULT_TONE,
      archived: false,
      order: typeof data.order === 'number' ? data.order : 0,
      createdAt: now,
      updatedAt: now
    };
  }

  /** Mesmo conteúdo significativo (ignora ordem e carimbos de data). */
  function sameContent(a, b) {
    return a.name === b.name && a.start === b.start && a.end === b.end && a.tone === b.tone && a.archived === b.archived;
  }

  /** Representação para backup: instantes em ISO 8601 UTC (inequívocos). */
  function toBackup(hg) {
    return {
      id: hg.id,
      name: hg.name,
      start: toIso(hg.start),
      end: toIso(hg.end),
      mode: hg.mode,
      duration: Object.assign({}, hg.duration),
      tone: hg.tone,
      archived: hg.archived,
      order: hg.order,
      createdAt: toIso(hg.createdAt),
      updatedAt: toIso(hg.updatedAt)
    };
  }

  A.model = {
    SCHEMA_VERSION,
    DURATION_KEYS,
    cleanDuration,
    deriveDuration,
    isEmptyDuration,
    restartInterval,
    NAME_MAX,
    TONES,
    TONE_IDS,
    DEFAULT_TONE,
    cleanName,
    toTimestamp,
    normalize,
    create,
    sameContent,
    toBackup,
    isPlainObject
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
