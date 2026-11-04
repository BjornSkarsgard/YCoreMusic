// Opt-in Windows / Linux X11 desktop integration test. No credentials or API bodies are logged.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {existsSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=process.cwd();
const backgroundSmoke=process.env.ENCORE_AUTOSTART_SMOKE==='1';
const nativeApp=resolve(root,'apps/desktop/src-tauri/target/native-test/'+(process.platform==='win32'?'encore.exe':'encore'));
const nativeDriver=process.env.ENCORE_NATIVE_DRIVER??(process.platform==='win32'?(process.env.ENCORE_EDGE_DRIVER??resolve(root,'.tools/edgedriver/msedgedriver.exe')):'/usr/bin/WebKitWebDriver');
assert(existsSync(nativeApp),'Build the native-test profile first; see README native smoke instructions.');
const nativeEnvironment={...process.env,ENCORE_TEST_DATA_DIR:process.env.ENCORE_NATIVE_TEST_DATA_DIR??resolve(root,'.tools/native-test-data')};
const driver=spawn(process.env.ENCORE_TAURI_DRIVER ?? 'tauri-driver',[
  '--port','4444','--native-driver',nativeDriver
],{windowsHide:true,stdio:'ignore',env:nativeEnvironment});
let session,appPid,isolated=false,networkEmulated=false;
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
async function network(offline){
  await request('/session/'+session+'/ms/cdp/execute',{cmd:'Network.emulateNetworkConditions',params:{offline,latency:0,downloadThroughput:-1,uploadThroughput:-1}});
  networkEmulated=offline;
}
async function commandUntil(command,expected){let actual;for(let n=0;n<50;n++){actual=await nativeInvoke(command);if(actual===expected)return;await sleep(100);}throw new Error('Native command state did not settle: '+command+' '+JSON.stringify(actual));}
async function desktopUntil(field,expected){for(let n=0;n<50;n++){if((await nativeInvoke('desktop_status'))?.[field]===expected)return;await sleep(100);}throw new Error('Native window state did not settle: '+field);}
async function mediaUntil(playback){for(let n=0;n<40;n++){const status=await nativeInvoke('media_status');if(status?.available&&status.playback===playback)return;await sleep(100);}throw new Error('Native media status did not become '+playback);}
async function click(id){await execute('document.getElementById(arguments[0]).click()', [id]);}
try {
  driver.on('error',()=>{});
  for(let attempt=0;attempt<40;attempt++){try{await request('/status');break;}catch{await sleep(250);}}
  const created=await request('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:nativeApp,args:backgroundSmoke?['--encore-autostart']:[]}}}});
  session=created.sessionId;
  await until('return !!document.getElementById("play")');
  await execute('window.nativeErrors=[];window.addEventListener("error",event=>window.nativeErrors.push(event.message));');
  assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
  originalVolume=await execute('return localStorage.getItem("encore.volume.v1")');volumeCaptured=true;
  console.log('Native startup without autoplay: PASS');
  const store=async(requestBody)=>request('/session/'+session+'/execute/async',{script:'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke("storage_command",{request:arguments[0]}).then(done).catch(()=>done({testError:true}));',args:[requestBody]});
  const storageStatus=await store({type:'status'});
  assert.equal(storageStatus.testMode,true,'Refuse storage tests against the personal database');
  isolated=true;
  appPid=(await nativeInvoke('desktop_status')).process_id;
  assert(Number.isInteger(appPid),'Native test process identity unavailable');
  assert.equal(storageStatus.available,true,'Test database unavailable');
  if(backgroundSmoke){
    const desktop=await nativeInvoke('desktop_status');assert.equal(desktop.visible,!desktop.tray_available,'Autostart should stay hidden when tray is available');
    assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
    await nativeInvoke('desktop_action',{action:'open'});
    console.log('Native autostart argument -> tray without autoplay, explicit Open restores: PASS');
  }
  const autostartBefore=await nativeInvoke('autostart_status');assert.equal(autostartBefore.canChange,false);
  assert.equal(await nativeInvoke('autostart_set',{enabled:true}),null,'Isolated tests must not write autostart');
  assert.deepEqual(await nativeInvoke('autostart_status'),autostartBefore);
  console.log('Native autostart read and isolated mutation guard: PASS (no OS setting written)');
  const diagnostics=await nativeInvoke('diagnostics_status',{checkYandex:false});assert.equal(diagnostics.storageAvailable,true);assert.equal(typeof diagnostics.version,'string');
  assert.deepEqual(Object.keys(diagnostics).sort(),['architecture','platform','storageAvailable','version','yandex']);
  if(process.env.ENCORE_LIVE_LIBRARY==='1')assert.equal((await nativeInvoke('diagnostics_status',{checkYandex:true})).yandex,'connected');
  console.log('Native diagnostics health and identity-free response: PASS');


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
  // Exercise the real storage bridge and history UI only after testMode confirmation.
  for(let i=0;i<105;i++)await store({type:'record',event:{...event,playbackId:fixture+'-page-'+i}});
  await execute('document.querySelector("[data-panel=history]").click();document.getElementById("history-query").value=arguments[0];document.getElementById("history-query").dispatchEvent(new Event("input"));',[fixture]);
  await until('return document.querySelectorAll("#history-list li").length===100&&!document.getElementById("history-more").hidden');
  const newestPage=await store({type:'history',query:fixture});
  await store({type:'record',event:{...event,playbackId:fixture+'-after-page'}});
  const olderPage=await store({type:'history',query:fixture,beforeId:newestPage.at(-1).id});
  assert.equal(olderPage.length,5);assert(olderPage.every(row=>row.id<newestPage.at(-1).id));
  const now=Math.floor(Date.now()/1000);
  assert.equal((await store({type:'history',query:fixture,from:now-600,until:now+3600})).length,100);
  assert.equal((await store({type:'history',query:fixture,from:now+86400})).length,0);

  await click('history-more');
  await until('return document.querySelectorAll("#history-list li").length===105&&document.getElementById("history-more").hidden');
  await execute('const date=new Date(),today=date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");document.getElementById("history-from").value=today;document.getElementById("history-until").value=today;document.getElementById("history-from").dispatchEvent(new Event("change"));');
  await until('return document.querySelectorAll("#history-list li").length===100');await click('history-more');
  await until('return document.querySelectorAll("#history-list li").length===106');
  assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
  await click('history-clear');await click('clear-confirm');
  await until('return !document.getElementById("clear-dialog").open&&document.querySelectorAll("#history-list li").length===0');
  assert.equal((await store({type:'history',query:fixture})).length,0);
  await execute('document.getElementById("history-query").value="";document.getElementById("history-query").dispatchEvent(new Event("input"));');
  await click('history-period-clear');
  console.log('Native history cursor pagination, inclusive local date period, concurrent new play and confirmed clear: PASS');
  if(process.env.ENCORE_LIVE_YANDEX==='1') {
    await until('return document.querySelectorAll("#queue-list li").length>0');
    const count=await execute('return document.querySelectorAll("#queue-list li").length');
    await click('source-more');
    await until('return document.querySelectorAll("#queue-list li").length>'+count);
    console.log('Native source session + next batch via OS credential store: PASS (counts only)');
  }
  if(process.env.ENCORE_LIVE_CATALOGUE==='1') {
    await until('return document.querySelectorAll("#queue-list li").length>0');
    const before=await execute('return document.getElementById("track-title").textContent');
    await execute('document.getElementById("catalogue-query").value="рамштайн";document.getElementById("catalogue-search").requestSubmit();');
    await until('return Array.from(document.querySelectorAll(".catalogue-card strong")).some(item=>item.textContent.toLowerCase()==="rammstein")');
    const headings=await execute('return Array.from(document.querySelectorAll("#catalogue-results h3")).map(item=>item.textContent)');
    for(const heading of ['Исполнители','Треки','Альбомы','Плейлисты']) assert(headings.includes(heading));
    await execute('Array.from(document.querySelectorAll(".catalogue-card strong")).find(item=>item.textContent.toLowerCase()==="rammstein").closest("button").click()');
    await until('return document.querySelectorAll("#catalogue-collection .catalogue-track").length>0');
    for(const heading of ['Альбомы','Плейлисты']) {
      await click('catalogue-back');
      await execute('Array.from(document.querySelectorAll("#catalogue-results section")).find(section=>section.querySelector("h3")?.textContent===arguments[0]).querySelector(".catalogue-card").click()',[heading]);
      await until('return document.querySelectorAll("#catalogue-collection .catalogue-track").length>0');
    }
    assert.equal(await execute('return document.getElementById("track-title").textContent'),before);
    await execute('document.getElementById("volume").value="0";document.getElementById("volume").dispatchEvent(new Event("input"));');
    await execute('window.expectedCatalogueTrack=document.querySelector("#catalogue-collection .catalogue-track strong").textContent+" · "+document.querySelector("#catalogue-collection .catalogue-track small").textContent;document.getElementById("catalogue-play-all").click()');
    await until('return document.getElementById("track-title").textContent+" · "+document.getElementById("track-artist").textContent===window.expectedCatalogueTrack');
    assert(await execute('return document.querySelectorAll("#queue-list li").length>0'));
    console.log('Native catalogue: Cyrillic query, four sections, artist/album/playlist lists and selection: PASS');
  }
  if(process.env.ENCORE_LIVE_LIBRARY==='1') {
    await until('return document.querySelectorAll("#queue-list li").length>0');
    const before=await execute('return document.getElementById("track-title").textContent');
    await execute('document.querySelector("[data-panel=library]").click()');
    await until('return !!document.getElementById("library-likes")');
    await click('library-likes');
    await until('return document.querySelectorAll("#library-content .catalogue-track").length>0');
    assert.equal(await execute('return document.getElementById("track-title").textContent'),before);
    await execute('document.querySelector("[data-panel=discovery]").click()');
    await until('return document.querySelectorAll(".discovery-track").length>0');
    assert.equal(await execute('return document.getElementById("track-title").textContent'),before);
    assert.equal(await nativeInvoke('feedback_command',{request:{type:'sync'}}),null,'Test mode must block live feedback writes');
    const reaction=await nativeInvoke('feedback_command',{request:{type:'get',trackId:'56806178'}});
    assert(reaction&&[-1,0,1].includes(reaction.state)&&Number.isInteger(reaction.generation),'Native reaction read unavailable');
    assert(Array.isArray(reaction.excludedTrackIds),'Native confirmed reaction snapshot unavailable');
    writeFileSync(resolve(root,'.tools/native-discovery.png'),Buffer.from(await request('/session/'+session+'/screenshot'),'base64'));
    console.log('Native personal library, likes metadata and current chart browsing: PASS; live feedback writes blocked');
  }
  if(process.env.ENCORE_LIVE_ALTERNATIVES==='1'||process.env.ENCORE_LIVE_FAVORITES==='1') {
    const results=await nativeInvoke('catalogue_search',{query:'Oasis Wonderwall',page:0});
    const track=results.tracks.find(track=>track.artist.includes('Oasis')&&track.title.toLowerCase().includes('wonderwall'));
    assert(track,'Known real alternative-video fixture not found');
    await store({type:'remove_video',trackId:track.id});
    await execute('document.getElementById("volume").value="0";document.getElementById("volume").dispatchEvent(new Event("input"));window.alternativeFixture=arguments[0];document.getElementById("catalogue-query").value="Oasis Wonderwall";document.getElementById("catalogue-search").requestSubmit();',[track.title]);
    await until('return Array.from(document.querySelectorAll("#catalogue-results .catalogue-track")).some(row=>row.querySelector("strong").textContent===window.alternativeFixture&&row.querySelector("small").textContent.includes("Oasis"))');
    await execute('Array.from(document.querySelectorAll("#catalogue-results .catalogue-track")).find(row=>row.querySelector("strong").textContent===window.alternativeFixture&&row.querySelector("small").textContent.includes("Oasis")).querySelector("button").click()');
    await until('return document.querySelectorAll(".alternative-video").length>1 && document.getElementById("status").textContent==="Воспроизведение"',45000);
    await until('return Array.from(document.querySelectorAll(".alternative-video img")).some(image=>image.complete&&image.naturalWidth>0)');
    await execute('const button=document.querySelector(".alternative-video[aria-pressed=false]");window.alternativeExpected=button.querySelector("strong").textContent;button.click()');
    await until('return document.querySelector(".alternative-video[aria-pressed=true] strong")?.textContent===window.alternativeExpected && document.getElementById("status").textContent==="Воспроизведение"',45000);
    assert.equal(await execute('return document.getElementById("track-title").textContent'),track.title);
    assert.equal(await execute('return document.querySelectorAll("iframe").length'),1);
    await click('pause');
    writeFileSync(resolve(root,'.tools/native-alternatives.png'),Buffer.from(await request('/session/'+session+'/screenshot'),'base64'));
    console.log('Native real alternative video switch: preview, same track, one IFrame, explicit play preserved, muted: PASS');
    if(process.env.ENCORE_LIVE_FAVORITES==='1'){
      const candidates=await nativeInvoke('search_videos',{title:track.title,artist:track.artist});
      assert(candidates.length>1);for(const candidate of candidates.slice(0,2))await store({type:'save_video',trackId:track.id,videoId:candidate.id});
      await execute('document.querySelector(".alternative-video[aria-pressed=true]").click()');
      await until('return !document.getElementById("play").disabled');
      await click('edit-video');await until('return document.querySelectorAll("#favorite-list .favorite-row").length===2');await click('close-video-dialog');
      await click('repeat');await click('play');await until('return document.getElementById("status").textContent==="Воспроизведение"');
      for(let count=0;count<2;count++){
        await execute('window.favoritePrevious=new URL(document.querySelector(".alternative-video[aria-pressed=true] img").src).pathname.split("/")[2];const seek=document.getElementById("seek");seek.value=String(Number(seek.max)-1);seek.dispatchEvent(new Event("input"));seek.dispatchEvent(new Event("change"));');
        await until('return new URL(document.querySelector(".alternative-video[aria-pressed=true] img").src).pathname.split("/")[2]!==window.favoritePrevious && document.getElementById("status").textContent==="Воспроизведение"',45000);
      }
      await until('return document.getElementById("save-current-video").getAttribute("aria-pressed")==="true"');
      await click('save-current-video');await until('return document.getElementById("save-current-video").getAttribute("aria-pressed")==="false"');
      assert.equal((await store({type:'get_videos',trackId:track.id})).videos.length,1);
      assert.equal(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
      await click('repeat');await click('repeat');await click('pause');
      await click('edit-video');writeFileSync(resolve(root,'.tools/native-favorites.png'),Buffer.from(await request('/session/'+session+'/screenshot'),'base64'));await click('close-video-dialog');
      console.log('Native two saved clips: repeat-one alternates at real END; removing a favorite keeps playback: PASS');
    }
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
  if(process.env.ENCORE_LIVE_SMART_HISTORY==='1'){
    await store({type:'clear_history'});
    await store({type:'record',event:{playbackId:'native-smart-seed',trackId:'manual:M7lc1UVf-VE',title:'Native history fixture',artist:'',videoId:'M7lc1UVf-VE'}});
    const pool=await nativeInvoke('smart_history_fetch');assert(pool.length>0&&pool.every(track=>track.weight>0));
    await execute('document.getElementById("volume").value="0";document.getElementById("volume").dispatchEvent(new Event("input"));document.querySelector("[data-panel=history]").click();document.getElementById("history-smart").click()');
    await until('return document.getElementById("source-name").textContent==="Умная история" && document.getElementById("status").textContent==="Воспроизведение"',45000);
    await execute('window.smartOrdinal=document.querySelector("#queue-list li[aria-current=true]").dataset.ordinal;const seek=document.getElementById("seek");seek.value=String(Number(seek.max)-1);seek.dispatchEvent(new Event("input"));seek.dispatchEvent(new Event("change"));');
    await until('return document.querySelector("#queue-list li[aria-current=true]").dataset.ordinal!==window.smartOrdinal && document.getElementById("status").textContent==="Воспроизведение"',45000);
    assert.equal(await execute('return document.getElementById("source-name").textContent'),'Умная история');assert.equal(await execute('return document.querySelectorAll("iframe").length'),1);await click('pause');
    console.log('Native local Smart History: known clip, explicit Play, real END continuation, one IFrame and sticky source: PASS');
  }
  if(process.env.ENCORE_LIVE_YOUTUBE==='1') {
    await execute('document.getElementById("volume").value="0";document.getElementById("volume").dispatchEvent(new Event("input"));document.getElementById("url").value="M7lc1UVf-VE";document.getElementById("load").requestSubmit();');
    await until('return !document.getElementById("play").disabled',30000);
    assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
    await click('play');
    await until('return document.getElementById("status").textContent==="Воспроизведение"',30000);
    await mediaUntil('playing');
    assert.equal(await execute('return getComputedStyle(document.getElementById("player")).pointerEvents'),'none');
    assert.equal(await execute('return new URL(document.getElementById("player").src).searchParams.get("controls")'),'0');
    await execute('document.querySelector(".workspace").scrollIntoView({block:"start"})');
    const frameElement=await request('/session/'+session+'/element',{using:'css selector',value:'#player'});
    await request('/session/'+session+'/actions',{actions:[{type:'pointer',id:'video-hover',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:200,origin:frameElement,x:0,y:0}]}]});
    const readYouTube=async(script)=>{
      const frame=await request('/session/'+session+'/element',{using:'css selector',value:'#player'});
      await request('/session/'+session+'/frame',{id:frame});
      try{return await execute(script);}finally{await request('/session/'+session+'/frame',{id:null});}
    };
    const captionState=async(expected)=>{
      for(let attempt=0;attempt<25;attempt++){
        if(await readYouTube('return document.getElementById("movie_player")?.isSubtitlesOn?.()')===expected)return;
        await sleep(100);
      }
      throw new Error('YouTube actual caption state did not become '+expected);
    };
    const chromeVisible='function visible(selector){let item=document.querySelector(selector);if(!item||!item.getBoundingClientRect().width)return false;for(;item;item=item.parentElement){const style=getComputedStyle(item);if(style.display==="none"||style.visibility==="hidden"||Number(style.opacity)===0)return false;}return true;}return {top:visible(".ytp-chrome-top"),bottom:visible(".ytp-chrome-bottom")}';
    await sleep(3500);
    assert.deepEqual(await readYouTube(chromeVisible),{top:false,bottom:false},'YouTube chrome appeared on hover');
    await click('forward');await sleep(1000);
    assert.deepEqual(await readYouTube(chromeVisible),{top:false,bottom:false},'YouTube chrome appeared after custom seek');
    await until('return !document.getElementById("captions").disabled && document.getElementById("captions").options.length>1');
    await captionState(false);
    const captionValue=await execute('const select=document.getElementById("captions");select.selectedIndex=1;select.dispatchEvent(new Event("change"));document.getElementById("caption-size").value="1";document.getElementById("caption-size").dispatchEvent(new Event("change"));return select.value');
    await sleep(1000);await click('pause');await click('play');await until('return document.getElementById("status").textContent==="Воспроизведение"');
    assert.equal(await execute('return document.getElementById("captions").value'),captionValue);
    await captionState(true);
    await execute('document.getElementById("captions").value="off";document.getElementById("captions").dispatchEvent(new Event("change"))');
    await sleep(1000);await click('pause');await click('play');await until('return document.getElementById("status").textContent==="Воспроизведение"');
    assert.equal(await execute('return document.getElementById("captions").value'),'off');
    await captionState(false);
    const rowsBeforeSettings=(await store({type:'history',query:''})).length;
    const timeBeforeSettings=await execute('return Number(document.getElementById("seek").value)');
    await click('youtube-settings');await until('return document.getElementById("status").textContent==="Воспроизведение"');
    assert.equal(await execute('return getComputedStyle(document.getElementById("player")).pointerEvents'),'auto');
    await click('youtube-settings');await until('return document.getElementById("status").textContent==="Воспроизведение"');await sleep(1000);
    assert.equal(await execute('return getComputedStyle(document.getElementById("player")).pointerEvents'),'none');
    assert(await execute('return Number(document.getElementById("seek").value)')>=timeBeforeSettings-3,'Settings reload lost position');
    assert.equal((await store({type:'history',query:''})).length,rowsBeforeSettings,'Settings reload duplicated history');
    await sleep(3500);
    const shotRect=await request('/session/'+session+'/window/rect');
    await request('/session/'+session+'/window/rect',{width:1200,height:1200});
    await execute('document.querySelector(".workspace").scrollIntoView({block:"start"})');
    writeFileSync(resolve(root,'.tools/native-custom-player.png'),Buffer.from(await request('/session/'+session+'/screenshot'),'base64'));
    await request('/session/'+session+'/window/rect',shotRect);
    console.log('Native clean hover/custom seek, real caption on/off, settings position/history preservation: PASS');
    const frameBeforeFullscreen=await execute('return document.getElementById("player").src');
    const clickFullscreen=async()=>{
      if(await execute('return !!document.fullscreenElement')) {
        const workspace=await request('/session/'+session+'/element',{using:'css selector',value:'.workspace'});
        await request('/session/'+session+'/actions',{actions:[{type:'pointer',id:'fullscreen-motion',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:200,origin:workspace,x:0,y:-100}]}]});
        await until('return getComputedStyle(document.querySelector(".player-hud")).opacity==="1"');
      }
      const button=await request('/session/'+session+'/element',{using:'css selector',value:'#fullscreen'});
      await request('/session/'+session+'/element/'+button['element-6066-11e4-a52e-4f735466cecf']+'/click',{});
    };
    await clickFullscreen();await until('return document.fullscreenElement?.classList.contains("workspace")');
    const fullscreenSurface=await request('/session/'+session+'/element',{using:'css selector',value:'.workspace'});
    await request('/session/'+session+'/actions',{actions:[{type:'pointer',id:'fullscreen-idle',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:200,origin:fullscreenSurface,x:0,y:-100}]}]});
    await until('return getComputedStyle(document.querySelector(".player-hud")).opacity==="0"');
    assert.equal(await execute('return document.querySelectorAll("iframe#player").length'),1);
    await clickFullscreen();await until('return !document.fullscreenElement');
    assert.equal(await execute('return document.getElementById("player").src'),frameBeforeFullscreen);
    console.log('Native custom fullscreen enters/exits with the same IFrame: PASS');
    await clickFullscreen();await until('return !!document.fullscreenElement');
    await click('youtube-settings');await until('return document.querySelector(".screen").classList.contains("interactive") && document.getElementById("status").textContent==="Воспроизведение"');
    const interactiveVideo=await request('/session/'+session+'/element',{using:'css selector',value:'#player'});
    await request('/session/'+session+'/actions',{actions:[{type:'pointer',id:'quality-frame-hover',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:200,origin:interactiveVideo,x:0,y:0}]}]});
    await sleep(4000);assert.equal(await execute('return getComputedStyle(document.querySelector(".player-hud")).opacity'),'1');
    await click('youtube-settings');await until('return !document.querySelector(".screen").classList.contains("interactive") && document.getElementById("status").textContent==="Воспроизведение"');
    await clickFullscreen();await until('return !document.fullscreenElement');
    assert.equal(await execute('return document.querySelectorAll("iframe").length'),1);
    console.log('Native fullscreen quality panel retains reachable custom controls while iframe captures the pointer: PASS');
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
    const beforeHistoryQueue=await execute('return document.querySelectorAll("#queue-list li").length');
    const currentHistoryTitle=await execute('return document.getElementById("track-title").textContent');
    await execute('document.getElementById("history-panel").open=true;document.getElementById("history-refresh").click()');
    await until('return document.querySelectorAll("#history-list li").length>0');
    await execute('const row=document.querySelector("#history-list li");Array.from(row.querySelectorAll("button")).find(button=>button.textContent==="Следом").click();Array.from(row.querySelectorAll("button")).find(button=>button.textContent==="В конец").click();');
    assert.equal(await execute('return document.querySelectorAll("#queue-list li").length'),beforeHistoryQueue?beforeHistoryQueue+2:3);
    assert.equal(await execute('return document.getElementById("track-title").textContent'),currentHistoryTitle);
    await click('queue-next');await until('return !document.getElementById("play").disabled');
    assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
    console.log('Native history Next/Append preserve current paused clip and cue saved video without autoplay: PASS');
    await execute('Array.from(document.querySelector("#history-list li").querySelectorAll("button")).find(button=>button.textContent==="Воспроизвести").click()');
    await until('return document.getElementById("status").textContent==="Воспроизведение"');
    await click('pause');await mediaUntil('paused');
    const repeatedTitle=await execute('return document.getElementById("track-title").textContent');
    await click('repeat');await click('repeat');
    assert.equal(await execute('return document.getElementById("repeat").textContent'),'Повтор: очередь');
    await click('queue-next');await until('return !document.getElementById("play").disabled');
    assert.equal(await execute('return document.querySelectorAll("#queue-list li").length'),1);
    assert.equal(await execute('return document.getElementById("track-title").textContent'),repeatedTitle);
    assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
    console.log('Native finite queue repeat via Next wraps while paused without autoplay: PASS');
    await execute('document.body.tabIndex=-1;document.body.focus()');
    const press=async(value)=>request('/session/'+session+'/actions',{actions:[{type:'key',id:'encore-local',actions:[{type:'keyDown',value},{type:'keyUp',value}]}]});
    await press(' ');await until('return document.getElementById("status").textContent==="Воспроизведение"');
    await press(' ');await until('return document.getElementById("status").textContent==="Пауза"');
    console.log('Native local Space Play/Pause through WebDriver keyboard input: PASS');
  }
  if(process.env.ENCORE_LIVE_RECOVERY==='1'){
    await store({type:'record',event:{playbackId:fixture+'-recovery',trackId:'manual:M7lc1UVf-VE',title:'Native recovery fixture',artist:'',videoId:'M7lc1UVf-VE'}});
    await execute('document.getElementById("volume").value="0";document.getElementById("volume").dispatchEvent(new Event("input"));document.querySelector("[data-panel=history]").click();document.getElementById("history-query").value="Native recovery fixture";document.getElementById("history-refresh").click()');
    await until('return document.querySelectorAll("#history-list li").length>0');
    await execute('Array.from(document.querySelector("#history-list li").querySelectorAll("button")).find(button=>button.textContent==="Воспроизвести").click()');
    await until('return document.getElementById("status").textContent==="Воспроизведение"',45000);
    await until('return !document.getElementById("seek").disabled&&Number(document.getElementById("seek").max)>60');
    const recordsBefore=(await store({type:'history',query:'Native recovery fixture'})).length;
    const beforeTitle=await execute('return document.getElementById("track-title").textContent');
    await network(true);await until('return navigator.onLine===false');
    await execute('const seek=document.getElementById("seek");window.recoveryTarget=Math.floor(Number(seek.max)*0.7);seek.value=String(window.recoveryTarget);seek.dispatchEvent(new Event("change"));');
    await until('return document.getElementById("status").textContent.includes("Нет сети")',45000);
    const seconds=Number(process.env.ENCORE_OUTAGE_SECONDS??20);assert(Number.isFinite(seconds)&&seconds>=10&&seconds<=900,'Outage must be between10 and900 seconds');
    for(let waited=0;waited<seconds;waited+=5){await sleep(Math.min(5,seconds-waited)*1000);assert.equal(await execute('return document.getElementById("track-title").textContent'),beforeTitle);}
    const heldPosition=await execute('return Number(document.getElementById("seek").value)');
    await click('pause');await network(false);await until('return navigator.onLine===true');await sleep(2000);
    assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение','Reconnect ignored Pause');
    await click('play');await until('return document.getElementById("status").textContent==="Воспроизведение"',45000);await sleep(1000);
    assert.equal(await execute('return document.getElementById("track-title").textContent'),beforeTitle);
    assert.equal(await execute('return document.querySelectorAll("iframe").length'),1);
    assert.equal((await store({type:'history',query:'Native recovery fixture'})).length,recordsBefore,'Recovery duplicated history');
    const positionTrace=await execute('return {target:window.recoveryTarget,after:Number(document.getElementById("seek").value),log:document.getElementById("log").textContent}');
    console.log('Native recovery fixture positions: '+JSON.stringify({target:positionTrace.target,held:heldPosition,after:positionTrace.after}));
    writeFileSync(resolve(root,'.tools/native-recovery-trace.json'),JSON.stringify({...positionTrace,held:heldPosition},null,2));
    assert(heldPosition>=positionTrace.target-10,'Offline seek did not reach its requested position');
    assert(Math.abs(positionTrace.after-heldPosition)<12,'Recovery lost the last buffered position');
    await click('pause');console.log('Native actual WebView network outage, stable track/position/history, reconnect after Pause: PASS ('+seconds+'s; OS network unchanged)');
  }
  const soakMinutes=Number(process.env.ENCORE_WAVE_SOAK_MINUTES??0);
  if(process.env.ENCORE_LIVE_WAVE==='1'||soakMinutes>0) {
    await until('return !document.getElementById("source-start").disabled',30000);
    await execute('document.getElementById("volume").value="0";document.getElementById("volume").dispatchEvent(new Event("input"));document.querySelector("[data-panel=wave]").click();document.getElementById("station-select").value="user:onyourwave";document.getElementById("source-start").click();');
    await until('return document.getElementById("status").textContent==="Воспроизведение"',120000);
    if(soakMinutes>0){
      assert(Number.isFinite(soakMinutes)&&soakMinutes<=120,'Soak must be at most two hours');
      const started=Date.now(),deadline=started+soakMinutes*60000;
      let transitions=0,previous='',waitingSince=0,longestWaitMs=0,lastReport=0,playingSamples=0,waitingSamples=0,maxFrames=0;
      await nativeInvoke('desktop_close');
      while(Date.now()<deadline){
        const sample=await execute('return {title:document.getElementById("track-title").textContent,status:document.getElementById("status").textContent,frames:document.querySelectorAll("iframe").length}');
        assert(sample.frames<=1,'Soak found multiple IFrames');maxFrames=Math.max(maxFrames,sample.frames);
        if(sample.status==='Воспроизведение')playingSamples++;else waitingSamples++;
        if(previous&&sample.title!==previous)transitions++;previous=sample.title;
        if(sample.status==='Воспроизведение'){if(waitingSince)longestWaitMs=Math.max(longestWaitMs,Date.now()-waitingSince);waitingSince=0;}else if(!waitingSince)waitingSince=Date.now();
        if(Date.now()-lastReport>=60000){
          lastReport=Date.now();const result={elapsedMinutes:Math.floor((Date.now()-started)/60000),transitions,longestWaitSeconds:Math.round(Math.max(longestWaitMs,waitingSince?Date.now()-waitingSince:0)/1000),playingSamples,waitingSamples,maxFrames,hidden:true,muted:true};
          writeFileSync(resolve(root,'.tools/wave-soak-progress.json'),JSON.stringify(result,null,2));console.log('Native Wave soak: '+JSON.stringify(result));
        }
        await sleep(5000);
      }
      if(waitingSince)longestWaitMs=Math.max(longestWaitMs,Date.now()-waitingSince);
      assert(playingSamples>0,'Soak never observed playback');
      const result={minutes:soakMinutes,transitions,longestWaitSeconds:Math.round(longestWaitMs/1000),playingSamples,waitingSamples,maxFrames,hidden:true,muted:true,completed:true};
      writeFileSync(resolve(root,'.tools/wave-soak-result.json'),JSON.stringify(result,null,2));
      await nativeInvoke('desktop_action',{action:'open'});
      console.log('Native unaccelerated Wave soak complete: '+JSON.stringify(result));
    }else for(let transition=0;transition<2;transition++) {
      const before=await execute('return document.querySelector("#queue-list li.current")?.textContent ?? document.getElementById("track-title").textContent');
      await execute('window.wavePrevious=arguments[0]',[before]);
      await until('return Number(document.getElementById("seek").max)>5');
      await execute('const seek=document.getElementById("seek");seek.value=String(Number(seek.max)-1);seek.dispatchEvent(new Event("input"));seek.dispatchEvent(new Event("change"));');
      await until('return (document.querySelector("#queue-list li.current")?.textContent ?? document.getElementById("track-title").textContent)!==window.wavePrevious && document.getElementById("status").textContent==="Воспроизведение"',120000);
    }
    assert.equal(await execute('return document.querySelectorAll("iframe").length'),1);
    await click('pause');
    writeFileSync(resolve(root,'.tools/native-wave-redesign.png'),Buffer.from(await request('/session/'+session+'/screenshot'),'base64'));
    if(!soakMinutes)console.log('Native real Wave: explicit start and two unattended natural-END transitions, one IFrame, muted: PASS');
  }
  const rect=await request('/session/'+session+'/window/rect');
  await click('mini');
  await until('return document.body.classList.contains("compact")');
  const compact=await request('/session/'+session+'/window/rect');
  assert(compact.width<rect.width);
  await click('topmost');
  await commandUntil('window_topmost_state',true);
  await click('topmost');
  await commandUntil('window_topmost_state',false);
  await click('mini');
  await until('return !document.body.classList.contains("compact")');
  const restored=await request('/session/'+session+'/window/rect');
  assert.equal(restored.width,rect.width); assert.equal(restored.height,rect.height);
  console.log('Native mini resize/restore and OS topmost flag on/off: PASS');
  await request('/session/'+session+'/window/maximize',{});await desktopUntil('maximized',true);
  const maximized=await request('/session/'+session+'/window/rect');
  await click('mini'); await until('return document.body.classList.contains("compact")');
  const miniFromMaximized=await request('/session/'+session+'/window/rect');
  assert(miniFromMaximized.width<maximized.width);
  await click('mini'); await until('return !document.body.classList.contains("compact")');
  await desktopUntil('maximized',true);
  const restoredMaximized=await request('/session/'+session+'/window/rect');
  assert.equal(restoredMaximized.width,maximized.width);
  console.log('Native mini from maximized window and restore: PASS');
  await request('/session/'+session+'/window/minimize',{});
  assert.equal((await nativeInvoke('desktop_status')).minimized,true);
  const automaticExtra=spawn(nativeApp,['--encore-autostart'],{windowsHide:true,stdio:'ignore',env:nativeEnvironment});
  const automaticExited=await new Promise(resolve=>{const timeout=setTimeout(()=>{automaticExtra.kill();resolve(false);},5000);automaticExtra.on('close',()=>{clearTimeout(timeout);resolve(true);});});
  assert(automaticExited,'Second autostart instance did not exit');
  assert.equal((await nativeInvoke('desktop_status')).minimized,true,'Autostart duplicate must not steal focus');
  console.log('Native duplicate autostart keeps the existing window minimized: PASS');
  const extra=spawn(nativeApp,[],{windowsHide:true,stdio:'ignore',env:nativeEnvironment});
  const exited=await new Promise(resolve=>{const timeout=setTimeout(()=>{extra.kill();resolve(false);},5000);extra.on('close',()=>{clearTimeout(timeout);resolve(true);});});
  assert(exited,'Second instance did not exit');
  await execute('return document.title');
  assert.equal((await nativeInvoke('desktop_status')).minimized,false);
  console.log('Native single instance guard restores minimized existing window: PASS');
} finally {
  if(isolated&&session&&networkEmulated)await network(false).catch(()=>{});
  if(isolated && session && volumeCaptured) await execute('if(arguments[0]===null)localStorage.removeItem("encore.volume.v1");else localStorage.setItem("encore.volume.v1",arguments[0]);',[originalVolume]).catch(()=>{});
  if(isolated && session) await nativeInvoke('desktop_action',{action:'quit'}).catch(()=>{});
  if(isolated && session) await request('/session/'+session,undefined,'DELETE').catch(()=>{});
  if(isolated&&Number.isInteger(appPid)){
    let alive=true;
    for(let count=0;count<30;count++){try{process.kill(appPid,0);}catch{alive=false;break;}await sleep(100);}
    if(alive)try{process.kill(appPid);}catch{}
  }
  if(process.platform==='win32'&&isolated) { await new Promise(resolve=>{const cleanup=spawn('taskkill',['/PID',String(driver.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});cleanup.on('close',resolve);cleanup.on('error',resolve);}); } else driver.kill();
}
