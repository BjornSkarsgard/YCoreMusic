import {setIconLabel} from './icons';
import {invoke,isTauri} from '@tauri-apps/api/core';
interface Reaction {trackId:string;state:number;revision:number;pending:boolean;generation?:number;excludedTrackIds?:string[]}
export function mountFeedback(current:()=>{id:string}|undefined,next:()=>void){
 const like=document.getElementById('like') as HTMLButtonElement,dislike=document.getElementById('dislike') as HTMLButtonElement;
 const notice=document.getElementById('feedback-notice')!;
 let knownGeneration=0;
 const saving=new Set<string>();
 let epoch=0,record:Reaction|undefined,syncing=false,attempt=0,needsSync=false,undoRevision=0;
 let retry:ReturnType<typeof setTimeout>|undefined,undoTimer:ReturnType<typeof setTimeout>|undefined;
 const notify=(trackId:string,state:number,pending=false)=>window.dispatchEvent(new CustomEvent('feedback-changed',{detail:{trackId,state,pending}}));
 const call=<T>(request:object)=>invoke<T>('feedback_command',{request});
 function paint(){setIconLabel(like,'heart',record?.state===1?'Убрать из любимого':'Добавить в любимое',true);like.setAttribute('aria-pressed',String(record?.state===1));dislike.setAttribute('aria-pressed',String(record?.state===-1));like.title=record?.state===1?'Убрать из любимого':'Добавить в любимое';}
 async function refresh(){
  const revision=++epoch,id=current()?.id;if(record?.trackId!==id)record=undefined;like.disabled=dislike.disabled=!record||!!id&&saving.has(id);paint();
  if(!isTauri()||!id||!/^\d+$/.test(id))return;
  try{const value=await call<Reaction>({type:'get',trackId:id});if(revision!==epoch||!value)return;if((value.generation??knownGeneration)<knownGeneration){void refresh();return;}knownGeneration=value.generation??knownGeneration;if(Array.isArray(value.excludedTrackIds))window.dispatchEvent(new CustomEvent('feedback-snapshot',{detail:{excluded:value.excludedTrackIds}}));window.dispatchEvent(new CustomEvent('feedback-observed',{detail:{trackId:id,state:value.state}}));record=value;like.disabled=dislike.disabled=saving.has(id);paint();}
  catch{if(revision===epoch){like.title=dislike.title='Реакции недоступны: проверьте подключение Яндекса';}}
 }
 function schedule(delay:number){clearTimeout(retry);retry=setTimeout(()=>void sync(),delay);}
 async function sync(){
  if(!isTauri())return;if(syncing){schedule(1000);return;}syncing=true;
  try{const value=await call<{pending:number}>({type:'sync'});if(!value)return;attempt=0;const wasPending=needsSync;needsSync=value.pending>0;if(wasPending&&!needsSync&&!notice.querySelector('button'))notice.textContent=(notice.dataset.action==='undo'?'Дизлайк отменён. ':'')+'Реакция синхронизирована с Яндексом.';await refresh();if(!needsSync)window.dispatchEvent(new Event('feedback-changed'));if(needsSync)schedule(1000);}
  catch(error){const denied=/Authorization|credential|token/i.test(String(error));if(needsSync&&!notice.querySelector('button'))notice.textContent=(notice.dataset.action==='undo'?'Дизлайк отменён. ':'')+(denied?'Яндекс не разрешил запись. Переподключите аккаунт; реакция сохранена на устройстве.':'Реакция сохранена на устройстве. Синхронизируем, когда Яндекс станет доступен.');schedule(denied?60000:Math.min(60000,2000*2**Math.min(attempt++,5)));}
  finally{syncing=false;}
 }
 function set(disliked:boolean){
  const previous=record;if(!previous||saving.has(previous.trackId))return;
  const id=previous.trackId,state=disliked?-1:previous.state===1?0:1;
  saving.add(id);like.disabled=dislike.disabled=true;record={...previous,state,pending:true};paint();
  clearTimeout(undoTimer);delete notice.dataset.action;notice.replaceChildren();
  const promise=call<Reaction>({type:'set',trackId:id,state});notify(id,state,true);
  if(disliked){
   const message=document.createElement('span');message.textContent='Трек не рекомендовать. ';
   const undo=document.createElement('button');undo.textContent='Отменить';undo.id='feedback-undo';undo.dataset.actionKey=String(++undoRevision);
   undo.onclick=()=>{undo.disabled=true;void promise.then(saved=>call<Reaction>({type:'set',trackId:id,state:previous.state,expected:saved.revision})).then(saved=>{knownGeneration=Math.max(knownGeneration,saved.generation??0);needsSync=true;notice.dataset.action='undo';notice.textContent='Дизлайк отменён. Текущий клип продолжается.';void sync();notify(id,previous.state);}).catch(()=>{notice.textContent='Не удалось отменить: реакция уже изменилась или хранилище недоступно.';});};
   notice.append(message,undo);undoTimer=setTimeout(()=>{undo.remove();},5000);next();
  }else notice.textContent=state===1?'Добавляем в любимое…':'Убираем из любимого…';
  void promise.then(saved=>{
   saving.delete(id);const accepted=(saved.generation??knownGeneration)>=knownGeneration;knownGeneration=Math.max(knownGeneration,saved.generation??0);needsSync=true;if(current()?.id===id){if(accepted)record=saved;like.disabled=dislike.disabled=!record;paint();}
   if(!disliked)notice.textContent='Реакция сохранена. Синхронизируем с Яндексом…';
   notify(id,state);void sync();
  }).catch(()=>{saving.delete(id);notify(id,previous.state);notice.textContent='Не удалось сохранить реакцию. Проверьте подключение аккаунта и локальное хранилище.';if(current()?.id===id){if((record?.generation??0)<=(previous.generation??0))record=previous;void refresh();}});
 }
 like.onclick=()=>set(false);dislike.onclick=()=>set(true);
 window.addEventListener('online',()=>{attempt=0;void sync();});
 let focusTimer:ReturnType<typeof setTimeout>|undefined,lastFocus=-Infinity;
 const focusRefresh=()=>{if(!current())return;clearTimeout(focusTimer);focusTimer=setTimeout(()=>{lastFocus=performance.now();void sync();},Math.max(250,3000-(performance.now()-lastFocus)));};
 window.addEventListener('focus',focusRefresh);
 const interval=setInterval(()=>{void sync();},60000);
 window.addEventListener('beforeunload',()=>{clearInterval(interval);clearTimeout(retry);clearTimeout(undoTimer);clearTimeout(focusTimer);window.removeEventListener('focus',focusRefresh);});
 schedule(1000);
 return ()=>void refresh();
}
