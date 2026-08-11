"use strict";

const CACHE_PREFIX = "edilkappa-professionale-";
const CACHE = `${CACHE_PREFIX}v89-foto-sopralluogo-heic`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./privacy.html",
  "./manifest.json",
  "./modern-ui.css",
  "./media-contract.js",
  "./professional-extensions.js",
  "./business-suite.js",
  "./client-archive.js",
  "./direct-search.js",
  "./danea-integration.js",
  "./intervention-lifecycle.js",
  "./inspection-workflow.js",
  "./completion-center.js",
  "./bulk-sharing.js",
  "./hours-closeout.js",
  "./attendance-center.js",
  "./edilkappa-loader.js",
  "./firebase-cloud.js",
  "./sharing-integration.js",
  "./quick-site-photos.js",
  "./richiesta.html",
  "./public-request.js",
  "./assets/icona-edilkappa.svg",
  "./assets/logo-edilkappa.svg",
  "./linea-vita/assets/logo-edilkappa-pdf.jpg",
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
    caches.match(event.request, { ignoreSearch: true }).then(
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

try {
  importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js");
  firebase.initializeApp({
    projectId: "edilkappa-professionale",
    appId: "1:583702130706:web:598e050830cef19ea2a8cb",
    apiKey: "AIzaSyAWP8Frwm6gIQnIfaEwe639F5cSOs8wdiE",
    authDomain: "edilkappa-professionale.firebaseapp.com",
    messagingSenderId: "583702130706"
  });
  firebase.messaging().onBackgroundMessage((payload) => {
    const data = payload.data || {};
    return self.registration.showNotification(data.title || "Nuovo avviso EdilKappa", {
      body: data.body || "Apri il gestionale per controllare.",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: data.eventId || "edilkappa-push",
      data: { url: data.url || "./?activity=push" }
    });
  });
} catch (error) {
  console.warn("Firebase Messaging non disponibile", error);
}
