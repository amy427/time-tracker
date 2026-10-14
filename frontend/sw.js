/* App-shell caching only; authenticated traffic and Google identity are never cached. */
const CACHE='time-tracker-shell-94160625aa0c';
const FILES=['./','./index.html','./style.css','./core.js','./db.js','./transport.js','./ux.js','./app.js','./manifest.json','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('time-tracker-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('./index.html')));
  else event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
