import {invoke,isTauri} from '@tauri-apps/api/core';
export interface SceneSnapshot {revision:number;generation:number;videoId:string|null;title:string;artist:string;position:number;duration:number;playback:number}
interface SceneStatus {enabled:boolean;visible:boolean;topmost:boolean}
export function mountScenes(read:()=>Omit<SceneSnapshot,'revision'>){
 const root=document.createElement('section');root.id='scene-settings';
 root.innerHTML='<h3>Окно клипа</h3><p class="panel-description">Откройте отдельное окно и перенесите его на телевизор или другой экран. В основном окне можно выбрать «Только управление». Звук остаётся общим.</p><div class="scene-actions"><button id="scene-open">Открыть окно клипа</button><button id="scene-off" disabled>Выключить окно</button></div><p id="scene-window-status" role="status"></p>';
 document.getElementById('autostart-settings')!.before(root);
 const open=document.getElementById('scene-open') as HTMLButtonElement,off=document.getElementById('scene-off') as HTMLButtonElement,status=document.getElementById('scene-window-status')!;
 let enabled=false,busy=false,publishing=false,pending=false,revision=Date.now()*1000,windowRevision=0;
 function updated(value:SceneStatus){enabled=value.enabled;off.disabled=!enabled||busy;open.disabled=busy;status.textContent=enabled?'Окно клипа включено. Крестик скрывает его, «Выключить окно» закрывает полностью.':'';}
 async function publish(){
  if(!enabled||!isTauri())return;
  if(publishing){pending=true;return;}
  publishing=true;pending=false;
  try{await invoke('scene_publish',{snapshot:{...read(),revision:++revision}});}
  catch{status.textContent='Не удалось обновить окно клипа. Основное воспроизведение продолжается.';}
  finally{publishing=false;if(pending)void publish();}
 }
 async function action(action:'open'|'off'){
  if(busy)return;if(!isTauri()){status.textContent='Отдельное окно доступно в desktop-версии Encore.';return;}
  ++windowRevision;busy=true;open.disabled=off.disabled=true;
  try{const value=await invoke<SceneStatus>('scene_window',{action});updated(value);if(enabled)void publish();}
  catch{status.textContent='Не удалось изменить окно клипа. Повторите попытку.';}
  finally{busy=false;open.disabled=false;off.disabled=!enabled;}
 }
 open.onclick=()=>void action('open');off.onclick=()=>void action('off');
 if(isTauri())void invoke<SceneStatus>('scene_window',{action:'status'}).then(value=>{if(value&&windowRevision===0)updated(value);}).catch(()=>{});
 const timer=setInterval(()=>void publish(),500);
 window.addEventListener('beforeunload',()=>clearInterval(timer));
}
