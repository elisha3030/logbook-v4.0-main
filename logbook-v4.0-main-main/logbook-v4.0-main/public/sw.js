const CACHE_NAME = 'logbook-v2-cache-v3';
const ASSETS = [
    '/',
    '/index.html',
    '/dashboard.html',
    '/scan.html',
    '/history.html',
    '/students.html',
    '/settings.html',
    '/css/style.css',
    '/js/lucide.js',
    '/vendor/tailwindcss.js',
    '/js/offline-registry.js',
    '/js/settings.js',
    '/js/scan.js',
    '/js/students.js',
    '/js/logs.js',
    '/js/history.js',
    '/js/auth.js',
    '/js/firebase.js'
];

// Install Event - Cache assets
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('👷 Service Worker: Caching Assets (v3)');
            return cache.addAll(ASSETS);
        })
    );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then(keys => {
                return Promise.all(
                    keys.filter(key => key !== CACHE_NAME)
                        .map(key => caches.delete(key))
                );
            })
        ])
    );
});

// Fetch Event
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip API calls
    if (url.pathname.startsWith('/api/')) return;
    if (url.origin !== self.location.origin) return;

    // Strategy: Network First for HTML and JS (to ensure latest logic)
    if (event.request.mode === 'navigate' || url.pathname.endsWith('.js')) {
        event.respondWith(
            fetch(event.request)
                .then(networkResponse => {
                    return caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Strategy: Stale-While-Revalidate for CSS and other assets
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            const fetchPromise = fetch(event.request).then(networkResponse => {
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, networkResponse.clone());
                });
                return networkResponse;
            });
            return cachedResponse || fetchPromise;
        })
    );
});
