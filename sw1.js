// Harvester Mission Fellowship Service Worker
const CACHE_NAME = 'hmf-v1';
const RUNTIME_CACHE = 'hmf-runtime-v1';
const API_CACHE = 'hmf-api-v1';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/icon.png',
  '/churches.json',
  '/events.json',
  '/all-bible-versions.json',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Lora:wght@400;600&family=Source+Sans+3:wght@400;500;600&display=swap'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching app shell assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .catch((error) => {
        console.error('Cache installation failed:', error);
      })
  );
  
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && 
              cacheName !== RUNTIME_CACHE && 
              cacheName !== API_CACHE) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Handle HTML requests with network-first strategy
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            const cache = caches.open(RUNTIME_CACHE);
            cache.then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache on network failure
          return caches.match(request)
            .then((response) => response || caches.match('/index.html'));
        })
    );
    return;
  }

  // Handle JSON data with cache-first strategy
  if (request.url.includes('.json')) {
    event.respondWith(
      caches.match(request)
        .then((response) => {
          if (response) {
            return response;
          }
          
          return fetch(request)
            .then((response) => {
              if (response.ok) {
                const cache = caches.open(API_CACHE);
                cache.then((c) => c.put(request, response.clone()));
              }
              return response;
            });
        })
        .catch(() => {
          // Return cached version if available
          return caches.match(request);
        })
    );
    return;
  }

  // Handle images and static assets with cache-first strategy
  if (request.destination === 'image' || 
      request.url.includes('.css') || 
      request.url.includes('.js') ||
      request.url.includes('.png') ||
      request.url.includes('.jpg') ||
      request.url.includes('.jpeg') ||
      request.url.includes('.gif') ||
      request.url.includes('.webp')) {
    event.respondWith(
      caches.match(request)
        .then((response) => {
          if (response) {
            return response;
          }
          
          return fetch(request)
            .then((response) => {
              if (response.ok) {
                const cache = caches.open(RUNTIME_CACHE);
                cache.then((c) => c.put(request, response.clone()));
              }
              return response;
            });
        })
        .catch(() => {
          // Return a placeholder or cached asset
          if (request.destination === 'image') {
            return new Response(
              '<svg><text>Image unavailable</text></svg>',
              { headers: { 'Content-Type': 'image/svg+xml' } }
            );
          }
          return new Response('Resource unavailable', { status: 503 });
        })
    );
    return;
  }

  // Default strategy - network first, then cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.method === 'GET') {
          const cache = caches.open(RUNTIME_CACHE);
          cache.then((c) => c.put(request, response.clone()));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request)
          .catch(() => {
            return new Response('Offline - Resource not available', { status: 503 });
          });
      })
  );
});

// Handle push notifications
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const options = {
    body: data.body || 'New notification from Harvester Mission',
    icon: '/icon.png',
    badge: '/icon.png',
    tag: data.tag || 'default',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1,
      ...data
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Harvester Mission', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window if none exist
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-events') {
    event.waitUntil(syncEvents());
  }
});

async function syncEvents() {
  try {
    const response = await fetch('/events.json');
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      await cache.put('/events.json', response);
      
      // Notify clients
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'EVENTS_SYNCED',
            timestamp: new Date()
          });
        });
      });
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Message handler for client communication
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(API_CACHE);
    caches.delete(RUNTIME_CACHE);
  }
});

console.log('Service Worker registered successfully');
