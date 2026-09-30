/*
 * Ampulheta — storage.js
 * Persistência local.
 *
 *  - Ampulhetas: IndexedDB (banco "ampulheta", store "hourglasses").
 *    Se o IndexedDB não estiver disponível (alguns modos privados, file:// em
 *    certos navegadores), cai para localStorage e, em último caso, memória.
 *  - Preferências: localStorage (pequenas, síncronas), com fallback em memória.
 *
 * Só são gravados instantes (start/end), a duração canônica e configurações.
 * Nenhum grão, nenhum "tick": o estado visual é sempre reconstruído a partir
 * do relógio.
 *
 * Versões do banco:
 *   1 — ampulhetas { id, name, start, end, tone, archived, order, ... }
 *   2 — mesmos registros com schemaVersion, mode e duration (migração
 *       automática no upgrade; nada é apagado — registros ilegíveis ficam
 *       intactos e são apenas ignorados na leitura).
 */
(function (root) {
  'use strict';

  const A = root.Ampulheta;

  const DB_NAME = 'ampulheta';
  const DB_VERSION = 2;
  const STORE = 'hourglasses';
  const LS_KEY = 'ampulheta.hourglasses.v1';
  const SETTINGS_KEY = 'ampulheta.settings.v1';
  const OPEN_TIMEOUT = 8000;
  const emitter = A.utils.createEmitter();

  /* ------------------------------------------------------------------ */
  /* Adaptador IndexedDB                                                  */
  /* ------------------------------------------------------------------ */

  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
    });
  }

  function openIndexedDB() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('IndexedDB não respondeu'));
        }
      }, OPEN_TIMEOUT);
      let request;
      try {
        request = root.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const tx = request.transaction;
        let store;
        if (!db.objectStoreNames.contains(STORE)) store = db.createObjectStore(STORE, { keyPath: 'id' });
        else store = tx.objectStore(STORE);
        // v1 → v2: acrescenta schemaVersion, mode e duration a cada registro.
        if (event.oldVersion >= 1 && event.oldVersion < 2) migrateStore(store);
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        // Outra aba abriu uma versão mais nova do banco: libera e avisa.
        db.onversionchange = () => {
          db.close();
          emitter.emit('versionchange');
        };
        resolve(db);
      };
      request.onerror = () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(request.error || new Error('Falha ao abrir IndexedDB'));
        }
      };
      request.onblocked = () => {
        /* outra aba com versão antiga aberta; o timeout decide */
      };
    });
  }

  /** Migra registros dentro da transação de upgrade (cursor), sem apagar nada. */
  function migrateStore(store) {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const res = A.model.normalize(cursor.value);
      if (res.ok && res.migrated && res.value.id === cursor.value.id) {
        try {
          cursor.update(res.value);
        } catch (e) {
          /* mantém o registro original */
        }
      }
      cursor.continue();
    };
  }

  function createIndexedDBAdapter(db) {
    return {
      kind: 'indexeddb',
      async getAll() {
        const tx = db.transaction(STORE, 'readonly');
        return promisify(tx.objectStore(STORE).getAll());
      },
      async put(record) {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        return txDone(tx);
      },
      async putMany(records) {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const r of records) store.put(r);
        return txDone(tx);
      },
      async remove(id) {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        return txDone(tx);
      },
      async replaceAll(records) {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.clear();
        for (const r of records) store.put(r);
        return txDone(tx);
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Adaptador localStorage / memória                                     */
  /* ------------------------------------------------------------------ */

  function createKeyValueAdapter(kind, read, write) {
    function load() {
      try {
        const parsed = JSON.parse(read() || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    function save(list) {
      write(JSON.stringify(list));
    }
    return {
      kind,
      async getAll() {
        return load();
      },
      async put(record) {
        const list = load().filter((r) => r && r.id !== record.id);
        list.push(record);
        save(list);
      },
      async putMany(records) {
        const ids = new Set(records.map((r) => r.id));
        const list = load().filter((r) => r && !ids.has(r.id));
        save(list.concat(records));
      },
      async remove(id) {
        save(load().filter((r) => r && r.id !== id));
      },
      async replaceAll(records) {
        save(records.slice());
      }
    };
  }

  function localStorageAvailable() {
    try {
      const k = '__ampulheta_test__';
      root.localStorage.setItem(k, '1');
      root.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  let adapter = null;

  async function init() {
    if (adapter) return adapter;
    if (root.indexedDB) {
      try {
        const db = await openIndexedDB();
        adapter = createIndexedDBAdapter(db);
        // Migra dados de um eventual fallback anterior em localStorage.
        await migrateFromLocalStorage(adapter);
        return adapter;
      } catch (err) {
        console.warn('[Ampulheta] IndexedDB indisponível, usando alternativa.', err);
      }
    }
    if (localStorageAvailable()) {
      adapter = createKeyValueAdapter(
        'localstorage',
        () => root.localStorage.getItem(LS_KEY),
        (v) => root.localStorage.setItem(LS_KEY, v)
      );
      return adapter;
    }
    let memory = '[]';
    adapter = createKeyValueAdapter('memory', () => memory, (v) => (memory = v));
    return adapter;
  }

  async function migrateFromLocalStorage(target) {
    if (!localStorageAvailable()) return;
    const raw = root.localStorage.getItem(LS_KEY);
    if (!raw) return;
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length) {
        const existing = await target.getAll();
        const ids = new Set(existing.map((r) => r.id));
        const fresh = list.filter((r) => r && typeof r.id === 'string' && !ids.has(r.id));
        if (fresh.length) await target.putMany(fresh);
      }
      root.localStorage.removeItem(LS_KEY);
    } catch (e) {
      /* dados ilegíveis permanecem onde estão */
    }
  }

  function getAdapter() {
    return adapter;
  }

  /** Pede ao navegador que não descarte os dados sob pressão de espaço. */
  async function requestPersistence() {
    try {
      if (root.navigator && navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) {
      /* sem suporte */
    }
    return false;
  }

  async function persistenceStatus() {
    try {
      if (root.navigator && navigator.storage && navigator.storage.persisted) {
        return (await navigator.storage.persisted()) ? 'persistent' : 'best-effort';
      }
    } catch (e) {
      /* sem suporte */
    }
    return 'unknown';
  }

  /* ------------------------------------------------------------------ */
  /* Preferências                                                         */
  /* ------------------------------------------------------------------ */

  const SETTINGS_DEFAULTS = Object.freeze({
    sound: false,
    contemplationFullscreen: true,
    reduceMotion: false,
    showLabel: true
  });

  const settingsEmitter = A.utils.createEmitter();
  let settingsCache = null;
  let settingsMemory = null;

  function sanitizeSettings(raw) {
    const out = Object.assign({}, SETTINGS_DEFAULTS);
    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(SETTINGS_DEFAULTS)) {
        if (typeof raw[key] === typeof SETTINGS_DEFAULTS[key]) out[key] = raw[key];
      }
    }
    return out;
  }

  function readSettings() {
    if (settingsCache) return settingsCache;
    let raw = null;
    try {
      raw = JSON.parse(root.localStorage.getItem(SETTINGS_KEY) || 'null');
    } catch (e) {
      raw = settingsMemory;
    }
    settingsCache = sanitizeSettings(raw);
    return settingsCache;
  }

  function writeSettings(next) {
    settingsCache = sanitizeSettings(next);
    try {
      root.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsCache));
    } catch (e) {
      settingsMemory = settingsCache;
    }
    settingsEmitter.emit('change', settingsCache);
  }

  const settings = {
    defaults: SETTINGS_DEFAULTS,
    all: () => Object.assign({}, readSettings()),
    get: (key) => readSettings()[key],
    set(key, value) {
      const next = Object.assign({}, readSettings());
      next[key] = value;
      writeSettings(next);
    },
    replace(values) {
      writeSettings(Object.assign({}, readSettings(), sanitizeSettings(values)));
    },
    reload() {
      settingsCache = null;
      settingsEmitter.emit('change', readSettings());
    },
    on: (type, fn) => settingsEmitter.on(type, fn),
    sanitize: sanitizeSettings
  };

  /* Pequenos valores de interface (ex.: última ampulheta vista). */
  const ui = {
    get(key) {
      try {
        return root.localStorage.getItem('ampulheta.ui.' + key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        if (value == null) root.localStorage.removeItem('ampulheta.ui.' + key);
        else root.localStorage.setItem('ampulheta.ui.' + key, String(value));
      } catch (e) {
        /* ignora */
      }
    }
  };

  A.storage = {
    DB_VERSION,
    on: (type, fn) => emitter.on(type, fn),
    init,
    getAdapter,
    requestPersistence,
    persistenceStatus,
    settings,
    ui,
    SETTINGS_KEY
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
