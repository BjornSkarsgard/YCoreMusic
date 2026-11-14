const prefix='ycore-remote-shell:'+self.registration.scope+':';
const cacheName=prefix+'6';
const shell=['./','remote.css','remote.js','scanner.js','jsqr-1.4.0.js','manifest.webmanifest','icon-192.png','icon-512.png']
  .map(path=>new URL(path,self.registration.scope).href);

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(shell)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith(prefix)&&name!==cacheName).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||!shell.includes(url.href))return;
  event.respondWith((async()=>{
    try{return await fetch(event.request);}
    catch{
      const cached=await caches.match(event.request,{cacheName});
      return cached??Response.error();
    }
  })());
});
