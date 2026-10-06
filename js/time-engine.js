/*
 * Ampulheta — time-engine.js
 * Fonte única da verdade temporal.
 *
 * Princípios:
 *  - Toda ampulheta é definida por dois instantes absolutos (epoch em ms, UTC):
 *    `start` e `end`. Nada mais é necessário para reconstruir o seu estado.
 *  - O progresso é sempre recalculado a partir do relógio atual:
 *        progresso = (agora − início) / (término − início)
 *    Timers e requestAnimationFrame servem apenas para redesenhar; nunca acumulam tempo.
 *  - Datas digitadas pelo usuário são interpretadas no fuso local e convertidas
 *    imediatamente para epoch (inequívoco). A exibição volta ao fuso local.
 *  - Aritmética de calendário (anos, meses, dias) respeita o calendário local
 *    (meses de tamanhos diferentes, anos bissextos, horário de verão).
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { clamp } = A.utils;

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  /** Ano gregoriano médio — usado apenas para durações não ancoradas no calendário. */
  const AVG_YEAR = 365.2425 * DAY;
  const AVG_MONTH = AVG_YEAR / 12;

  const MIN_YEAR = 1;
  const MAX_YEAR = 9999;
  const MIN_TIMESTAMP = utcYearStart(MIN_YEAR);
  const MAX_TIMESTAMP = utcYearStart(MAX_YEAR + 1) - 1;
  const MIN_DURATION = SECOND;

  function utcYearStart(year) {
    const d = new Date(0);
    d.setUTCFullYear(year, 0, 1);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** Relógio da aplicação. Isolado para facilitar testes. */
  function now() {
    return Date.now();
  }

  function isValidTimestamp(ms) {
    return typeof ms === 'number' && isFinite(ms) && ms >= MIN_TIMESTAMP && ms <= MAX_TIMESTAMP;
  }

  function daysInMonth(year, monthIndex) {
    const d = new Date(2000, 0, 1);
    d.setFullYear(year, monthIndex + 1, 0);
    return d.getDate();
  }

  /**
   * Cria um instante a partir de componentes locais, validando-os.
   * Usa setFullYear para que anos 0–99 não sejam reinterpretados como 1900–1999.
   * Retorna NaN se a data for impossível (ex.: 31/02).
   */
  function fromLocalParts(year, month, day, hours, minutes, seconds) {
    const y = Number(year);
    const mo = Number(month);
    const d = Number(day);
    const h = Number(hours || 0);
    const mi = Number(minutes || 0);
    const s = Number(seconds || 0);
    if (![y, mo, d, h, mi, s].every(Number.isInteger)) return NaN;
    if (y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12 || d < 1) return NaN;
    if (d > daysInMonth(y, mo - 1)) return NaN;
    if (h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return NaN;
    const date = new Date(2000, 0, 1, 0, 0, 0, 0);
    date.setFullYear(y, mo - 1, d);
    date.setHours(h, mi, s, 0);
    return date.getTime();
  }

  /**
   * Interpreta os valores de <input type="date"> e <input type="time">.
   * Hora vazia significa 00:00 local.
   */
  function parseDateTimeInputs(dateValue, timeValue) {
    const dateStr = String(dateValue || '').trim();
    const timeStr = String(timeValue || '').trim();
    if (!dateStr) return { ok: false, error: 'empty-date' };
    const dm = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!dm) return { ok: false, error: 'invalid-date' };
    let hh = 0;
    let mm = 0;
    let ss = 0;
    if (timeStr) {
      const tm = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(timeStr);
      if (!tm) return { ok: false, error: 'invalid-time' };
      hh = Number(tm[1]);
      mm = Number(tm[2]);
      ss = tm[3] ? Number(tm[3]) : 0;
    }
    const year = Number(dm[1]);
    if (year < MIN_YEAR || year > MAX_YEAR) return { ok: false, error: 'out-of-range' };
    const ms = fromLocalParts(year, Number(dm[2]), Number(dm[3]), hh, mm, ss);
    if (!isFinite(ms)) return { ok: false, error: 'invalid-date' };
    if (!isValidTimestamp(ms)) return { ok: false, error: 'out-of-range' };
    return { ok: true, ms };
  }

  function pad(n, width) {
    return String(n).padStart(width, '0');
  }

  /** 'YYYY-MM-DD' local, adequado para <input type="date">. */
  function toDateInputValue(ms) {
    const d = new Date(ms);
    return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
  }

  /** 'HH:MM' ou 'HH:MM:SS' local, adequado para <input type="time">. */
  function toTimeInputValue(ms, withSeconds) {
    const d = new Date(ms);
    const base = pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
    return withSeconds ? base + ':' + pad(d.getSeconds(), 2) : base;
  }

  /** Início (00:00 local) do dia que contém `ms`. */
  function startOfLocalDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** Soma meses de calendário mantendo a hora local; o dia é limitado ao fim do mês. */
  function addMonths(ms, months) {
    const src = new Date(ms);
    const day = src.getDate();
    const total = src.getMonth() + months;
    const year = src.getFullYear() + Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    const out = new Date(ms);
    out.setDate(1);
    out.setFullYear(year, month, Math.min(day, daysInMonth(year, month)));
    return out.getTime();
  }

  /** Soma dias de calendário (mantém a hora local, mesmo com horário de verão). */
  function addDays(ms, days) {
    const out = new Date(ms);
    out.setDate(out.getDate() + days);
    return out.getTime();
  }

  /**
   * Soma uma duração composta a um instante.
   * Anos e meses seguem o calendário; dias seguem dias locais; horas, minutos
   * e segundos são tempo absoluto.
   */
  function addDuration(ms, parts) {
    const p = parts || {};
    let t = ms;
    const months = (p.years || 0) * 12 + (p.months || 0);
    if (months) t = addMonths(t, months);
    if (p.days) t = addDays(t, p.days);
    t += (p.hours || 0) * HOUR + (p.minutes || 0) * MINUTE + (p.seconds || 0) * SECOND;
    return t;
  }

  /**
   * Diferença de calendário entre dois instantes.
   * Retorna { years, months, days, hours, minutes, seconds, milliseconds, sign }.
   */
  function diffCalendar(a, b) {
    let sign = 1;
    let from = a;
    let to = b;
    if (to < from) {
      from = b;
      to = a;
      sign = -1;
    }
    const df = new Date(from);
    const dt = new Date(to);
    let months = (dt.getFullYear() - df.getFullYear()) * 12 + (dt.getMonth() - df.getMonth());
    let anchor = addMonths(from, months);
    while (months > 0 && anchor > to) {
      months -= 1;
      anchor = addMonths(from, months);
    }
    let days = Math.max(0, Math.floor((to - anchor) / DAY));
    let dayAnchor = addDays(anchor, days);
    while (days > 0 && dayAnchor > to) {
      days -= 1;
      dayAnchor = addDays(anchor, days);
    }
    while (addDays(anchor, days + 1) <= to) {
      days += 1;
      dayAnchor = addDays(anchor, days);
    }
    let rest = Math.max(0, to - dayAnchor);
    const hours = Math.floor(rest / HOUR);
    rest -= hours * HOUR;
    const minutes = Math.floor(rest / MINUTE);
    rest -= minutes * MINUTE;
    const seconds = Math.floor(rest / SECOND);
    rest -= seconds * SECOND;
    return {
      years: Math.floor(months / 12),
      months: months % 12,
      days,
      hours,
      minutes,
      seconds,
      milliseconds: Math.round(rest),
      sign
    };
  }

  /**
   * Estado temporal de uma ampulheta num instante.
   * `progress` e `remainingFraction` são calculados separadamente para
   * preservar a precisão perto de 0% e de 100% em intervalos de décadas.
   */
  function computeState(hourglass, at) {
    const t = typeof at === 'number' ? at : now();
    const start = hourglass.start;
    const end = hourglass.end;
    const duration = Math.max(1, end - start);
    const elapsed = clamp(t - start, 0, duration);
    const remaining = duration - elapsed;
    let status = 'running';
    if (t < start) status = 'pending';
    else if (t >= end) status = 'finished';
    return {
      now: t,
      start,
      end,
      duration,
      elapsed,
      remaining,
      progress: elapsed / duration,
      remainingFraction: remaining / duration,
      status,
      untilStart: Math.max(0, start - t)
    };
  }

  /**
   * Janela (ms) em que um início no futuro próximo é tratado como "começando":
   * um reinício grava o início no instante em que a virada termina.
   */
  const STARTING_WINDOW = 5 * SECOND;

  /** Unidades da contagem regressiva, da maior para a menor. */
  const COUNTDOWN_KEYS = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'];

  function zeroCountdown() {
    return { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0, wholeSeconds: 0 };
  }

  /**
   * Decompõe o tempo entre `from` e `to` em anos, meses, semanas, dias, horas,
   * minutos e segundos, sem contar nada duas vezes.
   *
   * Anos e meses seguem o calendário local (meses de 28 a 31 dias, anos
   * bissextos); semanas e dias são dias locais; o resto é tempo absoluto.
   * Somar as partes de volta (addDuration) reconstrói exatamente o intervalo.
   *
   * Os segundos são arredondados para cima, como em toda contagem regressiva:
   * mostra "10 segundos" no instante inicial e só chega a zero quando o tempo
   * de fato acabou. Nunca devolve valores negativos.
   */
  function decomposeRemaining(from, to) {
    const totalMs = to - from;
    if (!(totalMs > 0)) return zeroCountdown();
    const wholeSeconds = Math.ceil(totalMs / SECOND);
    const anchor = to - wholeSeconds * SECOND;
    const d = diffCalendar(anchor, to);
    return {
      years: d.years,
      months: d.months,
      weeks: Math.floor(d.days / 7),
      days: d.days % 7,
      hours: d.hours,
      minutes: d.minutes,
      seconds: d.seconds,
      totalMs,
      wholeSeconds
    };
  }

  /** Converte as partes da contagem em partes de duração (semanas viram dias). */
  function countdownToDuration(parts) {
    return {
      years: parts.years || 0,
      months: parts.months || 0,
      days: (parts.weeks || 0) * 7 + (parts.days || 0),
      hours: parts.hours || 0,
      minutes: parts.minutes || 0,
      seconds: parts.seconds || 0
    };
  }

  /**
   * Contagem regressiva de uma ampulheta num instante — a única fonte do
   * "tempo restante" na interface.
   *   - em andamento: de agora até o término;
   *   - antes do início: a duração inteira (do início ao término);
   *   - terminada: zero.
   * `nextChangeIn` é quanto falta (ms) para o valor exibido mudar.
   */
  function countdown(hourglass, at) {
    const state = computeState(hourglass, at);
    const from = state.status === 'pending' ? state.start : state.now;
    const parts = state.status === 'finished' ? zeroCountdown() : decomposeRemaining(from, state.end);
    let nextChangeIn = Infinity;
    if (state.status === 'running') {
      const rest = state.end - state.now;
      nextChangeIn = rest % SECOND || SECOND;
    } else if (state.status === 'pending') {
      nextChangeIn = state.untilStart;
    }
    return { status: state.status, remaining: state.remaining, parts, nextChangeIn, state };
  }

  /** Decompõe um número de milissegundos em unidades médias (não ancoradas). */
  function splitDuration(ms) {
    let rest = Math.max(0, ms);
    const years = Math.floor(rest / AVG_YEAR);
    rest -= years * AVG_YEAR;
    const months = Math.floor(rest / AVG_MONTH);
    rest -= months * AVG_MONTH;
    const days = Math.floor(rest / DAY);
    rest -= days * DAY;
    const hours = Math.floor(rest / HOUR);
    rest -= hours * HOUR;
    const minutes = Math.floor(rest / MINUTE);
    rest -= minutes * MINUTE;
    const seconds = Math.floor(rest / SECOND);
    rest -= seconds * SECOND;
    return { years, months, days, hours, minutes, seconds, milliseconds: rest, sign: 1 };
  }

  function timeZoneName() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
      return '';
    }
  }

  /** Nome legível do fuso local, ex.: "Horário de Brasília". */
  function timeZoneLabel(at) {
    try {
      const parts = new Intl.DateTimeFormat('pt-BR', { timeZoneName: 'longGeneric' }).formatToParts(new Date(at || now()));
      const part = parts.find((p) => p.type === 'timeZoneName');
      if (part && part.value) return part.value;
    } catch (e) {
      /* sem suporte a longGeneric */
    }
    return timeZoneName().replace(/_/g, ' ');
  }

  A.time = {
    SECOND,
    MINUTE,
    HOUR,
    DAY,
    AVG_YEAR,
    AVG_MONTH,
    MIN_YEAR,
    MAX_YEAR,
    MIN_TIMESTAMP,
    MAX_TIMESTAMP,
    MIN_DURATION,
    STARTING_WINDOW,
    COUNTDOWN_KEYS,
    now,
    isValidTimestamp,
    daysInMonth,
    fromLocalParts,
    parseDateTimeInputs,
    toDateInputValue,
    toTimeInputValue,
    startOfLocalDay,
    addMonths,
    addDays,
    addDuration,
    diffCalendar,
    computeState,
    decomposeRemaining,
    countdownToDuration,
    countdown,
    splitDuration,
    timeZoneName,
    timeZoneLabel
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
