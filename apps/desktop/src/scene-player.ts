import './scene.css';
import {iconDefs,setIconLabel} from './icons';
import {paintRange} from './visual-controls';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {hostAvailable} from './player-host';
import {mountVideoMirror} from './video-mirror';
import type {SceneSnapshot} from './scene-ui';

const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const root=get('scene'),status=get('scene-status'),seek=get<HTMLInputElement>('scene-seek');
document.body.insertAdjacentHTML('afterbegin',iconDefs);
let latest:SceneSnapshot|undefined,revision=-1,seeking=false;
const clock=(value:number)=>{const seconds=Math.max(0,Math.floor(value));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');};
function receive(snapshot:SceneSnapshot|null){
 if(!snapshot||snapshot.revision<revision)return;
 if(snapshot.generation!==latest?.generation)seeking=false;
 revision=snapshot.revision;latest=snapshot;
 get('scene-title').textContent=snapshot.title||'YCore Music';get('scene-artist').textContent=snapshot.artist;
 seek.max=String(snapshot.duration);seek.disabled=!snapshot.videoId||!snapshot.duration;
 if(!seeking){seek.value=String(snapshot.position);paintRange(seek);get('scene-elapsed').textContent=clock(snapshot.position);}
 get('scene-duration').textContent=clock(snapshot.duration);setIconLabel(get('scene-toggle'),snapshot.playback===1?'pause':'play','Воспроизвести или приостановить',true);
 status.textContent=snapshot.videoId?'':'Выберите музыку в основном окне YCore Music';
}
async function control(type:string,position?:number){try{
 const value=await invoke<{fullscreen:boolean;topmost:boolean}>('scene_control',{action:{type,...(position===undefined?{}:{position})}});
 if(value){const fullscreen=document.querySelector<HTMLButtonElement>('[data-control=fullscreen]')!,topmost=document.querySelector<HTMLButtonElement>('[data-control=topmost]')!;setIconLabel(fullscreen,value.fullscreen?'shrink':'fullscreen',value.fullscreen?'Выйти из полного экрана':'На весь экран',true);fullscreen.setAttribute('aria-pressed',String(value.fullscreen));topmost.setAttribute('aria-pressed',String(value.topmost));}
 }catch{status.textContent='Не удалось выполнить действие. Повторите в основном окне YCore Music.';}}
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-control]')){const type=button.dataset.control!,names:Record<string,string>={toggle:'play',previous:'previous',next:'next',fullscreen:'fullscreen',topmost:'pin'};setIconLabel(button,names[type]??type,button.getAttribute('aria-label')??button.textContent??'',true);button.onclick=()=>void control(type);}
seek.oninput=()=>{seeking=true;get('scene-elapsed').textContent=clock(Number(seek.value));seek.title=clock(Number(seek.value));};seek.onchange=()=>{seeking=false;void control('seek',Number(seek.value));};seek.addEventListener('pointercancel',()=>{seeking=false;});
let hudTimer:ReturnType<typeof setTimeout>|undefined,dragging=false;
function hideHud(){if(dragging||get('scene-controls').matches(':hover')||get('scene-controls').querySelector(':focus-visible')){hudTimer=setTimeout(hideHud,3000);return;}root.classList.remove('hud-visible');}
function reveal(){root.classList.add('hud-visible');clearTimeout(hudTimer);hudTimer=setTimeout(hideHud,3000);}
root.addEventListener('pointermove',reveal);root.addEventListener('pointerdown',()=>{dragging=true;reveal();});
window.addEventListener('pointerup',()=>{dragging=false;reveal();});window.addEventListener('pointercancel',()=>{dragging=false;reveal();});get('scene-controls').addEventListener('focusin',reveal);
window.addEventListener('keydown',event=>{
 if(event.ctrlKey||event.altKey||event.metaKey||event.repeat)return;
 if(event.key==='F11'){event.preventDefault();void control('fullscreen');}
 else if(event.key==='Escape'){event.preventDefault();void control('windowed');}
 else if(event.target instanceof Element&&event.target.closest('input,button'))return;
 else if(event.code==='Space'){event.preventDefault();void control('toggle');reveal();}
});
async function start(){
 await listen<{snapshot:SceneSnapshot;visible:boolean}>('scene-snapshot',event=>receive(event.payload.snapshot));
 receive(await invoke<SceneSnapshot|null>('scene_snapshot'));
 if(!await hostAvailable()){status.textContent='Локальное зеркало видео пока недоступно на этой платформе.';return;}
 void mountVideoMirror(root,()=>[get('scene-title').parentElement!,...(root.classList.contains('hud-visible')?[get('scene-controls')]:[]),...(status.textContent?[status]:[])],()=>!!latest?.videoId);
}
void start().catch(()=>{status.textContent='Нет связи с основным окном YCore Music.';});
document.addEventListener('video-mirror-error',()=>{status.textContent='Не удалось показать зеркало. Музыкой можно управлять в основном окне.';});
window.addEventListener('beforeunload',()=>clearTimeout(hudTimer));
