// Tono's offline helper: keeps the app itself on the phone so it opens fast and without signal.
// Songs, battles and YouTube always go to the network; the song splitter has its own cache.
const SHELL = "tono-shell-v1";
const SKIP = /supabase\.co|youtube\.com|ytimg\.com|googleapis\.com\/youtube|lrclib\.net|googlevideo\.com/;
const LOCAL_SKIP = /\/(sep|sep-test|bp-model)\//;

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(SHELL);
      try {
        const r = await fetch("./", { cache: "no-store" });
        if (r.ok) {
          const html = await r.clone().text();
          await c.put("./", r.clone());
          await c.put("./index.html", r);
          const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
          await Promise.all(assets.map((a) => c.add(a).catch(() => {})));
        }
        await c.addAll(["./manifest.webmanifest", "./icons/icon-192.png"]).catch(() => {});
        // the styles and fonts the page loads from other sites
        const outside = [...html.matchAll(/(?:src|href)="(https:\/\/(?:cdn\.tailwindcss\.com|fonts\.googleapis\.com)[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
        await Promise.all(
          outside.map((u) =>
            fetch(u, { mode: "no-cors" }).then((r) => c.put(u, r)).catch(() => {}),
          ),
        );
      } catch (err) {}
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("tono-shell-") && k !== SHELL).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (SKIP.test(url.href)) return;
  if (url.origin === self.location.origin && LOCAL_SKIP.test(url.pathname)) return;

  // the page: newest from the network, the saved copy when offline
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const r = await fetch(req);
          if (r.ok) (await caches.open(SHELL)).put("./index.html", r.clone());
          return r;
        } catch (err) {
          return (await caches.match("./index.html", { ignoreVary: true })) || (await caches.match("./", { ignoreVary: true })) || Response.error();
        }
      })(),
    );
    return;
  }

  // built files have unique names, so a saved copy is always right
  if (url.origin === self.location.origin && url.pathname.includes("/assets/")) {
    e.respondWith(
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((r) => {
            if (r.ok) caches.open(SHELL).then((c) => c.put(req, r.clone()));
            return r;
          }),
      ),
    );
    return;
  }

  // fonts, styles and icons: answer from the saved copy, refresh it in the background
  const shared = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.tailwindcss\.com/.test(url.host);
  if (shared || (url.origin === self.location.origin && /\/icons\/|manifest\.webmanifest$/.test(url.pathname))) {
    e.respondWith(
      (async () => {
        const c = await caches.open(SHELL);
        const hit = await c.match(req, { ignoreVary: true });
        const net = fetch(req)
          .then((r) => {
            if (r.ok || r.type === "opaque") c.put(req, r.clone());
            return r;
          })
          .catch(() => hit || Response.error());
        return hit || net;
      })(),
    );
  }
});
