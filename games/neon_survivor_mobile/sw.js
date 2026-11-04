/* Retired offline worker. Keep this URL for existing installations.
 * No fetch handler: requests use the browser's normal network behavior.
 */
importScripts('./retire-offline.js');
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await self.registration.unregister();
    await clearNeonCache(self.registration.scope);
  })());
});
