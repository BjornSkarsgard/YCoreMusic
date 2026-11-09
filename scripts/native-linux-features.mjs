// Runs only in the isolated Linux profile used by native-smoke.mjs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
export async function verifyLinuxVideo({execute,nativeInvoke,sleep,request,session,until}){
  const source=[];
  for(let i=0;i<3;i++){source.push(await nativeInvoke('linux_video_probe'));await sleep(700);}
  assert(source.every(s=>s?.nonBlack>100),'Native snapshots must contain real video');
  assert(new Set(source.map(s=>s.hash)).size>1,'Source frames must advance');
  const stage=await execute('const r=document.querySelector(".screen").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}');
  assert(stage.x>=0&&stage.width>320,'Probe must inspect a visible video surface');
  const mirror=[];
  for(let i=0;i<3;i++){mirror.push(await nativeInvoke('linux_video_probe',{mirrorLabel:'main',stage}));await sleep(700);}
  assert(mirror.every(s=>s?.width>320),'Visible GTK mirror must be capturable');
  assert(new Set(mirror.map(s=>s.hash)).size>1,'Visible mirror frames must advance');
  console.log('Native Linux actual YouTube source and visible GTK mirror have changing pixels: PASS');
  const button=await request('/session/'+session+'/element',{using:'css selector',value:'#screens'});
  await request('/session/'+session+'/element/'+button['element-6066-11e4-a52e-4f735466cecf']+'/click',{});
  await until('return document.getElementById("screens-dialog").open');
  await execute('document.getElementById("screens-dialog").close()');
  console.log('Native Linux real pointer input after mirror mounting opens screen controls: PASS');

}
export async function verifyLinuxScenes({request,session,execute,nativeInvoke,sleep,until}){
  const main=await request('/session/'+session+'/window');
  const switchWindow=handle=>request('/session/'+session+'/window',{handle});
  const handles=async()=>request('/session/'+session+'/window/handles');
  const find=async label=>{
    for(const handle of await handles()){
      await switchWindow(handle);
      if(await execute('return window.__TAURI_INTERNALS__?.metadata.currentWindow.label')===label)return handle;
    }
    throw new Error('Missing native scene: '+label);
  };
  const displays=await nativeInvoke('monitor_list');const display=displays.find(d=>d.stable&&!d.primary)??displays.find(d=>d.stable);
  assert(display,'Private Xvfb EDID fixture must establish a stable test output');
  const first=await nativeInvoke('scene_window',{action:'open'});assert(first?.enabled);
  const second=await nativeInvoke('scene_window',{action:'open',monitorId:display.id,options:{content:'video',fps:30,quality:'medium'}});assert(second?.enabled);
  const sceneHandle=await find(second.label);await until('return !!document.getElementById("scene")');
  await switchWindow(main);
  await execute('document.getElementById("play").click();');
  await until('return document.getElementById("status").textContent==="Воспроизведение"',35000);
  const epoch=(await nativeInvoke('player_host_status')).epoch;
  const media=await nativeInvoke('media_status');assert(media?.available,'Linux MPRIS must be available');
  const mpris=method=>execFileSync('gdbus',['call','--session','--dest','org.mpris.MediaPlayer2.ycore_test','--object-path','/org/mpris/MediaPlayer2','--method','org.mpris.MediaPlayer2.Player.'+method],{stdio:'pipe'});
  mpris('Pause');await until('return document.getElementById("status").textContent==="Пауза"');
  mpris('Play');await until('return document.getElementById("status").textContent==="Воспроизведение"');
  console.log('Native Linux MPRIS Play/Pause control the sole real YouTube player: PASS');

  for(const scene of [first,second]){
    const handle=await find(scene.label);await until('return !!document.getElementById("scene")');
    assert.equal(await execute('return document.querySelectorAll("iframe").length'),0);
    await execute('return window.__TAURI__.window.getCurrentWindow().setFocus()').catch(()=>{});
    const stage=await execute('const r=document.getElementById("scene").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}');
    await switchWindow(main);await sleep(1000);
    const a=await nativeInvoke('linux_video_probe',{mirrorLabel:scene.label,stage});await sleep(900);
    const b=await nativeInvoke('linux_video_probe',{mirrorLabel:scene.label,stage});
    assert(a?.hash&&b?.hash&&a.hash!==b.hash,'Each GTK scene mirror must advance');
  }
  assert.equal((await nativeInvoke('player_host_status')).players,1);
  assert.equal(await execute('return document.querySelectorAll("iframe").length'),0);
  console.log('Native Linux two scene mirrors, zero scene/controller iframes and one real player: PASS');
  const subscribe=async()=>execute('window.visualStats={frames:0,max:0};const handler=window.__TAURI_INTERNALS__.transformCallback(e=>{if(e.payload.available){window.visualStats.frames++;window.visualStats.max=Math.max(window.visualStats.max,...e.payload.bands);}});return window.__TAURI_INTERNALS__.invoke("plugin:event|listen",{event:"audio-analysis",target:{kind:"WebviewWindow",label:window.__TAURI_INTERNALS__.metadata.currentWindow.label},handler});');
  try{
    await subscribe();await switchWindow(sceneHandle);await subscribe();await switchWindow(main);
    await execute('const s=document.getElementById("window-layout");s.value="spectrum";s.dispatchEvent(new Event("change"));document.getElementById("volume").value="1";document.getElementById("volume").dispatchEvent(new Event("input"));');
    for(const preset of ['spectrum','ambient','liquid','particles']){
      await execute('const s=document.getElementById("main-visualizer-preset");s.value=arguments[0];s.dispatchEvent(new Event("change"));window.visualStats={frames:0,max:0};',[preset]);
      await until('return window.visualStats.frames>5&&window.visualStats.max>0.000001',20000);
      const changed=await nativeInvoke('scene_window',{action:'open',monitorId:display.id,options:{content:'visualizer',fps:30,quality:'medium',preset}});assert(changed?.enabled);
      await switchWindow(sceneHandle);await until('return !!document.querySelector(".spectrum-canvas")');
      await execute('window.visualStats={frames:0,max:0};');
      await until('return window.visualStats.frames>5&&window.visualStats.max>0.000001',20000);
      await switchWindow(main);
      assert.equal((await nativeInvoke('player_host_status')).epoch,epoch);
      assert.equal((await nativeInvoke('player_host_status')).players,1);
      console.log('Native Linux real own-stream analysis in main and scene: '+preset+' PASS');
    }
    await execute('const s=document.getElementById("window-layout");s.value="controls";s.dispatchEvent(new Event("change"));');
    const before=Number(await execute('return document.getElementById("seek").value'));await nativeInvoke('desktop_close');await sleep(3000);
    assert(Number(await execute('return document.getElementById("seek").value'))>before,'Hidden controller must retain the sole player');
    await nativeInvoke('desktop_action',{action:'open'});
    const other=(await nativeInvoke('scene_windows')).find(s=>s.label===first.label);
    assert.equal(other.options.content,'video','Changing one scene must not change the other');
    await nativeInvoke('scene_test_connected',{ids:[]});await sleep(500);
    assert((await nativeInvoke('scene_windows')).some(s=>s.screenId===display.id&&s.detached),'Detached scene must retain its identity');
    await nativeInvoke('scene_test_connected',{ids:null});
    for(let i=0;i<30;i++){
      if((await nativeInvoke('scene_windows')).some(s=>s.screenId===display.id&&s.visible&&!s.detached))break;
      await sleep(100);
    }
    assert((await nativeInvoke('scene_windows')).some(s=>s.screenId===display.id&&s.visible&&!s.detached));
    assert.equal((await nativeInvoke('player_host_status')).epoch,epoch);
    console.log('Native Linux independent scenes, controls-only/hidden, simulated disconnect/reconnect preserve one engine: PASS');
  } finally {
    await switchWindow(main).catch(()=>{});
    await nativeInvoke('scene_test_connected',{ids:null});
    await execute('document.getElementById("pause").click();const s=document.getElementById("window-layout");s.value="video";s.dispatchEvent(new Event("change"));document.getElementById("volume").value="0";document.getElementById("volume").dispatchEvent(new Event("input"));').catch(()=>{});
    await nativeInvoke('scene_window',{action:'off',monitorId:display.id});
    await nativeInvoke('scene_window',{action:'off'});
  }
}
