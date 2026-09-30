/*
 * Ampulheta — ui-form.js
 * Criação e edição de ampulhetas.
 * Dois modos: "entre duas datas" e "por uma duração" (a partir de agora ou
 * de outra data). O intervalo é sempre convertido em dois instantes absolutos.
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const { el, qs, qsa, clear } = A.utils;
  const T = A.time;
  const F = A.format;

  const DURATION_FIELDS = ['years', 'months', 'days', 'hours', 'minutes', 'seconds'];

  let dialog;
  let form;
  let editingId = null;
  let original = null; // valores originais (edição), para não perder segundos ao salvar
  let submitting = false;
  let els = {};

  const ERRORS = {
    'empty-name': 'Dê um nome à ampulheta.',
    'empty-start': 'Informe a data de início.',
    'empty-end': 'Informe a data de término.',
    'invalid-start': 'A data de início não existe no calendário.',
    'invalid-end': 'A data de término não existe no calendário.',
    'invalid-time': 'Hora inválida. Use o formato HH:MM.',
    'out-of-range': 'Use datas entre os anos 1 e 9999.',
    order: 'O término precisa ser posterior ao início.',
    short: 'A duração mínima é de um segundo.',
    'zero-duration': 'Defina uma duração maior que zero.',
    'bad-number': 'Use apenas números inteiros, sem valores negativos.',
    'too-long': 'O término ultrapassa o ano 9999.'
  };

  function init() {
    dialog = qs('#form-dialog');
    form = qs('#hg-form');
    els = {
      title: qs('#form-title'),
      name: qs('#f-name'),
      paneDates: qs('#pane-dates'),
      paneDuration: qs('#pane-duration'),
      startDate: qs('#f-start-date'),
      startTime: qs('#f-start-time'),
      startNow: qs('#f-start-now'),
      endDate: qs('#f-end-date'),
      endTime: qs('#f-end-time'),
      dStartRow: qs('#f-dstart-row'),
      dStartDate: qs('#f-dstart-date'),
      dStartTime: qs('#f-dstart-time'),
      presets: qs('#f-presets'),
      tones: qs('#f-tones'),
      preview: qs('#f-preview'),
      error: qs('#f-error'),
      submit: qs('#f-submit')
    };
    DURATION_FIELDS.forEach((k) => (els['d_' + k] = qs('#f-d-' + k)));

    buildTones();

    qsa('input[name="mode"]', form).forEach((r) => r.addEventListener('change', () => setMode(r.value)));
    qsa('input[name="startMode"]', form).forEach((r) =>
      r.addEventListener('change', () => {
        const custom = getStartMode() === 'custom';
        els.dStartRow.hidden = !custom;
        if (custom && !els.dStartDate.value) {
          const now = T.now();
          els.dStartDate.value = T.toDateInputValue(now);
          els.dStartTime.value = T.toTimeInputValue(now);
        }
        refresh();
      })
    );
    els.startNow.addEventListener('click', () => {
      const now = T.now();
      els.startDate.value = T.toDateInputValue(now);
      els.startTime.value = T.toTimeInputValue(now);
      refresh();
    });
    els.presets.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-preset]');
      if (!btn) return;
      const [unit, value] = btn.dataset.preset.split(':');
      DURATION_FIELDS.forEach((k) => (els['d_' + k].value = ''));
      els['d_' + unit].value = value;
      refresh();
    });
    form.addEventListener('input', () => {
      els.error.textContent = '';
      qsa('[aria-invalid="true"]', form).forEach((n) => n.removeAttribute('aria-invalid'));
      refresh();
    });
    form.addEventListener('change', refresh);
    form.addEventListener('submit', onSubmit);
  }

  function buildTones() {
    clear(els.tones);
    const tones = A.renderer.TONES;
    for (const t of A.model.TONES) {
      const c = tones[t.id];
      const input = el('input', { attrs: { type: 'radio', name: 'tone', value: t.id, 'aria-label': t.label } });
      input.style.setProperty('--swatch', 'radial-gradient(circle at 35% 30%, ' + c.light + ', ' + c.base + ' 55%, ' + c.dark + ')');
      els.tones.appendChild(el('label', { class: 'tone' }, [input, el('span', { text: t.label })]));
    }
  }

  function getMode() {
    const r = qs('input[name="mode"]:checked', form);
    return r ? r.value : 'dates';
  }

  function setMode(mode) {
    const r = qs('input[name="mode"][value="' + mode + '"]', form);
    if (r) r.checked = true;
    els.paneDates.hidden = mode !== 'dates';
    els.paneDuration.hidden = mode !== 'duration';
    A.storage.ui.set('formMode', mode);
    refresh();
  }

  function getStartMode() {
    const r = qs('input[name="startMode"]:checked', form);
    return r ? r.value : 'now';
  }

  function setStartMode(mode) {
    const r = qs('input[name="startMode"][value="' + mode + '"]', form);
    if (r) r.checked = true;
    els.dStartRow.hidden = mode !== 'custom';
  }

  function getTone() {
    const r = qs('input[name="tone"]:checked', form);
    return r ? r.value : A.model.DEFAULT_TONE;
  }

  function setTone(tone) {
    const r = qs('input[name="tone"][value="' + tone + '"]', form) || qs('input[name="tone"]', form);
    if (r) r.checked = true;
  }

  function readDuration() {
    const parts = {};
    let any = false;
    for (const k of DURATION_FIELDS) {
      const raw = els['d_' + k].value.trim();
      if (raw === '') {
        parts[k] = 0;
        continue;
      }
      if (!/^\d{1,12}$/.test(raw)) return { ok: false, error: 'bad-number', field: els['d_' + k] };
      const v = Number(raw);
      if (!Number.isSafeInteger(v)) return { ok: false, error: 'bad-number', field: els['d_' + k] };
      parts[k] = v;
      if (v > 0) any = true;
    }
    if (!any) return { ok: false, error: 'zero-duration', field: els.d_years, soft: true };
    return { ok: true, parts };
  }

  function parseField(dateInput, timeInput, which) {
    const res = T.parseDateTimeInputs(dateInput.value, timeInput.value);
    if (res.ok) return res;
    let error = res.error;
    if (error === 'empty-date') error = 'empty-' + which;
    else if (error === 'invalid-date') error = 'invalid-' + which;
    return { ok: false, error, field: error === 'invalid-time' ? timeInput : dateInput, soft: res.error === 'empty-date' };
  }

  /** Calcula o intervalo a partir dos campos. Não altera nada. */
  function computeInterval() {
    const mode = getMode();
    let start;
    let end;
    if (mode === 'dates') {
      const unchanged =
        original &&
        els.startDate.value === original.startDate &&
        els.startTime.value === original.startTime &&
        els.endDate.value === original.endDate &&
        els.endTime.value === original.endTime;
      if (unchanged) {
        start = original.start;
        end = original.end;
      } else {
        const s = parseField(els.startDate, els.startTime, 'start');
        if (!s.ok) return s;
        const e = parseField(els.endDate, els.endTime, 'end');
        if (!e.ok) return e;
        start =
          original && els.startDate.value === original.startDate && els.startTime.value === original.startTime
            ? original.start
            : s.ms;
        end = original && els.endDate.value === original.endDate && els.endTime.value === original.endTime ? original.end : e.ms;
      }
    } else {
      const d = readDuration();
      if (!d.ok) return d;
      if (getStartMode() === 'custom') {
        const s = parseField(els.dStartDate, els.dStartTime, 'start');
        if (!s.ok) return s;
        start = s.ms;
      } else {
        start = T.now();
      }
      end = T.addDuration(start, d.parts);
      if (!T.isValidTimestamp(end)) return { ok: false, error: 'too-long', field: els.d_years };
    }
    if (end <= start) return { ok: false, error: 'order', field: mode === 'dates' ? els.endDate : els.d_years };
    if (end - start < T.MIN_DURATION) return { ok: false, error: 'short', field: mode === 'dates' ? els.endTime : els.d_seconds };
    return { ok: true, start, end };
  }

  function refresh() {
    // Destaca o atalho correspondente à duração digitada.
    const d = readDuration();
    qsa('.chip', els.presets).forEach((chip) => {
      const [unit, value] = chip.dataset.preset.split(':');
      const match = d.ok && DURATION_FIELDS.every((k) => (k === unit ? d.parts[k] === Number(value) : d.parts[k] === 0));
      chip.classList.toggle('is-active', match);
    });
    renderPreview();
  }

  function renderPreview() {
    clear(els.preview);
    els.preview.classList.remove('is-error');
    const res = computeInterval();
    if (!res.ok) {
      if (!res.soft && res.error !== 'empty-name') {
        els.preview.appendChild(el('span', { class: 'form-error', text: ERRORS[res.error] || '' }));
      }
      return;
    }
    const now = T.now();
    const model = A.grains.createModel({ start: res.start, end: res.end });
    const parts = [];
    parts.push(el('em', { text: F.formatSpan(res.start, res.end, 2) }));
    parts.push(
      document.createTextNode(
        'termina em ' + F.formatDateTime(res.end, F.needsSeconds({ start: res.start, end: res.end }))
      )
    );
    parts.push(document.createTextNode('cada grão ≈ ' + F.formatDurationCompact(model.grainMs)));
    if (res.start < now - 1000 && res.end > now) {
      parts.push(document.createTextNode('já transcorrido ' + F.formatPercent((now - res.start) / (res.end - res.start))));
    } else if (res.end <= now) {
      parts.push(document.createTextNode('já concluída'));
    } else if (res.start > now + 1000) {
      parts.push(document.createTextNode('começa em ' + F.formatSpan(now, res.start, 1)));
    }
    parts.forEach((p, i) => {
      if (i > 0) els.preview.appendChild(el('span', { class: 'sep', text: '·', attrs: { 'aria-hidden': 'true' } }));
      els.preview.appendChild(p);
    });
  }

  function resetFields() {
    form.reset();
    DURATION_FIELDS.forEach((k) => (els['d_' + k].value = ''));
    els.error.textContent = '';
    qsa('[aria-invalid="true"]', form).forEach((n) => n.removeAttribute('aria-invalid'));
    [els.startTime, els.endTime, els.dStartTime].forEach((i) => i.removeAttribute('step'));
  }

  function openCreate() {
    editingId = null;
    original = null;
    resetFields();
    els.title.textContent = 'Nova ampulheta';
    els.submit.textContent = 'Criar';
    const now = T.now();
    els.startDate.value = T.toDateInputValue(now);
    els.startTime.value = T.toTimeInputValue(now);
    els.endDate.value = '';
    els.endTime.value = '';
    setStartMode('now');
    setTone(A.model.DEFAULT_TONE);
    const mode = A.storage.ui.get('formMode') === 'duration' ? 'duration' : 'dates';
    setMode(mode);
    A.dialogs.open(dialog, { initialFocus: els.name, backdropClose: false });
  }

  function openEdit(hourglass) {
    if (!hourglass) return;
    editingId = hourglass.id;
    resetFields();
    els.title.textContent = 'Editar ampulheta';
    els.submit.textContent = 'Salvar';
    els.name.value = hourglass.name;
    const withSec = (ms) => new Date(ms).getSeconds() !== 0;
    original = {
      start: hourglass.start,
      end: hourglass.end,
      startDate: T.toDateInputValue(hourglass.start),
      startTime: T.toTimeInputValue(hourglass.start, withSec(hourglass.start)),
      endDate: T.toDateInputValue(hourglass.end),
      endTime: T.toTimeInputValue(hourglass.end, withSec(hourglass.end))
    };
    if (withSec(hourglass.start)) els.startTime.setAttribute('step', '1');
    if (withSec(hourglass.end)) els.endTime.setAttribute('step', '1');
    els.startDate.value = original.startDate;
    els.startTime.value = original.startTime;
    els.endDate.value = original.endDate;
    els.endTime.value = original.endTime;
    // Modo duração pré-preenchido com o mesmo intervalo, a partir do mesmo início.
    const diff = T.diffCalendar(hourglass.start, hourglass.end);
    DURATION_FIELDS.forEach((k) => (els['d_' + k].value = diff[k] ? String(diff[k]) : ''));
    setStartMode('custom');
    els.dStartDate.value = original.startDate;
    els.dStartTime.value = original.startTime;
    if (withSec(hourglass.start)) els.dStartTime.setAttribute('step', '1');
    setTone(hourglass.tone);
    setMode('dates');
    A.dialogs.open(dialog, { initialFocus: els.name, backdropClose: false });
  }

  function showError(code, field) {
    els.error.textContent = ERRORS[code] || 'Verifique os campos.';
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      try {
        field.focus();
      } catch (e) {
        /* ignora */
      }
    }
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    if (submitting) return;
    const name = A.model.cleanName(els.name.value);
    if (!name) {
      showError('empty-name', els.name);
      return;
    }
    const res = computeInterval();
    if (!res.ok) {
      showError(res.error, res.field);
      return;
    }
    submitting = true;
    els.submit.disabled = true;
    try {
      const data = { name, start: res.start, end: res.end, tone: getTone() };
      let record;
      if (editingId) {
        record = await A.store.update(editingId, data);
        A.dialogs.toast('Alterações salvas.');
      } else {
        record = await A.store.create(data);
        A.storage.requestPersistence();
        A.dialogs.toast('Ampulheta criada.');
      }
      A.dialogs.close(dialog);
      A.app.select(record.id, 1);
    } catch (err) {
      console.error(err);
      showError(null);
      els.error.textContent = 'Não foi possível salvar. O armazenamento do navegador pode estar indisponível.';
    } finally {
      submitting = false;
      els.submit.disabled = false;
    }
  }

  A.form = { init, openCreate, openEdit, computeInterval };
})(typeof globalThis !== 'undefined' ? globalThis : window);
