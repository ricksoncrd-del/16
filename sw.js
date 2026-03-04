// Harvester Mission Fellowship Service Worker (IMPROVED)
const CACHE_NAME = 'hmf-v1';
const RUNTIME_CACHE = 'hmf-runtime-v1';
const API_CACHE = 'hmf-api-v1';
const IMAGE_CACHE = 'hmf-images-v1';

// Local assets to cache on install
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/icon.png',
  '/churches.json',
  '/events.json',
  '/all-bible-versions.json'
];

// External domains we want to cache (images)
const CACHE_EXTERNAL_DOMAINS = [
  'scontent.fmnl',        // Facebook images
  'images.unsplash.com',  // Unsplash images
  'googleapis.com',       // Google Fonts
  'gstatic.com'          // Google Static images
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installing...');
  
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME)
        .then((cache) => {
          console.log('✓ Caching app shell assets');
          return cache.addAll(ASSETS_TO_CACHE);
        })
        .catch((error) => {
          console.error('✗ Cache installation failed:', error);
        }),
      // Pre-cache external fonts
      caches.open(IMAGE_CACHE)
        .then((cache) => {
          console.log('✓ Image cache ready for external resources');
        })
    ])
  );
  
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && 
              cacheName !== RUNTIME_CACHE && 
              cacheName !== API_CACHE &&
              cacheName !== IMAGE_CACHE) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  
  self.clients.claim();
});

// Helper function to check if URL should be cached
function shouldCacheExternalDomain(url) {
  return CACHE_EXTERNAL_DOMAINS.some(domain => url.includes(domain));
}

// Fetch event - intelligent caching strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle local requests
  if (url.origin === self.location.origin) {
    return handleLocalRequest(event);
  }

  // Handle external requests (images, fonts, etc.)
  if (shouldCacheExternalDomain(request.url)) {
    return handleExternalRequest(event);
  }

  // Default: try network, fallback to cache
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

// Handle local requests with network-first strategy
function handleLocalRequest(event) {
  const { request } = event;
  const url = new URL(request.url);

  // HTML requests - network first
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then((response) => response || caches.match('/index.html'));
        })
    );
    return;
  }

  // JSON data - cache first for faster loading
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
                caches.open(API_CACHE).then((c) => c.put(request, response.clone()));
              }
              return response;
            });
        })
        .catch(() => {
          return caches.match(request);
        })
    );
    return;
  }

  // Images and static assets - cache first
  if (isStaticAsset(request)) {
    event.respondWith(
      caches.match(request)
        .then((response) => {
          if (response) {
            return response;
          }
          
          return fetch(request)
            .then((response) => {
              if (response.ok) {
                caches.open(RUNTIME_CACHE).then((c) => c.put(request, response.clone()));
              }
              return response;
            });
        })
        .catch(() => {
          return createPlaceholder(request);
        })
    );
    return;
  }

  // Default strategy
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.method === 'GET') {
          caches.open(RUNTIME_CACHE).then((c) => c.put(request, response.clone()));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request)
          .catch(() => new Response('Offline', { status: 503 }));
      })
  );
}

// Handle external requests (images, fonts) - cache first
function handleExternalRequest(event) {
  const { request } = event;

  event.respondWith(
    caches.match(request)
      .then((response) => {
        // Return cached version if available
        if (response) {
          return response;
        }

        // Try to fetch from network
        return fetch(request, { mode: 'cors', credentials: 'omit' })
          .then((response) => {
            // Cache successful responses
            if (response && response.status === 200) {
              const cache = caches.open(IMAGE_CACHE);
              cache.then((c) => c.put(request, response.clone()));
            }
            return response;
          });
      })
      .catch(() => {
        // Fallback for failed external resources
        return createPlaceholder(request);
      })
  );
}

// Check if request is a static asset
function isStaticAsset(request) {
  return request.destination === 'image' || 
         request.url.includes('.css') || 
         request.url.includes('.js') ||
         request.url.includes('.png') ||
         request.url.includes('.jpg') ||
         request.url.includes('.jpeg') ||
         request.url.includes('.gif') ||
         request.url.includes('.webp') ||
         request.url.includes('.woff') ||
         request.url.includes('.woff2') ||
         request.url.includes('.ttf');
}

// Create placeholder for missing resources
function createPlaceholder(request) {
  if (request.destination === 'image') {
    // Return a simple placeholder SVG
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
        <rect width="400" height="300" fill="#232d42"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#a89f8c" font-size="20" font-family="sans-serif">
          Image unavailable offline
        </text>
      </svg>`,
      { 
        headers: { 'Content-Type': 'image/svg+xml' },
        status: 200
      }
    );
  }

  return new Response('Resource unavailable offline', { status: 503 });
}

// Push notification handler
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

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Background sync
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

// Message handler
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    Promise.all([
      caches.delete(API_CACHE),
      caches.delete(RUNTIME_CACHE),
      caches.delete(IMAGE_CACHE)
    ]);
  }
});

console.log('✅ Service Worker loaded successfully');
