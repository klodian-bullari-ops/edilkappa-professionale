"use strict";

const CACHE_NAME = "edilkappa-linea-vita-v1.0.0";
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "assets/02_logo_orizzontale_petto_nero.svg",
  "assets/03_icona_edilkappa_nera.svg",
  "assets/logo-edilkappa.png",
  "assets/logo-edilkappa-pdf.jpg",
  "assets/fonts/DejaVuSans-EdilKappa.ttf",
  "assets/fonts/DejaVuSans-Bold-EdilKappa.ttf",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "vendor/jspdf.umd.min.js",
  "vendor/jspdf.plugin.autotable.min.js",
  "js/data.js",
  "js/db.js",
  "js/pdf.js",
  "js/views.js",
  "js/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
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
          caches.open(CACHE_NAME).then((cache) => cache.put("index.html", copy));
          return response;
        })
        .catch(() => caches.match("index.html"))
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
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
    )
  );
});
