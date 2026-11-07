import {invoke,isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {icon} from './icons';

type Phase='idle'|'disabled'|'checking'|'current'|'unpublished'|'available'|'downloading'|'ready'|'installing'|'error';
interface Status {phase:Phase;revision?:number;version?:string|null;notes:string;downloaded:number;total?:number|null;error?:string|null}
const phases=new Set<Phase>(['idle','disabled','checking','current','unpublished','available','downloading','ready','installing','error']);
const day=86400000,deferredKey='ycore.updateDeferred.v1';
let installing=false;
const deferredThisSession=new Set<string>();
export const updatesInstalling=()=>installing;
function deferred(version:string){if(deferredThisSession.has(version))return true;try{const value=JSON.parse(localStorage.getItem(deferredKey)??'null');return value?.version===version&&Number(value.until)>Date.now();}catch{return false;}}

export function mountUpdates(isPlaying:()=>boolean,beforeInstall:()=>void){
 const root=document.createElement('section');root.id='updates-settings';
 root.innerHTML='<h3>Обновления</h3><p id="updates-summary" role="status">Новые версии устанавливаются только с вашего разрешения.</p><button id="updates-check">Проверить обновления</button> <button id="updates-details" hidden>Подробнее</button>';
 document.getElementById('diagnostics')!.after(root);
 const dialog=document.createElement('dialog');dialog.id='updates-dialog';dialog.setAttribute('aria-labelledby','updates-title');
 dialog.innerHTML='<div class="dialog-heading"><h2 id="updates-title">Обновление YCore Music</h2><button id="updates-close" aria-label="Закрыть">'+icon('close')+'</button></div><p id="updates-status" role="status"></p><pre id="updates-notes"></pre><progress id="updates-progress" hidden></progress><p id="updates-pause-hint" hidden>Закройте это окно и поставьте музыку на паузу. Затем вернитесь в Настройки → Обновления → Подробнее.</p><div class="dialog-actions"><button id="updates-later">Позже</button><button id="updates-download" class="primary" hidden>Скачать обновление</button><button id="updates-install" class="primary" hidden>Перезапустить и обновить</button></div>';
 document.body.append(dialog);
 const get=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
 const check=get<HTMLButtonElement>('updates-check'),details=get<HTMLButtonElement>('updates-details'),download=get<HTMLButtonElement>('updates-download'),install=get<HTMLButtonElement>('updates-install'),later=get<HTMLButtonElement>('updates-later');
 const progress=get<HTMLProgressElement>('updates-progress'),nav=document.querySelector<HTMLElement>('[data-panel=settings]')!;
 let value:Status={phase:'idle',notes:'',downloaded:0},busy=false,reading=false,opener:HTMLElement|null=null,disposed=false,unlisten:(()=>void)|undefined;
 let startupOffer:string|null=null;
 const errors:Record<string,string>={untrusted_asset:'Источник обновления не подтверждён. Установка заблокирована.',platform_unavailable:'Для этой системы обновление ещё не опубликовано.',check_failed:'Не удалось проверить обновления. Проверьте сеть и повторите.',download_or_signature_failed:'Не удалось скачать или подтвердить подлинность обновления. Повторите загрузку.',install_failed:'Не удалось установить обновление. Текущая версия сохранена; можно скачать пакет повторно.',playback_active:'Сначала приостановите воспроизведение.'};
 function paint(){
  installing=value.phase==='installing';const pending=['checking','downloading','installing'].includes(value.phase),known=!!value.version;
  const text:Record<Phase,string>={idle:'Новые версии устанавливаются только с вашего разрешения.',disabled:'Обновления отключены в тестовом запуске.',checking:'Проверяем обновления…',current:'Установлена актуальная версия.',unpublished:'Новые версии пока не опубликованы.',available:'Доступна версия '+value.version+'.',downloading:'Скачиваем обновление…',ready:'Обновление скачано, подлинность подтверждена.',installing:'Устанавливаем обновление…',error:errors[value.error??'']??'Не удалось выполнить действие. Повторите попытку.'};
  get('updates-summary').textContent=get('updates-status').textContent=value.error==='playback_active'?errors.playback_active:text[value.phase];
  get('updates-notes').textContent=value.notes||'Описание изменений пока не опубликовано.';
  check.disabled=pending||busy||value.phase==='disabled';details.hidden=!known;details.disabled=installing;
  download.hidden=!known||value.phase==='ready'||installing;download.disabled=pending||busy;
  download.textContent=value.phase==='error'?'Повторить загрузку':'Скачать обновление';
  install.hidden=value.phase!=='ready'&&!installing;install.disabled=busy||installing||isPlaying();
  get('updates-pause-hint').hidden=value.phase!=='ready'||!isPlaying();later.disabled=installing;
  progress.hidden=value.phase!=='downloading';if(value.total&&value.total>0){progress.max=value.total;progress.value=value.downloaded;}else progress.removeAttribute('value');
  const notice=known&&!deferred(value.version!)&&value.phase!=='installing';nav.classList.toggle('has-update',notice);nav.title=notice?'Доступно обновление YCore Music':'';
 }
 function accept(next:Status){if(!next||!phases.has(next.phase))throw Error('Invalid update state');if(typeof next.revision==='number'&&typeof value.revision==='number'&&next.revision<value.revision)return;value=next;paint();}
 async function request(action:'check'|'download'|'install',startup=false){
  if(busy)return;
  if(action==='install'){
   if(isPlaying()){get('updates-status').textContent='Сначала приостановите воспроизведение.';return;}
   beforeInstall();installing=true;
  }
  busy=true;value={...value,...(typeof value.revision==='number'?{revision:value.revision+1}:{}),phase:action==='check'?'checking':action==='download'?'downloading':'installing'};paint();
  try{
   accept(await invoke<Status>('updates_command',{action}));
   if(startup&&value.phase==='available')startupOffer=value.version??null;
  }catch{value={...value,phase:'error',error:action==='install'?'install_failed':action==='download'?'download_or_signature_failed':'check_failed'};}
  finally{busy=false;paint();offerOnStartup();}
 }
 function show(){if(dialog.open)return;startupOffer=null;opener=document.activeElement as HTMLElement;dialog.showModal();paint();}
 function offerOnStartup(){
  if(!startupOffer||disposed||busy)return;
  if(value.phase!=='available'||value.version!==startupOffer||deferred(startupOffer)){startupOffer=null;return;}
  if(document.hidden||!document.hasFocus()||document.querySelector('dialog[open]')||isPlaying())return;
  show();
 }
 details.onclick=show;check.onclick=()=>void request('check');download.onclick=()=>void request('download');install.onclick=()=>void request('install');
 get('updates-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>opener?.focus());
 dialog.addEventListener('cancel',event=>{if(installing)event.preventDefault();});
 later.onclick=()=>{if(value.version){deferredThisSession.add(value.version);try{localStorage.setItem(deferredKey,JSON.stringify({version:value.version,until:Date.now()+day}));}catch{/* Dismiss this dialog for the current session. */}}dialog.close();paint();};
 async function read(){if(reading||disposed||!isTauri())return;reading=true;try{accept(await invoke<Status>('updates_command',{action:'read'}));}catch{/* The next manual check remains available. */}finally{reading=false;}}
 if(isTauri()){
  void listen<Status>('updates-status',event=>{try{accept(event.payload);}catch{/* Ignore malformed status packets. */}},{target:{kind:'WebviewWindow',label:'main'}}).then(stop=>{if(disposed)stop();else unlisten=stop;}).catch(()=>{});
  void read().then(()=>{if(disposed)return;if(value.phase==='idle')void request('check',true);else if(value.phase==='available'){startupOffer=value.version??null;offerOnStartup();}});
 }else{check.disabled=true;get('updates-summary').textContent='Обновления проверяются в установленном приложении.';}
 const timer=setInterval(()=>{if(value.phase==='downloading'||value.phase==='checking')void read();if(value.phase==='ready')paint();offerOnStartup();},1000);
 window.addEventListener('beforeunload',()=>{disposed=true;clearInterval(timer);unlisten?.();});
}
