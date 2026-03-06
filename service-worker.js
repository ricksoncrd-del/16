/**
 * ============================================================
 *  HMFC Bible App — Service Worker
 *  Harvester Mission Fellowship Church
 *  Strategy: Cache-first for app shell & static assets,
 *             Network-first for JSON data files,
 *             Stale-while-revalidate for external images
 * ============================================================
 */

const APP_VERSION    = 'hmfc-v1.0.0';
const CACHE_SHELL    = `${APP_VERSION}-shell`;
const CACHE_DATA     = `${APP_VERSION}-data`;
const CACHE_IMAGES   = `${APP_VERSION}-images`;

// Core app shell — always cached on install
const SHELL_FILES = [
  './index.html',
  './manifest.json',
  './icon.png'
];

// App data files — cached and kept fresh
const DATA_FILES = [
  './all-bible-versions.json',
  './churches.json',
  './events.json'
];

// All known caches managed by this SW
const ALL_CACHES = [CACHE_SHELL, CACHE_DATA, CACHE_IMAGES];


/* ============================================================
   INSTALL — pre-cache app shell and data
   ============================================================ */
self.addEventListener('install', event => {
  console.log(`[SW] Installing ${APP_VERSION}…`);

  event.waitUntil(
    Promise.all([
      // Cache shell files
      caches.open(CACHE_SHELL).then(cache => {
        console.log('[SW] Caching app shell');
        return cache.addAll(SHELL_FILES).catch(err => {
          console.warn('[SW] Shell cache error:', err);
        });
      }),

      // Cache data files (don't block install if they fail)
      caches.open(CACHE_DATA).then(cache => {
        console.log('[SW] Caching data files');
        return Promise.allSettled(
          DATA_FILES.map(url =>
            fetch(url)
              .then(res => {
                if (res.ok) {
                  cache.put(url, res);
                  console.log(`[SW] Cached: ${url}`);
                }
              })
              .catch(err => console.warn(`[SW] Could not cache ${url}:`, err))
          )
        );
      })
    ])
    .then(() => {
      console.log('[SW] Install complete');
      // Activate immediately — don't wait for old tabs to close
      return self.skipWaiting();
    })
  );
});


/* ============================================================
   ACTIVATE — clean up old caches
   ============================================================ */
self.addEventListener('activate', event => {
  console.log(`[SW] Activating ${APP_VERSION}`);

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => !ALL_CACHES.includes(key))
          .map(oldKey => {
            console.log(`[SW] Deleting old cache: ${oldKey}`);
            return caches.delete(oldKey);
          })
      )
    )
    .then(() => {
      console.log('[SW] Activated — claiming all clients');
      return self.clients.claim();
    })
  );
});


/* ============================================================
   FETCH — routing strategy per request type
   ============================================================ */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET, browser extensions, chrome-extension, etc.
  if (request.method !== 'GET') return;
  if (!['http:', 'https:'].includes(url.protocol)) return;

  const pathname = url.pathname;

  // ── Strategy 1: CACHE FIRST — app shell (HTML, manifest, icon)
  if (isShellRequest(url, pathname)) {
    event.respondWith(cacheFirst(request, CACHE_SHELL));
    return;
  }

  // ── Strategy 2: NETWORK FIRST — JSON data files
  if (isDataRequest(pathname)) {
    event.respondWith(networkFirst(request, CACHE_DATA));
    return;
  }

  // ── Strategy 3: STALE-WHILE-REVALIDATE — church images (Facebook CDN, etc.)
  if (isImageRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request, CACHE_IMAGES));
    return;
  }

  // ── Default: try network, fall back to cache
  event.respondWith(networkFallbackToCache(request));
});


/* ============================================================
   URL MATCHERS
   ============================================================ */
function isShellRequest(url, pathname) {
  // Same origin shell files
  if (url.origin !== self.location.origin) return false;
  return (
    pathname === '/' ||
    pathname.endsWith('index.html') ||
    pathname.endsWith('manifest.json') ||
    pathname.endsWith('icon.png')
  );
}

function isDataRequest(pathname) {
  return (
    pathname.endsWith('all-bible-versions.json') ||
    pathname.endsWith('churches.json') ||
    pathname.endsWith('events.json')
  );
}

function isImageRequest(request, url) {
  return (
    request.destination === 'image' ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?.*)?$/i.test(url.pathname)
  );
}


/* ============================================================
   CACHING STRATEGIES
   ============================================================ */

/**
 * Cache First — serve from cache, fall back to network.
 * Best for: app shell, icons, fonts.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    console.log(`[SW] Cache hit: ${request.url}`);
    return cached;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.warn(`[SW] Cache first failed: ${request.url}`, err);
    return offlineFallback(request);
  }
}

/**
 * Network First — fetch from network, fall back to cache.
 * Best for: JSON data that changes periodically.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request, { cache: 'no-cache' });
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
      console.log(`[SW] Network first (fresh): ${request.url}`);
    }
    return networkResponse;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) {
      console.log(`[SW] Network first (cached fallback): ${request.url}`);
      return cached;
    }
    console.warn(`[SW] Network first — no cache: ${request.url}`, err);
    return offlineFallback(request);
  }
}

/**
 * Stale While Revalidate — serve cache immediately, update in background.
 * Best for: church hero images, external images.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(networkResponse => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cached) {
    console.log(`[SW] Stale (cached): ${request.url}`);
    return cached;
  }

  // No cache, wait for network
  const fresh = await fetchPromise;
  return fresh || offlineFallback(request);
}

/**
 * Network with cache fallback — generic strategy.
 */
async function networkFallbackToCache(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}


/* ============================================================
   OFFLINE FALLBACK
   ============================================================ */
async function offlineFallback(request) {
  // For HTML navigation requests, serve index.html from cache
  if (request.destination === 'document' || request.mode === 'navigate') {
    const cache = await caches.open(CACHE_SHELL);
    const fallback = await cache.match('./index.html') ||
                     await cache.match('/index.html');
    if (fallback) return fallback;
  }

  // For images, return a transparent 1×1 pixel
  if (request.destination === 'image' || isImageRequest(request, new URL(request.url))) {
    return new Response(
      // 1×1 transparent PNG (base64-encoded)
      Uint8Array.from(atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      ), c => c.charCodeAt(0)),
      { status: 200, headers: { 'Content-Type': 'image/png' } }
    );
  }

  // Generic offline response for data/other requests
  return new Response(
    JSON.stringify({ error: 'offline', message: 'You are offline. Please reconnect.' }),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' }
    }
  );
}


/* ============================================================
   BACKGROUND SYNC — refresh data files when back online
   ============================================================ */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-data') {
    console.log('[SW] Background sync: refreshing data files');
    event.waitUntil(refreshDataFiles());
  }
});

async function refreshDataFiles() {
  const cache = await caches.open(CACHE_DATA);
  await Promise.allSettled(
    DATA_FILES.map(url =>
      fetch(url)
        .then(res => {
          if (res.ok) {
            cache.put(url, res);
            console.log(`[SW] Refreshed: ${url}`);
          }
        })
        .catch(err => console.warn(`[SW] Sync refresh failed for ${url}:`, err))
    )
  );
}


/* ============================================================
   PUSH NOTIFICATIONS (ready for future use)
   ============================================================ */
self.addEventListener('push', event => {
  if (!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch (e) { data = { title: event.data.text() }; }

  const title   = data.title || 'Harvester Mission Fellowship';
  const options = {
    body:    data.body    || 'New update from HMFC',
    icon:    data.icon    || './icon.png',
    badge:   data.badge   || './icon.png',
    tag:     data.tag     || 'hmfc-notification',
    data:    data.url     || './',
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open',    title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss'  }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(urlToOpen);
      })
  );
});


/* ============================================================
   MESSAGE HANDLER — communicate with the app
   ============================================================ */
self.addEventListener('message', event => {
  const { type } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      console.log('[SW] Skip waiting requested');
      self.skipWaiting();
      break;

    case 'GET_VERSION':
      event.ports[0]?.postMessage({ version: APP_VERSION });
      break;

    case 'CLEAR_CACHE':
      caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => {
          console.log('[SW] All caches cleared');
          event.ports[0]?.postMessage({ success: true });
        });
      break;

    case 'REFRESH_DATA':
      refreshDataFiles().then(() => {
        console.log('[SW] Data refreshed on demand');
        event.ports[0]?.postMessage({ success: true });
      });
      break;

    default:
      break;
  }
});
