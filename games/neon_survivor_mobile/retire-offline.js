/* Compatibility cleanup only. No offline registration, downloads, or save-data writes. */
(() => {
  'use strict';
  async function clearNeonCache(scope) {
    if (!('caches' in globalThis)) return;
    for (const name of await caches.keys()) {
      if (!name.startsWith('neon-survivor-')) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (request.url.startsWith(scope)) await cache.delete(request);
      }
      // Legacy cache names were shared across paths. Keep other paths' entries.
      if (!(await cache.keys()).length) await caches.delete(name);
    }
  }
  globalThis.clearNeonCache = clearNeonCache;
  if (typeof document === 'undefined' || !/^https?:$/.test(location.protocol)) return;
  const scope = new URL('./', document.currentScript.src).href;
  const script = new URL('sw.js', scope).href;
  async function retire() {
    if ('serviceWorker' in navigator) {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
        if (registration.scope === scope && workers.some(worker => worker.scriptURL === script)) {
          try { await registration.update(); } catch { /* Retry on a later online visit. */ }
          await registration.unregister();
        }
      }
    }
    await clearNeonCache(scope);
  }
  retire().catch(() => {}); // Restricted browser storage must not prevent playing.
})();
