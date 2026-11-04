import {invoke,isTauri} from '@tauri-apps/api/core';
export interface SceneSnapshot {revision:number;generation:number;videoId:string|null;title:string;artist:string;position:number;duration:number;playback:number}
interface SceneStatus {enabled:boolean;visible:boolean;topmost:boolean}
interface Display {id:string;name:string;stable:boolean;primary:boolean;width:number;height:number;scaleFactor:number;refreshHz:number|null}
export function mountScenes(read:()=>Omit<SceneSnapshot,'revision'>){
 const root=document.createElement('section');root.id='scene-settings';
 root.innerHTML='<h3>Окно клипа</h3><p class="panel-description">Откройте отдельное окно на телевизоре или другом экране. В основном окне можно выбрать «Только управление». Звук остаётся общим.</p><label class="field-label" for="scene-monitor">Экран для клипа</label><select id="scene-monitor" aria-label="Экран для клипа"><option value="">Разместить вручную</option></select><button id="monitor-refresh">Обновить экраны</button><p id="monitor-status" role="status"></p><div class="scene-actions"><button id="scene-open">Открыть окно клипа</button><button id="scene-off" disabled>Выключить окно</button></div><p id="scene-window-status" role="status"></p>';
 document.getElementById('autostart-settings')!.before(root);
 const open=document.getElementById('scene-open') as HTMLButtonElement,off=document.getElementById('scene-off') as HTMLButtonElement,status=document.getElementById('scene-window-status')!;
 let enabled=false,busy=false,publishing=false,pending=false,revision=Date.now()*1000,windowRevision=0;
 const monitor=document.getElementById('scene-monitor') as HTMLSelectElement,refresh=document.getElementById('monitor-refresh') as HTMLButtonElement,monitorStatus=document.getElementById('monitor-status')!;
 let readingMonitors=false;
 async function refreshMonitors(){
  if(!isTauri()||readingMonitors)return;readingMonitors=true;refresh.disabled=true;
  try{
   const displays=await invoke<Display[]>('monitor_list');if(!Array.isArray(displays))return;
   const selected=monitor.value;monitor.replaceChildren(new Option('Разместить вручную',''));
   for(const display of displays)monitor.append(new Option(display.name+' · '+display.width+'×'+display.height+(display.refreshHz?' · '+display.refreshHz+' Гц':'')+(display.primary?' · основной':''),display.id));
   if(selected&&!displays.some(display=>display.id===selected)){const absent=new Option('Выбранный экран отключён',selected);absent.disabled=true;monitor.append(absent);monitorStatus.textContent='Экран отключён. Выберите другой или подключите его и обновите список.';}
   else monitorStatus.textContent=displays.some(display=>!display.stable)?'Для части экранов система не предоставила постоянный идентификатор.':'';
   monitor.value=selected;
  }catch{monitorStatus.textContent='Не удалось получить список экранов. Можно разместить окно вручную.';}
  finally{readingMonitors=false;refresh.disabled=false;}
 }
 refresh.onclick=()=>void refreshMonitors();root.addEventListener('settings-open',()=>void refreshMonitors());
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
  if(busy)return;if(!isTauri()){status.textContent='Отдельное окно доступно в desktop-версии YCore Music.';return;}
  ++windowRevision;busy=true;open.disabled=off.disabled=true;
  try{const value=await invoke<SceneStatus>('scene_window',{action,monitorId:action==='open'?monitor.value||null:null});updated(value);if(enabled)void publish();}
  catch{status.textContent='Не удалось изменить окно клипа. Повторите попытку.';}
  finally{busy=false;open.disabled=false;off.disabled=!enabled;}
 }
 open.onclick=()=>void action('open');off.onclick=()=>void action('off');
 if(isTauri())void invoke<SceneStatus>('scene_window',{action:'status'}).then(value=>{if(value&&windowRevision===0)updated(value);}).catch(()=>{});
 if(isTauri())void refreshMonitors();
 const timer=setInterval(()=>void publish(),500);
 window.addEventListener('beforeunload',()=>clearInterval(timer));
}
