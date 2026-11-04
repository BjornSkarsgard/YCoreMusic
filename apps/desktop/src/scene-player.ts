import {iconDefs,setIconLabel} from './icons';
import {paintRange} from './visual-controls';
document.body.insertAdjacentHTML('afterbegin',iconDefs);
import './scene.css';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type {SceneSnapshot} from './scene-ui';

const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const root=get('scene'),status=get('scene-status'),seek=get<HTMLInputElement>('scene-seek');
let latest:SceneSnapshot|undefined,revision=-1,visible=true,player:YT.Player|undefined,ready=false,epoch=0,currentKey='',apiPromise:Promise<void>|undefined;
let errorAt=0,retries=0,loadingTimer:ReturnType<typeof setTimeout>|undefined;
let seeking=false;
const clock=(value:number)=>{const seconds=Math.max(0,Math.floor(value));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');};
function api(){
 if(window.YT?.Player)return Promise.resolve();
 if(apiPromise)return apiPromise;
 apiPromise=new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script');let timer:ReturnType<typeof setTimeout>;
  const fail=()=>{clearTimeout(timer);script.remove();apiPromise=undefined;reject(Error('YouTube недоступен в этом окне. Воспроизведение в основном окне продолжается.'));};
  timer=setTimeout(fail,15000);script.src='https://www.youtube.com/iframe_api';script.onerror=fail;
  window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);resolve();};document.head.append(script);
 });return apiPromise;
}
function destroy(){++epoch;clearTimeout(loadingTimer);ready=false;player?.destroy();player=undefined;currentKey='';}
function synchronize(){
 if(!ready||!player||!latest||!visible)return;
 // This window is never an audio authority, including autoplay/recovery paths.
 player.mute();player.setVolume(0);
 const state=player.getPlayerState();
 if(Math.abs(player.getCurrentTime()-latest.position)>(latest.playback===1?.75:.3))player.seekTo(latest.position,true);
 if(latest.playback===1){if(state!==1&&state!==3)player.playVideo();}
 else if(state===1||state===3)player.pauseVideo();
}
async function prepare(snapshot:SceneSnapshot){
 const key=snapshot.generation+':'+snapshot.videoId;
 if(key===currentKey){synchronize();return;}
 destroy();currentKey=key;const token=epoch;status.textContent='Подготовка клипа…';
 try{
  await api();if(token!==epoch||!visible||!latest?.videoId)return;
  if(!document.getElementById('scene-player')){const mount=document.createElement('div');mount.id='scene-player';root.prepend(mount);}
  loadingTimer=setTimeout(()=>{if(token===epoch){errorAt=Date.now();status.textContent='Клип не загрузился в этом окне. Основное воспроизведение продолжается.';}},15000);
  player=new YT.Player('scene-player',{width:'100%',height:'100%',playerVars:{autoplay:0,mute:1,controls:0,disablekb:1,playsinline:1,fs:0,rel:0,origin:location.origin},events:{
   onReady:event=>{if(token!==epoch)return;event.target.mute();event.target.setVolume(0);event.target.getIframe?.().setAttribute('tabindex','-1');event.target.cueVideoById({videoId:snapshot.videoId!,startSeconds:latest?.position??snapshot.position});},
   onStateChange:event=>{
    if(token!==epoch)return;event.target.mute();event.target.setVolume(0);
    if([1,2,5].includes(event.data)){ready=true;clearTimeout(loadingTimer);status.textContent='';}
    // ENDED never chooses or advances a track: only the main coordinator can do that.
    if(event.data===5)synchronize();
   },
   onError:()=>{if(token===epoch){errorAt=Date.now();ready=false;status.textContent='YouTube не разрешил показать клип в этом окне. Выберите другую версию в YCore Music.';}},
   onAutoplayBlocked:()=>{if(token===epoch)status.textContent='Нажмите на это окно, чтобы разрешить показ клипа.';},
  }});
 }catch(error){if(token===epoch){errorAt=Date.now();status.textContent=error instanceof Error?error.message:'Не удалось подготовить клип.';}}
}
function receive(snapshot:SceneSnapshot|null,shown=true){
 if(!snapshot)return;
 if(snapshot.revision<revision)return;
 const changed=latest?.generation!==snapshot.generation||latest?.videoId!==snapshot.videoId;
 revision=snapshot.revision;latest=snapshot;visible=shown;
 get('scene-title').textContent=snapshot.title||'YCore Music';get('scene-artist').textContent=snapshot.artist;
 if(changed)seeking=false;
 if(!seeking){get('scene-elapsed').textContent=clock(snapshot.position);seek.value=String(snapshot.position);paintRange(seek);}
 get('scene-duration').textContent=clock(snapshot.duration);seek.max=String(snapshot.duration);seek.disabled=!snapshot.videoId||!snapshot.duration;
 setIconLabel(get('scene-toggle'),snapshot.playback===1?'pause':'play','Воспроизвести или приостановить',true);
 if(changed){errorAt=0;retries=0;}
 if(!visible||!snapshot.videoId){destroy();status.textContent=snapshot.videoId?'':'Выберите музыку в основном окне YCore Music';return;}
 if(errorAt){if(Date.now()-errorAt<15000||retries>=2)return;++retries;errorAt=0;currentKey='';}
 void prepare(snapshot);
}
async function control(type:string,position?:number){try{
 const value=await invoke<{fullscreen:boolean;topmost:boolean}>('scene_control',{action:{type,...(position===undefined?{}:{position})}});
 if(value){const fullscreen=document.querySelector<HTMLButtonElement>('[data-control=fullscreen]')!,topmost=document.querySelector<HTMLButtonElement>('[data-control=topmost]')!;setIconLabel(fullscreen,value.fullscreen?'shrink':'fullscreen',value.fullscreen?'Выйти из полного экрана':'На весь экран',true);fullscreen.setAttribute('aria-pressed',String(value.fullscreen));topmost.setAttribute('aria-pressed',String(value.topmost));}
}catch{status.textContent='Не удалось выполнить действие. Повторите в основном окне YCore Music.';}}
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-control]')){const type=button.dataset.control!,names:Record<string,string>={toggle:'play',previous:'previous',next:'next',fullscreen:'fullscreen',topmost:'pin'};setIconLabel(button,names[type]??type,button.getAttribute('aria-label')??button.textContent??'',true);button.onclick=()=>void control(type);}
seek.oninput=()=>{seeking=true;get('scene-elapsed').textContent=clock(Number(seek.value));seek.title=clock(Number(seek.value));};
seek.onchange=()=>{seeking=false;void control('seek',Number(seek.value));};
seek.addEventListener('pointercancel',()=>{seeking=false;});
let hudTimer:ReturnType<typeof setTimeout>|undefined,dragging=false;
function hideHud(){if(dragging||get('scene-controls').matches(':hover')||get('scene-controls').querySelector(':focus-visible')){hudTimer=setTimeout(hideHud,3000);return;}root.classList.remove('hud-visible');}
function reveal(){root.classList.add('hud-visible');clearTimeout(hudTimer);hudTimer=setTimeout(hideHud,3000);}
root.addEventListener('pointermove',reveal);root.addEventListener('pointerdown',()=>{dragging=true;reveal();if(ready)synchronize();});
window.addEventListener('pointerup',()=>{dragging=false;reveal();});window.addEventListener('pointercancel',()=>{dragging=false;reveal();});
get('scene-controls').addEventListener('focusin',reveal);
window.addEventListener('keydown',event=>{
 if(event.ctrlKey||event.altKey||event.metaKey||event.repeat)return;
 if(event.key==='F11'){event.preventDefault();void control('fullscreen');}
 else if(event.key==='Escape'){event.preventDefault();void control('windowed');}
 else if(event.target instanceof Element&&event.target.closest('input,button'))return;
 else if(event.code==='Space'){event.preventDefault();void control('toggle');reveal();}
});
async function start(){
 await listen<{snapshot:SceneSnapshot;visible:boolean}>('scene-snapshot',event=>receive(event.payload.snapshot,event.payload.visible));
 await listen('scene-hidden',()=>{visible=false;destroy();});
 receive(await invoke<SceneSnapshot|null>('scene_snapshot'));
}
void start().catch(()=>{status.textContent='Нет связи с основным окном YCore Music.';});
window.addEventListener('beforeunload',()=>{clearTimeout(hudTimer);destroy();});
