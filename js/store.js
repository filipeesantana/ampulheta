/*
 * Ampulheta — store.js
 * Estado da aplicação: a coleção de ampulhetas e as operações sobre ela.
 * Toda alteração é gravada no armazenamento e notificada à interface
 * (e a outras abas abertas, via BroadcastChannel).
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;
  const M = A.model;
  const T = A.time;

  const emitter = A.utils.createEmitter();
  let items = [];
  let channel = null;

  function sortItems() {
    items.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  }

  function nextOrder() {
    return items.reduce((max, h) => Math.max(max, h.order), -1) + 1;
  }

  function notify(reason, id, external) {
    emitter.emit('change', { reason, id, external: !!external });
    if (!external && channel) {
      try {
        channel.postMessage({ type: 'changed', reason });
      } catch (e) {
        /* canal fechado */
      }
    }
  }

  async function readAll() {
    const adapter = A.storage.getAdapter();
    const raw = await adapter.getAll();
    const out = [];
    const seen = new Set();
    const repairs = [];
    const staleIds = [];
    for (const r of raw) {
      const res = M.normalize(r);
      if (!res.ok) continue;
      if (seen.has(res.value.id)) continue;
      seen.add(res.value.id);
      out.push(res.value);
      if (res.idRegenerated) {
        repairs.push(res.value);
        if (r && typeof r.id === 'string' && r.id) staleIds.push(r.id);
      } else if (res.migrated) {
        repairs.push(res.value);
      }
    }
    // Grava de volta registros migrados (ex.: vindos do armazenamento alternativo).
    if (repairs.length) {
      try {
        for (const id of staleIds) await adapter.remove(id);
        await adapter.putMany(repairs);
      } catch (e) {
        console.warn('[Ampulheta] Não foi possível regravar registros migrados.', e);
      }
    }
    return out;
  }

  async function load() {
    items = await readAll();
    sortItems();
    if (typeof root.BroadcastChannel === 'function' && !channel) {
      try {
        channel = new root.BroadcastChannel('ampulheta');
        channel.onmessage = async (ev) => {
          if (ev && ev.data && ev.data.type === 'changed') {
            items = await readAll();
            sortItems();
            notify('external', null, true);
          }
        };
      } catch (e) {
        channel = null;
      }
    }
    return items;
  }

  function all() {
    return items.slice();
  }

  function active() {
    return items.filter((h) => !h.archived);
  }

  function archived() {
    return items.filter((h) => h.archived);
  }

  function get(id) {
    return items.find((h) => h.id === id) || null;
  }

  async function save(record, reason) {
    await A.storage.getAdapter().put(record);
    const idx = items.findIndex((h) => h.id === record.id);
    if (idx === -1) items.push(record);
    else items[idx] = record;
    sortItems();
    notify(reason, record.id);
    return record;
  }

  async function create(data) {
    const record = M.create(Object.assign({}, data, { order: nextOrder() }));
    const res = M.normalize(record);
    if (!res.ok) throw new Error('Ampulheta inválida: ' + res.reason);
    return save(res.value, 'create');
  }

  async function update(id, patch, reason) {
    const current = get(id);
    if (!current) throw new Error('Ampulheta não encontrada');
    const next = Object.assign({}, current, patch, { id, updatedAt: T.now() });
    const res = M.normalize(next);
    if (!res.ok) throw new Error('Ampulheta inválida: ' + res.reason);
    return save(res.value, reason || 'update');
  }

  async function remove(id) {
    await A.storage.getAdapter().remove(id);
    items = items.filter((h) => h.id !== id);
    notify('remove', id);
  }

  async function duplicate(id) {
    const src = get(id);
    if (!src) throw new Error('Ampulheta não encontrada');
    const suffix = ' (cópia)';
    const base = Array.from(src.name).slice(0, M.NAME_MAX - suffix.length).join('');
    return create({
      name: base + suffix,
      start: src.start,
      end: src.end,
      mode: src.mode,
      duration: src.duration,
      tone: src.tone
    });
  }

  /**
   * Reinicia a ampulheta no lugar: começa agora, com a mesma duração canônica.
   * Nome, tom, ordem e modo são preservados.
   */
  async function restart(id, at) {
    const src = get(id);
    if (!src) throw new Error('Ampulheta não encontrada');
    const interval = M.restartInterval(src, at);
    return update(id, interval, 'restart');
  }

  async function setArchived(id, value) {
    return update(id, { archived: !!value });
  }

  async function replaceAll(records) {
    const list = records.map((r, i) => Object.assign({}, r, { order: i }));
    await A.storage.getAdapter().replaceAll(list);
    items = list;
    sortItems();
    notify('replace', null);
  }

  /**
   * Mescla registros importados.
   *  - ID inexistente: adicionado.
   *  - ID existente com o mesmo conteúdo: ignorado (já está aqui).
   *  - ID existente com conteúdo diferente: importado como cópia, com novo ID.
   * Nunca sobrescreve nem apaga dados existentes.
   */
  async function merge(records) {
    const stats = { added: 0, unchanged: 0, copies: 0 };
    const toWrite = [];
    let order = nextOrder();
    const byId = new Map(items.map((h) => [h.id, h]));
    for (const r of records) {
      const existing = byId.get(r.id);
      if (existing && M.sameContent(existing, r)) {
        stats.unchanged++;
        continue;
      }
      const rec = Object.assign({}, r, { order: order++ });
      if (existing) {
        rec.id = A.utils.uuid();
        stats.copies++;
      } else {
        stats.added++;
      }
      byId.set(rec.id, rec);
      toWrite.push(rec);
    }
    if (toWrite.length) {
      await A.storage.getAdapter().putMany(toWrite);
      items = items.concat(toWrite);
      sortItems();
      notify('merge', null);
    }
    return stats;
  }

  async function clearAll() {
    await A.storage.getAdapter().replaceAll([]);
    items = [];
    notify('clear', null);
  }

  A.store = {
    load,
    all,
    active,
    archived,
    get,
    create,
    update,
    remove,
    duplicate,
    restart,
    setArchived,
    replaceAll,
    merge,
    clearAll,
    on: (type, fn) => emitter.on(type, fn)
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
