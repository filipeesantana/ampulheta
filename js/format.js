/*
 * Ampulheta — format.js
 * Formatação humana de números, percentuais, datas e intervalos (pt-BR).
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const T = A.time;

  const LOCALE = 'pt-BR';

  const intFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

  const UNITS = [
    { key: 'years', one: 'ano', many: 'anos' },
    { key: 'months', one: 'mês', many: 'meses' },
    { key: 'days', one: 'dia', many: 'dias' },
    { key: 'hours', one: 'hora', many: 'horas' },
    { key: 'minutes', one: 'minuto', many: 'minutos' },
    { key: 'seconds', one: 'segundo', many: 'segundos' }
  ];

  function formatInteger(n) {
    return intFormatter.format(Math.round(n));
  }

  /** Formata um número decimal com `decimals` casas, sem arredondar para cima (trunca). */
  function formatFixedTruncated(value, decimals) {
    const d = Math.max(0, Math.min(12, decimals | 0));
    const factor = Math.pow(10, d);
    const truncated = Math.floor(value * factor + 1e-9) / factor;
    let [intPart, fracPart] = truncated.toFixed(d).split('.');
    intPart = intFormatter.format(Number(intPart));
    return fracPart ? intPart + ',' + fracPart : intPart;
  }

  /**
   * Percentual com precisão adaptativa.
   *  - sempre ao menos 2 casas;
   *  - casas suficientes para mostrar 3 algarismos significativos quando o
   *    valor (ou o seu complemento) é muito pequeno — 0,000000382%;
   *  - opcionalmente, casas suficientes para que o último dígito mude
   *    aproximadamente a cada segundo (ratePerSecond, em fração/segundo).
   * O valor é truncado: nunca exibe 100% antes do fim, nem 0% depois do início.
   */
  function formatPercent(fraction, options) {
    const opts = options || {};
    const pct = Math.max(0, Math.min(100, fraction * 100));
    if (pct === 0) return '0%';
    if (pct === 100) return '100%';
    const smallest = Math.min(pct, 100 - pct);
    let decimals = opts.minDecimals != null ? opts.minDecimals : 2;
    if (smallest > 0) {
      decimals = Math.max(decimals, 2 - Math.floor(Math.log10(smallest)));
    }
    if (opts.ratePerSecond && opts.ratePerSecond > 0) {
      const pctPerSecond = opts.ratePerSecond * 100;
      decimals = Math.max(decimals, Math.ceil(-Math.log10(pctPerSecond)));
    }
    decimals = Math.min(decimals, opts.maxDecimals != null ? opts.maxDecimals : 12);
    let text = formatFixedTruncated(pct, decimals);
    // Garante que valores > 0 não apareçam como "0"
    if (/^0(,0*)?$/.test(text)) text = '< ' + formatFixedTruncated(Math.pow(10, -decimals), decimals);
    return text + '%';
  }

  /**
   * Percentual "humano": 1 casa decimal no dia a dia (47,2%) e, perto de 0% ou
   * de 100%, apenas as casas necessárias para 2 algarismos significativos
   * (0,0000041%). Truncado: nunca mostra 100% antes do fim.
   */
  function formatPercentHuman(fraction) {
    const pct = Math.max(0, Math.min(100, fraction * 100));
    if (pct === 0) return '0%';
    if (pct === 100) return '100%';
    const smallest = Math.min(pct, 100 - pct);
    const decimals = Math.min(10, Math.max(1, 1 - Math.floor(Math.log10(smallest))));
    return formatFixedTruncated(pct, decimals) + '%';
  }

  /** Percentual curto para listas: inteiro, exceto quando menor que 1%. */
  function formatPercentShort(fraction) {
    const pct = Math.max(0, Math.min(100, fraction * 100));
    if (pct >= 1 && pct < 100) return formatInteger(Math.floor(pct)) + '%';
    if (pct > 0 && pct < 1) return 'menos de 1%';
    return formatPercentHuman(fraction);
  }

  function plural(n, unit) {
    return formatInteger(n) + ' ' + (n === 1 ? unit.one : unit.many);
  }

  function joinList(parts) {
    if (parts.length <= 1) return parts.join('');
    return parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
  }

  /**
   * Escolhe as unidades a exibir: a maior unidade não nula e as seguintes,
   * dentro de uma janela de `maxUnits` níveis; zeros são omitidos.
   */
  function describeParts(parts, maxUnits) {
    const max = Math.max(1, maxUnits || 2);
    const first = UNITS.findIndex((u) => parts[u.key] > 0);
    if (first === -1) return null;
    const out = [];
    for (let i = first; i < Math.min(UNITS.length, first + max); i++) {
      const v = parts[UNITS[i].key];
      if (v > 0) out.push(plural(v, UNITS[i]));
    }
    return joinList(out);
  }

  /** Intervalo de calendário entre dois instantes: "6 anos e 3 meses". */
  function formatSpan(a, b, maxUnits) {
    const diff = T.diffCalendar(a, b);
    const text = describeParts(diff, maxUnits);
    if (text) return text;
    return Math.abs(b - a) > 0 ? 'menos de um segundo' : '0 segundos';
  }

  /** Duração abstrata (sem âncora no calendário): "4 horas e 21 minutos". */
  function formatDuration(ms, maxUnits) {
    const parts = T.splitDuration(ms);
    const text = describeParts(parts, maxUnits);
    if (text) return text;
    return ms > 0 ? 'menos de um segundo' : '0 segundos';
  }

  function decimalComma(value, digits) {
    return value.toFixed(digits).replace('.', ',');
  }

  /** Forma compacta para durações curtas: "16h 28min", "12min 8s", "4,2s", "33ms". */
  function formatDurationCompact(ms) {
    const v = Math.max(0, ms);
    if (v < T.SECOND) return Math.max(1, Math.round(v)) + 'ms';
    if (v < 10 * T.SECOND) {
      const s = Math.round(v / 100) / 10;
      return (s % 1 === 0 ? String(s) : decimalComma(s, 1)) + 's';
    }
    if (v < T.MINUTE) return Math.round(v / T.SECOND) + 's';
    if (v < T.HOUR) {
      const totalS = Math.round(v / T.SECOND);
      const m = Math.floor(totalS / 60);
      const s = totalS % 60;
      return m + 'min' + (s ? ' ' + s + 's' : '');
    }
    if (v < T.DAY) {
      const totalM = Math.round(v / T.MINUTE);
      const h = Math.floor(totalM / 60);
      const m = totalM % 60;
      if (h >= 24) return formatDuration(v, 2);
      return h + 'h' + (m ? ' ' + m + 'min' : '');
    }
    return formatDuration(v, 2);
  }

  const dateFormatters = {};
  function getDateFormatter(key, options) {
    if (!dateFormatters[key]) dateFormatters[key] = new Intl.DateTimeFormat(LOCALE, options);
    return dateFormatters[key];
  }

  /** "30 de setembro de 2120, 14:32" (fuso local). */
  function formatDateTime(ms, withSeconds) {
    const d = new Date(ms);
    const date = getDateFormatter('long', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    const time = getDateFormatter(withSeconds ? 'hms' : 'hm', {
      hour: '2-digit',
      minute: '2-digit',
      second: withSeconds ? '2-digit' : undefined,
      hourCycle: 'h23'
    }).format(d);
    return date + ', ' + time;
  }

  /** "30 de setembro de 2120". */
  function formatDateLong(ms) {
    return getDateFormatter('long', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms));
  }

  /** "30 set. 2120". */
  function formatDateShort(ms) {
    return getDateFormatter('short', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(ms))
      .replace(/ de /g, ' ');
  }

  /** "set. de 2120" */
  function formatMonthYear(ms) {
    return getDateFormatter('my', { month: 'short', year: 'numeric' }).format(new Date(ms));
  }

  /** Mostra segundos quando eles importam (intervalos curtos ou instantes não redondos). */
  function needsSeconds(hourglass) {
    const dur = hourglass.end - hourglass.start;
    return dur < T.DAY || new Date(hourglass.start).getSeconds() !== 0 || new Date(hourglass.end).getSeconds() !== 0;
  }

  /** Frase curta de estado, usada em listas e na navegação. */
  function describeStatus(hourglass, at) {
    const now = typeof at === 'number' ? at : T.now();
    const s = T.computeState(hourglass, now);
    if (s.status === 'pending') return { status: s.status, text: 'Começa em ' + formatSpan(now, hourglass.start, 1) };
    if (s.status === 'finished') return { status: s.status, text: 'Terminou' };
    if (s.elapsed < T.MINUTE) return { status: s.status, text: 'Começou agora' };
    return { status: s.status, text: 'Em andamento · ' + formatPercentShort(s.progress) };
  }

  /** Duração canônica em texto: {minutes: 30} → "30 minutos". */
  function formatDurationParts(parts, maxUnits) {
    return describeParts(parts || {}, maxUnits || 6) || '0 segundos';
  }

  A.format = {
    formatPercentHuman,
    formatPercentShort,
    describeStatus,
    formatDurationParts,
    formatInteger,
    formatFixedTruncated,
    formatPercent,
    formatSpan,
    formatDuration,
    formatDurationCompact,
    formatDateTime,
    formatDateLong,
    formatDateShort,
    formatMonthYear,
    needsSeconds,
    joinList
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
