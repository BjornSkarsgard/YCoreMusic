// Opt-in Windows desktop integration test. No credentials or API bodies are logged.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const driver=spawn(process.env.ENCORE_TAURI_DRIVER ?? 'tauri-driver',[
  '--port','4444','--native-driver',process.env.ENCORE_EDGE_DRIVER ?? resolve(root,'.tools/edgedriver/msedgedriver.exe')
],{windowsHide:true,stdio:'ignore',env:{...process.env,ENCORE_TEST_DATA_DIR:resolve(root,'.tools/native-test-data')}});
let session;
let originalVolume=null,volumeCaptured=false;
async function request(path,body,method=body===undefined?'GET':'POST') {
  const response=await fetch('http://127.0.0.1:4444'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const json=await response.json();
  if(!response.ok || json.value?.error) throw new Error('WebDriver request failed: '+(json.value?.error ?? response.status));
  return json.value;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function execute(script,args=[]) {return request('/session/'+session+'/execute/sync',{script,args});}
async function until(script,timeout=25000) {
  const end=Date.now()+timeout;
  do {if(await execute(script))return;await sleep(250);}while(Date.now()<end);
  const diagnostic=await execute('return {status:document.getElementById("status")?.textContent,source:document.getElementById("source-status")?.textContent,errors:window.nativeErrors}');
  throw new Error('Native condition timed out: '+script+' '+JSON.stringify(diagnostic));
}
async function nativeInvoke(cmd,args={}){return request('/session/'+session+'/execute/async',{script:'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(done).catch(()=>done(null));',args:[cmd,args]});}
async function mediaUntil(playback){for(let n=0;n<40;n++){const status=await nativeInvoke('media_status');if(status?.available&&status.playback===playback)return;await sleep(100);}throw new Error('Native media status did not become '+playback);}
async function click(id){await execute('document.getElementById(arguments[0]).click()', [id]);}
try {
  driver.on('error',()=>{});
  for(let attempt=0;attempt<40;attempt++){try{await request('/status');break;}catch{await sleep(250);}}
  const created=await request('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:resolve(root,'apps/desktop/src-tauri/target/debug/encore.exe')}}}});
  session=created.sessionId;
  await until('return !!document.getElementById("play")');
  await execute('window.nativeErrors=[];window.addEventListener("error",event=>window.nativeErrors.push(event.message));');
  assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
  originalVolume=await execute('return localStorage.getItem("encore.volume.v1")');volumeCaptured=true;
  console.log('Native startup without autoplay: PASS');
  const store=async(requestBody)=>request('/session/'+session+'/execute/async',{script:'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke("storage_command",{request:arguments[0]}).then(done).catch(()=>done({testError:true}));',args:[requestBody]});
  const storageStatus=await store({type:'status'});
  assert.equal(storageStatus.testMode,true,'Refuse storage tests against the personal database');
  assert.equal(storageStatus.available,true,'Test database unavailable');
  const fixture='native-fixture-'+Date.now();
  await store({type:'save_video',trackId:'123456789',videoId:'M7lc1UVf-VE'});
  assert.equal(await store({type:'get_video',trackId:'123456789'}),'M7lc1UVf-VE');
  const event={playbackId:fixture,trackId:'123456789',title:fixture,artist:'Test fixture',videoId:'M7lc1UVf-VE'};
  await store({type:'record',event});await store({type:'record',event});
  const history=await store({type:'history',query:fixture});
  assert.equal(history.length,1);
  await store({type:'clear_history'});
  assert.equal(await store({type:'get_video',trackId:'123456789'}),'M7lc1UVf-VE');
  await store({type:'remove_video',trackId:'123456789'});
  assert.equal(await store({type:'get_video',trackId:'123456789'}),null);
  console.log('Native isolated SQLite override/history/idempotency/clear: PASS');
  if(process.env.ENCORE_LIVE_YANDEX==='1') {
    await until('return document.querySelectorAll("#queue-list li").length>0');
    const count=await execute('return document.querySelectorAll("#queue-list li").length');
    await click('source-more');
    await until('return document.querySelectorAll("#queue-list li").length>'+count);
    console.log('Native source session + next batch via OS credential store: PASS (counts only)');
  }
  if(process.env.ENCORE_LIVE_CATALOGUE==='1') {
    const before=await execute('return document.getElementById("track-title").textContent');
    await execute('document.getElementById("catalogue-query").value="рамштайн";document.getElementById("catalogue-search").requestSubmit();');
    await until('return Array.from(document.querySelectorAll(".catalogue-card strong")).some(item=>item.textContent.toLowerCase()==="rammstein")');
    const headings=await execute('return Array.from(document.querySelectorAll("#catalogue-results h3")).map(item=>item.textContent)');
    for(const heading of ['Исполнители','Треки','Альбомы','Плейлисты']) assert(headings.includes(heading));
    await execute('Array.from(document.querySelectorAll(".catalogue-card strong")).find(item=>item.textContent.toLowerCase()==="rammstein").closest("button").click()');
    await until('return document.querySelectorAll("#catalogue-collection .catalogue-track").length>0');
    for(const heading of ['Альбомы','Плейлисты']) {
      await execute('Array.from(document.querySelectorAll("#catalogue-results section")).find(section=>section.querySelector("h3")?.textContent===arguments[0]).querySelector(".catalogue-card").click()',[heading]);
      await until('return document.querySelectorAll("#catalogue-collection .catalogue-track").length>0');
    }
    assert.equal(await execute('return document.getElementById("track-title").textContent'),before);
    await execute('document.getElementById("volume").value="0";document.getElementById("volume").dispatchEvent(new Event("input"));');
    await execute('window.expectedCatalogueTrack=document.querySelector("#catalogue-collection .catalogue-track span").textContent;document.querySelector("#catalogue-collection > button").click()');
    await until('return document.getElementById("track-title").textContent+" · "+document.getElementById("track-artist").textContent===window.expectedCatalogueTrack');
    assert(await execute('return document.querySelectorAll("#queue-list li").length>0'));
    console.log('Native catalogue: Cyrillic query, four sections, artist/album/playlist lists and selection: PASS');
  }
  if(process.env.ENCORE_LIVE_MATCHING==='1') {
    await until('return !document.getElementById("play").disabled || /Уверенного|недоступен|недоступны/.test(document.getElementById("status").textContent)',40000);
    const matched=await execute('return !document.getElementById("play").disabled');
    assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
    console.log(matched?'Native Yandex metadata -> automatic match -> IFrame cue without autoplay: PASS':'Native matching: PARTIAL (current track requires manual selection)');
  }
  if(process.env.ENCORE_LIVE_MATCHING==='1') {
    const candidates=await request('/session/'+session+'/execute/async',{script:'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke("search_videos",{title:"Wonderwall",artist:"Oasis"}).then(done).catch(()=>done(null));',args:[]});
    assert(Array.isArray(candidates) && candidates.length>0,'Known search fixture has no candidate');
    await execute('document.getElementById("url").value=arguments[0];document.getElementById("load").requestSubmit();',[candidates[0].id]);
    await until('return !document.getElementById("play").disabled',30000);
    assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
    console.log('Native known search fixture -> matching candidate -> real IFrame cue: PASS');
  }
  if(process.env.ENCORE_LIVE_YOUTUBE==='1') {
    await execute('document.getElementById("volume").value="0";document.getElementById("volume").dispatchEvent(new Event("input"));document.getElementById("url").value="M7lc1UVf-VE";document.getElementById("load").requestSubmit();');
    await until('return !document.getElementById("play").disabled',30000);
    assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
    await click('play');
    await until('return document.getElementById("status").textContent==="Воспроизведение"',30000);
    await mediaUntil('playing');
    const titleBeforeHide=await execute('return document.getElementById("track-title").textContent');
    const timeBeforeHide=await execute('return Number(document.getElementById("seek").value)');
    assert.equal((await nativeInvoke('desktop_status')).tray_available,true);
    await nativeInvoke('desktop_close');await sleep(4000);
    assert.equal((await nativeInvoke('desktop_status')).visible,false);
    assert(await execute('return Number(document.getElementById("seek").value)')>timeBeforeHide+1,'Hidden playback timeline did not advance');
    await nativeInvoke('desktop_action',{action:'open'});
    assert.equal((await nativeInvoke('desktop_status')).visible,true);
    assert.equal(await execute('return document.getElementById("track-title").textContent'),titleBeforeHide);
    await nativeInvoke('desktop_action',{action:'toggle'});
    await until('return document.getElementById("status").textContent==="Пауза"');
    await click('forward');
    await until('return Number(document.getElementById("seek").value)>=4');
    await mediaUntil('paused');
    await nativeInvoke('plugin:event|emit',{event:'power-monitor://suspend',payload:null});
    await nativeInvoke('plugin:event|emit',{event:'power-monitor://resume',payload:null});
    await until('return document.getElementById("status").textContent.includes("После сна · пауза")');
    await mediaUntil('paused');
    console.log('Native simulated suspend/resume event delivery: PASS (physical sleep not tested)');
    console.log('Native real YouTube cue, muted Play, close to tray, hidden timeline, restore, tray Pause, SMTC state, seek: PASS');
    await click('previous');
    await until('return Number(document.getElementById("seek").value)<1');
    assert.match(await execute('return document.getElementById("status").textContent'),/Пауза|пауза/);
    console.log('Native Previous restart preserves pause: PASS');
    let recorded=false;
    for(let attempt=0;attempt<15;attempt++){
      const rows=await store({type:'history',query:''});
      recorded=Array.isArray(rows)&&rows.some(entry=>entry.videoId==='M7lc1UVf-VE');
      if(recorded)break;await sleep(100);
    }
    assert(recorded,'Actual Play did not persist a history entry');
    console.log('Native actual Play -> SQLite history: PASS');
  }
  const rect=await request('/session/'+session+'/window/rect');
  await click('mini');
  await until('return document.body.classList.contains("compact")');
  const compact=await request('/session/'+session+'/window/rect');
  assert(compact.width<rect.width);
  await click('topmost');
  assert.equal(await nativeInvoke('window_topmost_state'),true);
  await click('topmost');
  assert.equal(await nativeInvoke('window_topmost_state'),false);
  await click('mini');
  await until('return !document.body.classList.contains("compact")');
  const restored=await request('/session/'+session+'/window/rect');
  assert.equal(restored.width,rect.width); assert.equal(restored.height,rect.height);
  console.log('Native mini resize/restore and OS topmost flag on/off: PASS');
  const maximized=await request('/session/'+session+'/window/maximize',{});
  await click('mini'); await until('return document.body.classList.contains("compact")');
  const miniFromMaximized=await request('/session/'+session+'/window/rect');
  assert(miniFromMaximized.width<maximized.width);
  await click('mini'); await until('return !document.body.classList.contains("compact")');
  const restoredMaximized=await request('/session/'+session+'/window/rect');
  assert.equal(restoredMaximized.width,maximized.width);
  console.log('Native mini from maximized window and restore: PASS');
  await request('/session/'+session+'/window/minimize',{});
  assert.equal((await nativeInvoke('desktop_status')).minimized,true);
  const extra=spawn(resolve(root,'apps/desktop/src-tauri/target/debug/encore.exe'),[],{windowsHide:true,stdio:'ignore'});
  const exited=await new Promise(resolve=>{const timeout=setTimeout(()=>{extra.kill();resolve(false);},5000);extra.on('close',()=>{clearTimeout(timeout);resolve(true);});});
  assert(exited,'Second instance did not exit');
  await execute('return document.title');
  assert.equal((await nativeInvoke('desktop_status')).minimized,false);
  console.log('Native single instance guard restores minimized existing window: PASS');
} finally {
  if(session && volumeCaptured) await execute('if(arguments[0]===null)localStorage.removeItem("encore.volume.v1");else localStorage.setItem("encore.volume.v1",arguments[0]);',[originalVolume]).catch(()=>{});
  if(session) await nativeInvoke('desktop_action',{action:'quit'}).catch(()=>{});
  if(session) await request('/session/'+session,undefined,'DELETE').catch(()=>{});
  if(process.platform==='win32') { await new Promise(resolve=>{const cleanup=spawn('taskkill',['/PID',String(driver.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});cleanup.on('close',resolve);cleanup.on('error',resolve);}); } else driver.kill();
}
