/*
 * Ampulheta — service worker
 * Estratégia "rede primeiro, cache como reserva":
 *  - online, sempre busca a versão mais recente (atualizações publicadas no
 *    GitHub Pages aparecem sem precisar mudar nada aqui);
 *  - offline, serve os arquivos guardados na última visita.
 * Todos os caminhos são relativos ao escopo: funciona em subdiretórios
 * (ex.: https://usuario.github.io/ampulheta/).
 * Nenhum dado das ampulhetas passa por aqui — elas vivem no IndexedDB.
 */
'use strict';

const VERSION = '1.0.0';
const CACHE_PREFIX = 'ampulheta-';
const CACHE = CACHE_PREFIX + VERSION + '@' + self.registration.scope;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/hourglass.css',
  './css/responsive.css',
  './js/utils.js',
  './js/time-engine.js',
  './js/format.js',
  './js/grain-engine.js',
  './js/sand-geometry.js',
  './js/model.js',
  './js/storage.js',
  './js/store.js',
  './js/import-export.js',
  './js/hourglass-renderer.js',
  './js/scene.js',
  './js/sound.js',
  './js/ui-dialogs.js',
  './js/ui-form.js',
  './js/ui-panels.js',
  './js/ui-stage.js',
  './js/ui-settings.js',
  './js/app.js',
  './assets/fonts/cormorant-garamond-latin-400-normal.woff2',
  './assets/fonts/cormorant-garamond-latin-400-italic.woff2',
  './assets/fonts/cormorant-garamond-latin-500-normal.woff2',
  './assets/fonts/cormorant-garamond-latin-500-italic.woff2',
  './assets/fonts/inter-latin-wght-normal.woff2',
  './assets/icons/favicon.svg',
  './assets/icons/favicon-32.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key.endsWith('@' + self.registration.scope) && key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true, cacheName: CACHE }).then((hit) => {
          if (hit) return hit;
          if (request.mode === 'navigate') return caches.match('./index.html', { cacheName: CACHE });
          return Response.error();
        })
      )
  );
});
