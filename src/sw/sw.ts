/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { ExpirationPlugin } from 'workbox-expiration'
import { RangeRequestsPlugin } from 'workbox-range-requests'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] }

// App shell, JS/CSS, catalog data (bundled), anatomy maps, models and icons.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Client-side routes (including /shared#...) get the cached shell. Paths with a file extension are real files.
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${import.meta.env.BASE_URL}index.html`), { denylist: [/\/[^/]+\.[a-z0-9]+$/i, /^\/api\//, /^\/\.well-known\//] }))

// Exercise loops are cached on first play; Safari needs range responses for video.
registerRoute(
  ({ url, request }) => url.origin === self.location.origin && (request.destination === 'video' || url.pathname.startsWith(`${import.meta.env.BASE_URL}media/loops/`)),
  new CacheFirst({
    cacheName: 'gb-loops',
    plugins: [new RangeRequestsPlugin(), new ExpirationPlugin({ maxEntries: 400, purgeOnQuotaError: true })],
  }),
)

// Posters have hashed names, so a cached one never goes stale; offline, an unseen one falls back to the map card.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith(`${import.meta.env.BASE_URL}media/posters/`),
  new CacheFirst({ cacheName: 'gb-posters', plugins: [new ExpirationPlugin({ maxEntries: 600, purgeOnQuotaError: true })] }),
)

// A new version waits until the page asks it to take over (the in-app update prompt).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
