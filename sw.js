"use strict";

const CACHE_PREFIX = "edilkappa-professionale-";
const CACHE = `${CACHE_PREFIX}v28-foto-storiche-cantiere`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./privacy.html",
  "./manifest.json",
  "./professional-extensions.js",
  "./business-suite.js",
  "./client-archive.js",
  "./direct-search.js",
  "./smart-operations.js",
  "./danea-integration.js",
  "./completion-center.js",
  "./firebase-cloud.js",
  "./sharing-integration.js",
  "./quick-site-photos.js",
  "./richiesta.html",
  "./public-request.js",
  "./assets/icona-edilkappa.svg",
  "./assets/logo-edilkappa.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
    )
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const absoluteTarget = new URL(target, self.location.href).href;
      for (const client of windows) {
        if ("navigate" in client) await client.navigate(absoluteTarget);
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(absoluteTarget) : undefined;
    })
  );
});
