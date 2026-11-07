// Opt-in HTTPS relay and desktop integration. Trusts only the loopback fixture.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createHash, X509Certificate} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {request} from 'node:https';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

export async function launchRelay(root,dir) {
  if(process.env.ENCORE_REMOTE_PUBLIC_SMOKE==='1'){
    return {origin:'https://www.ycore-music.ru',stop:()=>{}};
  }
  mkdirSync(dir,{recursive:true});
  const cert=resolve(dir,'relay-test.pem'),key=resolve(dir,'key.pem'),config=resolve(dir,'openssl.cnf');
  writeFileSync(config,'[req]\ndistinguished_name=dn\n[dn]\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n');
  execFileSync(process.env.ENCORE_TEST_OPENSSL??'openssl',[
    'req','-new','-newkey','rsa:2048','-nodes','-x509','-days','1','-subj','/CN=YCore loopback test',
    '-config',config,'-extensions','ext','-keyout',key,'-out',cert,
  ],{windowsHide:true,stdio:'ignore',timeout:20000});
  const ca=readFileSync(cert);
  const spki=new X509Certificate(ca).publicKey.export({type:'spki',format:'der'});
  const fingerprint=createHash('sha256').update(spki).digest('base64');
  const reservation=createServer();
  await new Promise(done=>reservation.listen(0,'127.0.0.1',done));
  const port=reservation.address().port;
  await new Promise(done=>reservation.close(done));
  const origin='https://127.0.0.1:'+port;
  const relay=spawn(process.execPath,[resolve(root,'apps/remote-relay/server.mjs')],{
    windowsHide:true,stdio:['ignore','pipe','inherit'],
    env:{...process.env,YCORE_REMOTE_ORIGIN:origin,YCORE_REMOTE_PORT:String(port),
      YCORE_REMOTE_TEST_CERT:cert,YCORE_REMOTE_TEST_KEY:key},
  });
  try {
    await new Promise((done,fail)=>{
      const timer=setTimeout(()=>fail(Error('Test relay startup timed out')),10000);
      relay.once('error',fail);
      relay.once('exit',()=>fail(Error('Test relay exited')));
      relay.stdout.once('data',()=>{clearTimeout(timer);done();});
      relay.once('exit',()=>clearTimeout(timer));
    });
  } catch (error) {
    relay.kill();
    throw error;
  }
  return {origin,ca,fingerprint,stop:()=>relay.kill()};
}

export async function verifyRemote({root,execute,nativeInvoke,until,sleep,fixture}) {
  const {chromium}=createRequire(resolve(root,'apps/desktop/package.json'))('playwright');
  const args=fixture.fingerprint?[`--ignore-certificate-errors-spki-list=${fixture.fingerprint}`]:[];
  const browser=await chromium.launch({channel:'chrome',args});
  const origin=fixture.origin;
  let base;
  function http(path,{body,headers={}}={}) {
    return new Promise((done,fail)=>{
      const req=request(new URL('.'+path,base),{ca:fixture.ca,method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},timeout:5000},res=>{
        let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);
        res.on('end',()=>done({status:res.statusCode,text}));
      });
      req.on('error',fail);req.on('timeout',()=>req.destroy(Error('TLS request timed out')));
      req.end(body?JSON.stringify(body):undefined);
    });
  }
  const desktop=action=>nativeInvoke('remote_command',{action});
  async function openQr() {
    await execute("document.getElementById('remote-pair').click()");
    await until("return !!document.getElementById('remote-qr').dataset.pairUrl");
    return execute("return document.getElementById('remote-qr').dataset.pairUrl");
  }
  async function stopFromSettings() {
    await execute("document.getElementById('remote-stop').click()");
    await until("return document.getElementById('remote-stop').hidden");
  }
  async function pairDevice(page,url) {
    await page.goto(url);
    assert.equal(await page.evaluate(()=>window.isSecureContext),true);
    await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Компьютер подключён');
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await page.locator('#install[open]').waitFor();
    await page.locator('#install-later').click();
    assert.equal(new URL(page.url()).hash,'');
    assert.equal(await page.locator('#pair input').count(),0);
  }
  try {
    await until("return !!document.getElementById('remote-pair')");
    assert.equal(await execute("return document.querySelectorAll('#remote-settings input').length"),0);
    const firstUrl=await openQr();
    base=new URL(firstUrl);
    base.hash='';
    assert.equal(base.origin,origin);
    assert.equal((await http('/api/state')).status,401);
    const action={id:'12345678-1234-1234-1234-123456789abc',action:{type:'volume',level:27}};
    assert.equal((await http('/api/command',{body:action,headers:{Origin:origin}})).status,401);
    assert.equal((await http('/api/pair',{body:{code:'0'.repeat(64)},headers:{Origin:'https://other.invalid'}})).status,403);
    const manifest=JSON.parse((await http('/manifest.webmanifest')).text);
    assert.equal(manifest.display,'standalone');
    assert.deepEqual(manifest.icons.map(icon=>icon.sizes),['192x192','512x512']);

    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const page=await context.newPage();
    await pairDevice(page,firstUrl);
    assert.equal((await http('/api/state')).status,401);
    const [firstDevice]=(await desktop({type:'read'})).devices;
    assert(firstDevice?.id);
    const usedCode=new URLSearchParams(new URL(firstUrl).hash.slice(1)).get('pair');
    await sleep(400);
    assert.equal((await http('/api/pair',{body:{code:usedCode},headers:{Origin:origin}})).status,403);
    await until("return document.getElementById('remote-qr').hidden");
    const [deviceCookie]=await context.cookies(base.href);
    assert(deviceCookie?.httpOnly&&deviceCookie.secure&&deviceCookie.sameSite==='Strict');
    assert.equal(deviceCookie.path,base.pathname);
    assert.equal((await context.cookies(origin)).length,0,'Pairing cookie is scoped to this remote');
    const remaining=deviceCookie.expires-Date.now()/1000;
    assert(remaining>863990&&remaining<=864001,'Pairing grants ten days of inactivity');
    const cookie=deviceCookie.name+'='+deviceCookie.value;
    const headers={Origin:origin,Cookie:cookie};
    assert.equal((await http('/api/command',{body:action,headers:{...headers,Origin:'https://other.invalid'}})).status,403);
    assert.equal((await http('/api/command',{body:action,headers})).status,204);
    await until('return document.getElementById("volume").value==="27"');
    await page.locator('#volume').evaluate(element=>{element.value='35';element.dispatchEvent(new Event('change'));});
    await until('return document.getElementById("volume").value==="35"');
    assert.equal((await http('/api/command',{body:action,headers})).status,204);
    await sleep(150);
    assert.equal(await execute('return document.getElementById("volume").value'),'35','Duplicate command must not overwrite the newer one');
    await page.waitForFunction(()=>document.querySelector('#volume').value==='35');
    assert.equal(await page.evaluate(async()=>!!(await caches.match(new URL('./api/state',location.href)))),false,'Never cache private playback state');
    const beforeIdle=(await context.cookies(base.href))[0].expires;
    await sleep(1700);
    assert.equal((await context.cookies(base.href))[0].expires,beforeIdle,'Passive polling does not extend the lease');
    await page.locator('#repeat').click();
    await page.waitForFunction(()=>document.querySelector('#repeat').getAttribute('aria-label')==='Повтор трека');
    assert((await context.cookies(base.href))[0].expires>beforeIdle,'A phone command extends the lease');
    const clip=process.env.ENCORE_BASE_VIDEO_ID??'aqz-KE-bpKQ';
    await nativeInvoke('storage_command',{request:{type:'record',event:{
      playbackId:'remote-history-fixture',trackId:'123456780',title:'Remote history fixture',artist:'Test fixture',videoId:clip,
    }}});
    await page.locator('#menu-toggle').click();
    await page.locator('#history').click();
    const historyEntry=page.locator('#results').getByRole('button',{name:/Remote history fixture.*Test fixture/});
    await historyEntry.waitFor();
    await page.locator('#volume').evaluate(element=>{element.value='0';element.dispatchEvent(new Event('change'));});
    await until('return document.getElementById("volume").value==="0"');
    await historyEntry.click();
    await until('return document.getElementById("track-title").textContent==="Remote history fixture"');
    await page.locator('#queue').getByRole('button',{name:/Remote history fixture.*Test fixture/}).waitFor();
    assert.equal(await page.locator('#browse').isVisible(),false);
    assert.equal(await page.locator('#toggle svg').count(),1);
    const state=JSON.parse((await http('/api/state',{headers})).text);
    const current=state.queue.find(entry=>entry.current);
    const unknownClip={id:'12345678-1234-1234-1234-123456789aaa',action:{
      type:'clip',generation:state.queue_generation,ordinal:current.ordinal,id:'xxxxxxxxxxx',
    }};
    assert.equal((await http('/api/command',{body:unknownClip,headers})).status,400,'Reject video IDs that the PC did not offer');
    const clips = [
      {id:clip,title:'Текущий клип',current:true,views:123456,durationSeconds:187},
      {id:'dQw4w9WgXcQ',title:'Другой клип',current:false,needsReview:true},
    ];
    const stateRoute='**/api/state';
    const imagesRoute='https://i.ytimg.com/vi/**';
    await page.route(stateRoute,async route=>{
      const response=await http('/api/state',{headers});
      if(response.status!==200)return route.fulfill({status:response.status,body:response.text});
      await route.fulfill({json:{...JSON.parse(response.text),clips}});
    });
    await page.route(imagesRoute,route=>route.fulfill({
      contentType:'image/png',path:resolve(root,'apps/desktop/src-tauri/remote/192x192.png'),
    }));
    await page.locator('#menu-toggle').click();
    await page.locator('#clips').click();
    const cards=page.locator('#results .alternative-video');
    await cards.nth(1).waitFor();
    assert.equal(await cards.first().getAttribute('aria-pressed'),'true');
    assert.match(await cards.first().locator('small').textContent(),/123\s456 просмотров · 3:07/);
    assert.equal(await cards.nth(1).locator('small').textContent(),'просмотры неизвестны · длительность неизвестна · проверить исполнителя');
    await page.waitForFunction(()=>document.querySelector('.alternative-video img')?.naturalWidth>0);
    assert.equal(await cards.first().locator('img').evaluate(image=>image.getBoundingClientRect().width),108);
    await page.locator('#close-panel').click();
    await page.unroute(stateRoute);
    await page.unroute(imagesRoute);
    console.log('Native remote clip cards: thumbnail, metadata, selected state and legacy fallback: PASS');
    const staleReaction={id:'12345678-1234-1234-1234-123456789aab',action:{
      type:'reaction',generation:state.queue_generation+1,ordinal:current.ordinal,target:'like',active:true,
    }};
    assert.equal((await http('/api/command',{body:staleReaction,headers})).status,400,'Reject reactions for a stale track');
    console.log('Native remote history selection, queue and repeat: PASS');

    const other=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const otherPage=await other.newPage();
    await pairDevice(otherPage,await openQr());
    await otherPage.locator('#volume').evaluate(element=>{element.value='17';element.dispatchEvent(new Event('change'));});
    await page.waitForFunction(()=>document.querySelector('#volume').value==='17');
    await other.setOffline(true);
    await otherPage.waitForFunction(()=>document.querySelector('#toggle').disabled);
    await other.setOffline(false);
    await otherPage.waitForFunction(()=>document.querySelector('#connection').textContent==='Компьютер подключён');

    if(process.env.ENCORE_REMOTE_SEARCH_SMOKE==='1'){
      await page.locator('#query').fill('Rammstein Sonne');
      await page.locator('#query').press('Enter');
      await page.locator('#results').getByRole('button',{name:/Sonne.*Rammstein/}).first().waitFor({timeout:15000});
      await page.locator('#query').fill('Rammstein');
      await page.locator('#query').press('Enter');
      const artists=page.locator('#results h2').filter({hasText:'Исполнители'});
      await artists.locator('xpath=following-sibling::ol[1]').getByRole('button',{name:/Rammstein/i}).first().click();
      await page.getByRole('button',{name:'Воспроизвести список',exact:true}).waitFor({timeout:20000});
      assert(await page.locator('#browse').isVisible());
      assert(await page.locator('#toggle').evaluate(button=>{
        const bounds=button.getBoundingClientRect();
        return bounds.top>=0 && bounds.bottom<=innerHeight;
      }));
      await page.locator('#volume').evaluate(element=>{element.value='0';element.dispatchEvent(new Event('change'));});
      await until('return document.getElementById("volume").value==="0"');
      await page.getByRole('button',{name:'Воспроизвести список',exact:true}).click();
      await until('return /Rammstein/i.test(document.getElementById("source-name").textContent)');
      await page.waitForFunction(()=>document.querySelectorAll('#queue li').length>1);
      assert.equal(await page.locator('#browse').isVisible(),false);
      await page.locator('#menu-toggle').click();
      await page.locator('#chart').click();
      await page.getByRole('button',{name:'Включить чарт',exact:true}).waitFor({timeout:20000});
      await page.locator('#close-panel').click();
      await page.locator('#menu-toggle').click();
      const libraryResponse=page.waitForResponse(response=>response.url().endsWith('/api/music')
        && response.request().postDataJSON()?.type==='library');
      await page.locator('#library').click();
      const library=await libraryResponse;
      if (library.ok()) {
        await page.locator('#results').getByRole('button',{name:/Мне нравится/}).waitFor();
      } else {
        assert.equal(library.status(),403);
        await page.getByText(/Войти можно на ПК/).waitFor();
      }
      await page.locator('#close-panel').click();
      console.log('Native remote Yandex search, artist queue, chart and library access: PASS ('+library.status()+')');
      if (process.env.ENCORE_REMOTE_MUSIC_ACTIONS_SMOKE==='1' && library.ok()) {
        await page.locator('#menu-toggle').click();
        const station=await page.locator('#station').evaluate(select=>
          Array.from(select.options).find(option=>option.value.startsWith('genre:'))?.value);
        assert(station,'Expected a Yandex Wave genre');
        await page.locator('#station').selectOption(station);
        await page.locator('#wave').click();
        await until('return document.getElementById("source-name").textContent.startsWith("Моя волна · ")',35000);
        console.log('Native remote starts a Yandex genre Wave: PASS');
        await page.locator('#history').click();
        await page.locator('#results').getByRole('button',{name:/Remote history fixture.*Test fixture/}).first().click();
        await until('return document.getElementById("track-title").textContent==="Remote history fixture"');
        await page.locator('#queue button[aria-current=true]').filter({hasText:'Remote history fixture'}).waitFor();
        await page.locator('#like:not(:disabled)').waitFor({timeout:20000});
        const beforeLike=await page.locator('#like').getAttribute('aria-pressed');
        const likeReply=page.waitForResponse(response=>response.url().endsWith('/api/command')
          && response.request().postDataJSON()?.action?.target==='like');
        await page.locator('#like').click();
        assert.equal((await likeReply).status(),204);
        await until(`return !document.getElementById("like").disabled && document.getElementById("like").getAttribute("aria-pressed")!==${JSON.stringify(beforeLike)}`);
        await page.waitForFunction(previous=>document.querySelector('#like').getAttribute('aria-pressed')!==previous,beforeLike);
        await page.locator('#dislike').click();
        await page.locator('#undo-dislike').click({timeout:5000});
        await page.locator('#undo-dislike').waitFor({state:'hidden'});
        console.log('Native remote isolated like/dislike with undo: PASS');
      }
    }

    assert.equal(await execute('return localStorage.getItem("ycore.remote.enabled")'),'1');
    await desktop({type:'stop'});
    await execute('location.reload()');
    await until('return !!document.getElementById("remote-stop") && !document.getElementById("remote-stop").hidden',35000);
    assert.equal((await desktop({type:'read'})).origin,base.href.slice(0,-1)+'/');
    assert.equal(await execute('return document.getElementById("remote-qr").hidden'),true,'Restoring the server does not require another QR');
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Компьютер подключён');
    console.log('Native remote restores an enabled server on startup and reconnects the phone without QR: PASS');
    await stopFromSettings();
    assert.equal(await execute('return localStorage.getItem("ycore.remote.enabled")'),null,'Explicit Off is preserved');
    await page.reload();
    await page.locator('#pair-hint').filter({hasText:'Нет связи с приложением на ПК'}).waitFor();
    await page.locator('#pair-scan').waitFor();
    await page.locator('#pair-retry').click();
    const restarted=new URL(await openQr());
    restarted.hash='';
    assert.equal(restarted.href,base.href);
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Компьютер подключён');
    assert.equal(await page.locator('#install').isVisible(),false);
    await otherPage.waitForFunction(()=>document.querySelector('#connection').textContent==='Компьютер подключён');
    assert.equal((await desktop({type:'read'})).devices.length,2);
    const deviceFile=resolve(process.env.ENCORE_NATIVE_TEST_DATA_DIR,'remote-devices.json');
    assert(!readFileSync(deviceFile,'utf8').includes(deviceCookie.value),'Never persist the plaintext device token');
    await desktop({type:'revoke',id:firstDevice.id});
    assert.equal((await http('/api/command',{body:action,headers})).status,401);
    await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Телефон не подключён');
    await otherPage.locator('#volume').evaluate(element=>{element.value='0';element.dispatchEvent(new Event('change'));});
    await until('return document.getElementById("volume").value==="0"');
    assert.equal((await desktop({type:'read'})).devices.length,1);
    console.log('Native remote HTTPS: one-click QR, zero input, secure cookie, origin guard, dedup, two-device sync, reconnect and selective revocation: PASS');

    if(process.env.ENCORE_REMOTE_PLAYBACK_SMOKE==='1'){
      await otherPage.locator('#menu-toggle').click();
      await otherPage.locator('#history').click();
      await otherPage.locator('#results').getByRole('button',{name:/Remote history fixture.*Test fixture/}).first().click();
      await until('return document.getElementById("status").textContent==="Воспроизведение"');
      await otherPage.waitForFunction(()=>document.querySelector('#toggle').getAttribute('aria-label')==='Пауза');
      await otherPage.locator('#toggle').click();
      await until('return document.getElementById("status").textContent==="Пауза"');
      await otherPage.waitForFunction(()=>document.querySelector('#toggle').getAttribute('aria-label')==='Воспроизвести');
      console.log('Native remote real YouTube playback and pause: PASS');
    }
    await otherPage.evaluate(async()=>{
      const response=await fetch('./api/command',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:crypto.randomUUID(),action:{type:'pause'}}),
      });
      if(!response.ok)throw Error('Could not pause test playback');
    });
    await until('return document.getElementById("status").textContent!=="Воспроизведение"');
    await stopFromSettings();
    const savedDevices=JSON.parse(readFileSync(deviceFile,'utf8'));
    const expiredAt=Math.floor(Date.now()/1000)-1;
    savedDevices[0].last_used_at=expiredAt-864000;
    savedDevices[0].info.expires_at=expiredAt;
    writeFileSync(deviceFile,JSON.stringify(savedDevices));
    await openQr();
    await otherPage.reload();
    await otherPage.waitForFunction(()=>document.querySelector('#connection').textContent==='Телефон не подключён');
    assert.equal((await desktop({type:'read'})).devices.length,0);
    console.log('Native remote ten-day inactivity expiration and renewal: PASS');
    const installedPath = new URL(otherPage.url()).pathname;
    await stopFromSettings();
    const {randomBytes} = await import('node:crypto');
    writeFileSync(resolve(process.env.ENCORE_NATIVE_TEST_DATA_DIR,'remote-relay-key'),randomBytes(32).toString('hex'));
    const replacement = new URL(await openQr());
    assert.notEqual(replacement.pathname,installedPath,'The replacement PC has a new identity');
    const svg = await execute('return document.querySelector("#remote-qr svg").outerHTML');
    const qrPage = await other.newPage();
    await qrPage.setContent(svg);
    const qrImage = await qrPage.locator('svg').screenshot();
    await qrPage.close();
    await otherPage.locator('#pair-scan').click();
    await otherPage.locator('#scan-file').setInputFiles({
      name:'pc-qr.png',mimeType:'image/png',buffer:qrImage,
    });
    try {
      await otherPage.locator('#scanner').waitFor({state:'hidden',timeout:15000});
    } catch {
      throw Error('QR image scan did not finish: '+await otherPage.locator('#scan-status').textContent());
    }
    await otherPage.waitForFunction(()=>document.querySelector('#connection').textContent==='Компьютер подключён');
    assert.equal(new URL(otherPage.url()).pathname,installedPath,'Pair inside the installed app without navigating out of its scope');
    assert.equal(await otherPage.evaluate(()=>localStorage.getItem('ycore-remote-computer')),replacement.pathname);
    await otherPage.reload();
    await otherPage.waitForFunction(()=>document.querySelector('#connection').textContent==='Компьютер подключён');
    assert.equal(await otherPage.locator('#install').isVisible(),false,'Re-pairing does not offer a second installation');
    const stablePage = await other.newPage();
    await stablePage.goto(origin+'/remote/app/');
    await stablePage.waitForFunction(()=>document.querySelector('#connection').textContent==='Компьютер подключён');
    await stablePage.close();
    const [scannedDevice]=(await desktop({type:'read'})).devices;
    await desktop({type:'revoke',id:scannedDevice.id});
    await otherPage.waitForFunction(()=>document.querySelector('#connection').textContent==='Телефон не подключён');
    await openQr();
    const cameraSvg=await execute('return document.querySelector("#remote-qr svg").outerHTML');
    const cameraPage=await other.newPage();
    await cameraPage.setContent(cameraSvg);
    const cameraImage=await cameraPage.locator('svg').screenshot();
    await cameraPage.close();
    const cameraRoute='**/camera-qr-fixture.png';
    await otherPage.route(cameraRoute,route=>route.fulfill({contentType:'image/png',body:cameraImage}));
    await otherPage.evaluate(async()=>{
      const image=new Image();
      image.src='./camera-qr-fixture.png';
      await image.decode();
      const canvas=document.createElement('canvas');
      canvas.width=image.naturalWidth;
      canvas.height=image.naturalHeight;
      canvas.getContext('2d').drawImage(image,0,0);
      navigator.mediaDevices.getUserMedia=async()=>{
        const stream=canvas.captureStream(5);
        window.scannerFixtureTrack=stream.getVideoTracks()[0];
        const timer=setInterval(()=>{
          if(window.scannerFixtureTrack.readyState==='ended')clearInterval(timer);
          else canvas.getContext('2d').drawImage(image,0,0);
        },100);
        return stream;
      };
    });
    await otherPage.locator('#pair-scan').click();
    try {
      await otherPage.waitForFunction(()=>document.querySelector('#connection').textContent==='Компьютер подключён');
    } catch {
      const details=await otherPage.evaluate(()=>({
        status:document.getElementById('scan-status').textContent,
        camera:window.scannerFixtureTrack?.readyState,
        width:document.getElementById('scan-video').videoWidth,
        ready:document.getElementById('scan-video').readyState,
      }));
      throw Error('Simulated QR camera did not reconnect: '+JSON.stringify(details));
    }
    assert.equal(await otherPage.evaluate(()=>window.scannerFixtureTrack.readyState),'ended','Camera stops after reading the QR');
    await otherPage.unroute(cameraRoute);
    console.log('Native remote camera decoder reads QR frames and releases the camera after pairing: PASS (simulated camera)');
    await otherPage.locator('#volume').evaluate(element=>{element.value='0';element.dispatchEvent(new Event('change'));});
    await until('return document.getElementById("volume").value==="0"');
    console.log('Native remote scans a real QR image, changes PC inside the existing PWA and restores it from the stable launch URL: PASS');
  } finally {
    await browser.close();
    await desktop({type:'stop'});
  }
}
