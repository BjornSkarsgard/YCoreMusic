import {invoke,isTauri} from '@tauri-apps/api/core';
import {icon} from './icons';
export interface SceneSnapshot {revision:number;generation:number;videoId:string|null;title:string;artist:string;position:number;duration:number;playback:number}
interface SceneStatus {enabled:boolean;visible:boolean;topmost:boolean;screenId?:string|null}
interface Display {id:string;name:string;stable:boolean;primary:boolean;width:number;height:number;scaleFactor:number;refreshHz:number|null}
export function mountScenes(read:()=>Omit<SceneSnapshot,'revision'>){
 const root=document.createElement('section');root.id='scene-settings';
 root.innerHTML=`<h3>Экраны и телевизор</h3><p class="panel-description">Выберите, где показывать клип. Управление экранами также доступно кнопкой «Экраны» в верхней панели.</p><button id="screens-settings">${icon('monitor')}<span>Настроить экраны</span></button>`;
 document.getElementById('autostart-settings')!.before(root);
 const dialog=document.createElement('dialog');dialog.id='screens-dialog';dialog.setAttribute('aria-labelledby','screens-title');
 dialog.innerHTML=`<div class="dialog-heading"><h2 id="screens-title">Экраны и телевизор</h2><button id="screens-close" aria-label="Закрыть управление экранами">${icon('close')}</button></div><p>Клип на большом экране, управление — под рукой. Вывод звука выбирает система.</p><section class="screen-step"><h3><span>1</span> Выберите экран</h3><label class="sr-only" for="scene-monitor">Экран для клипа</label><select id="scene-monitor" aria-label="Экран для клипа"><option value="">Выберите экран</option></select><button id="monitor-refresh">${icon('sync')}<span>Обновить экраны</span></button><p id="monitor-status" role="status"></p><details class="screen-help"><summary>Телевизора нет в списке?</summary><p>Подключите его как дополнительный экран компьютера и включите расширение рабочего стола в системе. Затем обновите список. Сетевая трансляция на телевизор здесь пока не поддерживается.</p></details></section><section class="screen-step" id="scene-content-step" aria-disabled="true"><h3><span>2</span> Что показывать</h3><div class="screen-content-choices"><button id="scene-video-choice" aria-pressed="true" disabled>${icon('play')}<span>Клип<small>Текущее видео и общее управление</small></span></button><button disabled aria-describedby="visualizer-unavailable">${icon('wave')}<span>Визуализатор<small>В разработке</small></span></button></div><p id="visualizer-unavailable">Визуализаторы появятся после проверки анализа звука.</p><p class="scene-limit">Один клип можно показать на нескольких экранах. Выберите каждый экран и включите показ — остальные останутся на месте.</p></section><div class="scene-actions"><button id="scene-open" class="primary" disabled>Показать клип на экране</button><button id="scene-off" disabled>Выключить окно</button></div><p id="scene-window-status" role="status"></p><details class="screen-help"><summary>Оставить в основном окне только управление</summary><p>В верхней панели выберите «Только управление». Поиск, списки и кнопки останутся в основном окне.</p><button id="screens-controls">Оставить только управление</button></details>`;
 const steps=document.createElement('div');steps.className='screens-scroll';steps.append(...dialog.querySelectorAll('.screen-step'),dialog.querySelector(':scope > .screen-help')!);
 const footer=document.createElement('div');footer.className='screens-footer';footer.append(dialog.querySelector('.scene-actions')!,dialog.querySelector('#scene-window-status')!);dialog.append(steps,footer);
 document.body.append(dialog);
 let opener:HTMLElement|null=null;
 function show(){if(dialog.open)return;opener=document.activeElement as HTMLElement;dialog.showModal();void refreshMonitors();}
 document.getElementById('screens')!.onclick=show;document.getElementById('screens-settings')!.onclick=show;
 document.getElementById('screens-close')!.onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{opener?.focus();});
 document.getElementById('screens-controls')!.onclick=()=>{const layout=document.getElementById('window-layout') as HTMLSelectElement;layout.value='controls';layout.dispatchEvent(new Event('change'));dialog.close();};
 const open=document.getElementById('scene-open') as HTMLButtonElement,off=document.getElementById('scene-off') as HTMLButtonElement,status=document.getElementById('scene-window-status')!;
 let enabled=false,busy=false,publishing=false,pending=false,revision=Date.now()*1000,windowRevision=0;
 const scenes=new Map<string,SceneStatus>();
 let readingScenes=false;
 const monitor=document.getElementById('scene-monitor') as HTMLSelectElement,refresh=document.getElementById('monitor-refresh') as HTMLButtonElement,monitorStatus=document.getElementById('monitor-status')!;
 let readingMonitors=false,displays:Display[]=[],listValid=false;
 function syncActions(){const selected=listValid&&displays.some(display=>display.id===monitor.value);open.disabled=busy||readingMonitors||!selected;off.disabled=busy||!scenes.has(monitor.value);monitor.disabled=busy;document.getElementById('scene-video-choice')!.toggleAttribute('disabled',busy||!selected);document.getElementById('scene-content-step')!.setAttribute('aria-disabled',String(!selected));open.textContent=scenes.has(monitor.value)?'Показать окно снова':'Показать клип на экране';}
 function describe(){const current=scenes.get(monitor.value);status.textContent=current?(current.visible?'На выбранном экране включён клип. Остальные экраны настраиваются независимо.':'Окно на выбранном экране скрыто. Нажмите «Показать окно снова».'):'';}
 async function readScenes(){
  if(!isTauri()||readingScenes)return;readingScenes=true;const version=windowRevision;
  try{const values=await invoke<SceneStatus[]>('scene_windows');if(Array.isArray(values)&&version===windowRevision&&!busy){scenes.clear();for(const value of values)if(value.enabled&&value.screenId)scenes.set(value.screenId,value);enabled=scenes.size>0;syncActions();describe();}}
  catch{/* A failed refresh must not forget a scene opened in this session. */}
  finally{readingScenes=false;}
 }
 monitor.onchange=()=>{describe();syncActions();};
 async function refreshMonitors(){
  if(!isTauri()){monitorStatus.textContent='Управление экранами доступно в установленном YCore Music.';return;}if(readingMonitors||busy)return;readingMonitors=true;refresh.disabled=true;syncActions();
  try{
   const result=await invoke<Display[]>('monitor_list');if(!Array.isArray(result))throw Error('Invalid display list');displays=result;listValid=true;
   const selected=monitor.value;monitor.replaceChildren(new Option('Выберите экран',''));
   for(const display of displays)monitor.append(new Option(display.name+' · '+display.width+'×'+display.height+(display.refreshHz?' · '+display.refreshHz+' Гц':'')+(display.primary?' · основной':''),display.id));
   if(selected&&!displays.some(display=>display.id===selected)){const absent=new Option('Выбранный экран отключён',selected);absent.disabled=true;monitor.append(absent);monitorStatus.textContent='Экран отключён. Выберите другой или подключите его и обновите список.';}
   else monitorStatus.textContent=!displays.length?'Экраны не найдены. Подключите экран и обновите список.':displays.some(display=>!display.stable)?'Для части экранов система не предоставила постоянный идентификатор.':'';
   monitor.value=selected;
  }catch{listValid=false;monitorStatus.textContent='Не удалось получить список экранов. Повторите обновление.';}
  finally{readingMonitors=false;refresh.disabled=false;syncActions();void readScenes();}
 }
 refresh.onclick=()=>void refreshMonitors();root.addEventListener('settings-open',()=>void refreshMonitors());
 function updated(value:SceneStatus,id:string){if(value.enabled)scenes.set(id,value);else scenes.delete(id);enabled=scenes.size>0;syncActions();describe();}
 async function publish(){
  if(!enabled||!isTauri())return;
  if(publishing){pending=true;return;}
  publishing=true;pending=false;
  try{await invoke('scene_publish',{snapshot:{...read(),revision:++revision}});}
  catch{status.textContent='Не удалось обновить окно клипа. Основное воспроизведение продолжается.';}
  finally{publishing=false;if(pending)void publish();}
 }
 async function action(action:'open'|'off'){
  if(busy||!monitor.value||action==='off'&&!scenes.has(monitor.value)||action==='open'&&(readingMonitors||!listValid||!displays.some(display=>display.id===monitor.value)))return;if(!isTauri()){status.textContent='Отдельное окно доступно в desktop-версии YCore Music.';return;}
  ++windowRevision;busy=true;refresh.disabled=true;syncActions();
  const selected=monitor.value;
  try{const value=await invoke<SceneStatus>('scene_window',{action,monitorId:selected});updated(value,selected);if(enabled)void publish();}
  catch{status.textContent='Не удалось изменить окно клипа. Повторите попытку.';}
  finally{busy=false;refresh.disabled=false;syncActions();}
 }
 open.onclick=()=>void action('open');off.onclick=()=>void action('off');
 if(isTauri())void readScenes();
 if(isTauri())void refreshMonitors();
 const timer=setInterval(()=>void publish(),500);
 window.addEventListener('beforeunload',()=>clearInterval(timer));
}
