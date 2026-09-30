/*
 * Ampulheta — model.js
 * Esquema de uma ampulheta, criação e validação/saneamento de registros.
 * Usado tanto ao carregar do armazenamento quanto ao importar backups:
 * todo dado externo é tratado apenas como dado, validado campo a campo.
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

    return {
      ok: true,
      idRegenerated,
      value: {
        id,
        name,
        start,
        end,
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
      id: A.utils.uuid(),
      name: cleanName(data.name),
      start: data.start,
      end: data.end,
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
      tone: hg.tone,
      archived: hg.archived,
      order: hg.order,
      createdAt: toIso(hg.createdAt),
      updatedAt: toIso(hg.updatedAt)
    };
  }

  A.model = {
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
