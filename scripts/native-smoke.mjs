// Opt-in Windows desktop integration test. No credentials or API bodies are logged.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const driver=spawn(process.env.ENCORE_TAURI_DRIVER ?? 'tauri-driver',[
  '--port','4444','--native-driver',process.env.ENCORE_EDGE_DRIVER ?? resolve(root,'.tools/edgedriver/msedgedriver.exe')
],{windowsHide:true,stdio:'ignore'});
let session;
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
  throw new Error('Native condition timed out: '+script);
}
async function click(id){await execute('document.getElementById(arguments[0]).click()', [id]);}
try {
  driver.on('error',()=>{});
  for(let attempt=0;attempt<40;attempt++){try{await request('/status');break;}catch{await sleep(250);}}
  const created=await request('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:resolve(root,'apps/desktop/src-tauri/target/debug/encore.exe')}}}});
  session=created.sessionId;
  await until('return !!document.getElementById("play")');
  assert.equal(await execute('return document.querySelectorAll("iframe").length'),0);
  console.log('Native startup without iframe/autoplay: PASS');
  if(process.env.ENCORE_LIVE_YANDEX==='1') {
    await until('return document.querySelectorAll("#queue-list li").length>0');
    const count=await execute('return document.querySelectorAll("#queue-list li").length');
    await click('source-more');
    await until('return document.querySelectorAll("#queue-list li").length>'+count);
    console.log('Native source session + next batch via OS credential store: PASS (counts only)');
  }
  if(process.env.ENCORE_LIVE_YOUTUBE==='1') {
    await execute('document.getElementById("volume").value="0";document.getElementById("volume").dispatchEvent(new Event("input"));document.getElementById("url").value="M7lc1UVf-VE";document.getElementById("load").requestSubmit();');
    await until('return !document.getElementById("play").disabled',30000);
    assert.notEqual(await execute('return document.getElementById("status").textContent'),'Воспроизведение');
    await click('play');
    await until('return document.getElementById("status").textContent==="Воспроизведение"',30000);
    await click('pause');
    await until('return document.getElementById("status").textContent==="Пауза"');
    await click('forward');
    await until('return Number(document.getElementById("seek").value)>=4');
    console.log('Native real YouTube cue, muted Play, Pause, seek: PASS');
  }
  const rect=await request('/session/'+session+'/window/rect');
  await click('mini');
  await until('return document.body.classList.contains("compact")');
  const compact=await request('/session/'+session+'/window/rect');
  assert(compact.width<rect.width);
  await click('topmost');
  const nativeInvoke=async(cmd)=>request('/session/'+session+'/execute/async',{script:'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0]).then(done).catch(()=>done(null));',args:[cmd]});
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
  const extra=spawn(resolve(root,'apps/desktop/src-tauri/target/debug/encore.exe'),[],{windowsHide:true,stdio:'ignore'});
  const exited=await new Promise(resolve=>{const timeout=setTimeout(()=>{extra.kill();resolve(false);},5000);extra.on('close',()=>{clearTimeout(timeout);resolve(true);});});
  assert(exited,'Second instance did not exit');
  await execute('return document.title');
  console.log('Native single instance guard: PASS');
} finally {
  if(session) await request('/session/'+session,undefined,'DELETE').catch(()=>{});
  if(process.platform==='win32') { await new Promise(resolve=>{const cleanup=spawn('taskkill',['/PID',String(driver.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});cleanup.on('close',resolve);cleanup.on('error',resolve);}); } else driver.kill();
}
