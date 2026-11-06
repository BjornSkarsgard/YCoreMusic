import {historyRange} from './history-range';
import {isTauri} from '@tauri-apps/api/core';
import {storage,type HistoryEntry} from './storage';
import {markSkipped,historySkipReason} from './skip-notices';
import {bindPlaybackRow} from './playback-rows';

/** History browsing owns no playback cursor; actions go through the coordinator. */
export function mountHistory(play:(entry:HistoryEntry)=>void,enqueue:(entry:HistoryEntry,next:boolean)=>void,beforeClear:()=>Promise<void>=async()=>{}){
 const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 const input=get<HTMLInputElement>('history-query'),list=get('history-list'),more=get<HTMLButtonElement>('history-more'),status=get('history-status');
 const from=get<HTMLInputElement>('history-from'),until=get<HTMLInputElement>('history-until');
 const key=()=>JSON.stringify([input.value.trim(),from.value,until.value]);
 let revision=0,entries:HistoryEntry[]=[],shownKey='',shownDescription='',hasMore=false,deleting=false;
 let timer:ReturnType<typeof setTimeout>|undefined;
 function busy(value:boolean){
  list.inert=value;list.setAttribute('aria-busy',String(value));
  more.disabled=value||key()!==shownKey;more.hidden=!hasMore;
 }
 function row(entry:HistoryEntry){
  const item=document.createElement('li'),text=document.createElement('span'),title=document.createElement('strong'),artist=document.createElement('small'),date=document.createElement('time');
  title.textContent=entry.title;artist.textContent=entry.artist;date.dateTime=entry.startedAt;date.textContent=new Date(entry.startedAt).toLocaleString('ru-RU');text.append(title,artist,date);
  if(typeof entry.listenedMs==='number'){
   const details=document.createElement('small'),seconds=Math.floor(entry.listenedMs/1000);
   const sources:Record<string,string>={my_wave:'Моя волна',smart_history:'Умная история',catalogue:'Каталог',history:'История',manual:'Свой клип'};
   const reasons:Record<string,string>={natural:'Завершён',skip:'Пропущен',dislike:'Дизлайк',error:'Ошибка видео',source_change:'Смена источника',video_change:'Другая версия',shutdown:'Выход из YCore Music',interrupted:'Прерван'};
   details.className='history-listening';details.textContent=[sources[entry.source??''],`Прослушано ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,reasons[entry.endReason??'']].filter(Boolean).join(' · ');text.append(details);
  }
  const now=document.createElement('button'),next=document.createElement('button'),append=document.createElement('button');
  bindPlaybackRow(item,now,{id:entry.trackId,title:entry.title},()=>play(entry),{iconOnly:false});
  next.textContent='Следом';next.onclick=()=>enqueue(entry,true);
  append.textContent='В конец';append.onclick=()=>enqueue(entry,false);
  item.append(text,now,next,append);const cause=historySkipReason(entry.endReason);if(cause)markSkipped(item,entry.title+' · '+entry.artist,cause);return item;
 }
 async function refresh(append=false){
  if(deleting)return;
  clearTimeout(timer);const version=++revision,query=input.value.trim(),requestedKey=key();
  const beforeId=append&&requestedKey===shownKey?entries.at(-1)?.id:undefined;
  let range;try{range=historyRange(from.value,until.value);}catch(error){busy(false);status.textContent=(error instanceof Error?error.message:'Укажите корректный период.')+(entries.length?' Показаны предыдущие записи.':'');return;}
  if(append&&!beforeId)return;
  if(!isTauri()){busy(false);status.textContent='История доступна в desktop-версии.';return;}
  busy(true);status.textContent=append?'Загружаем более ранние прослушивания…':'Загружаем историю…';
  try{
   const received=await storage<HistoryEntry[]>({type:'history',query,beforeId:beforeId??null,...range});
   if(version!==revision)return;
   if(!Array.isArray(received))throw new Error('Invalid history response');
   if(append){entries.push(...received);list.append(...received.map(row));}else{entries=received;list.replaceChildren(...entries.map(row));}
   shownKey=requestedKey;shownDescription=[query?'для «'+query+'»':'',from.value?'с '+from.value:'',until.value?'по '+until.value:''].filter(Boolean).join(' ');hasMore=received.length===100;
   status.textContent=entries.length?'Показано записей: '+entries.length+(hasMore?'. Можно загрузить более ранние.':'.'):(query||from.value||until.value)?'По выбранным условиям записей нет.':'История пока пуста.';
  }catch{
   if(version===revision)status.textContent='Не удалось прочитать историю. Повторите попытку.'+(entries.length?' Показаны предыдущие записи'+(shownDescription?' '+shownDescription:'')+'.':'');
  }finally{if(version===revision)busy(false);}
 }
 input.oninput=()=>{++revision;clearTimeout(timer);busy(true);timer=setTimeout(()=>void refresh(),200);};
 function periodChanged(){
  ++revision;clearTimeout(timer);busy(true);
  get('history-period-summary').textContent='Период'+(from.value?' · с '+from.value:'')+(until.value?' · по '+until.value:'');
  void refresh();
 }
 from.onchange=until.onchange=periodChanged;
 get('history-period-clear').onclick=()=>{from.value=until.value='';periodChanged();};
 get('history-refresh').onclick=()=>void refresh();more.onclick=()=>void refresh(true);
 get<HTMLDetailsElement>('history-panel').ontoggle=()=>{if(get<HTMLDetailsElement>('history-panel').open)void refresh();};
 get('history-clear').onclick=()=>{get('clear-status').textContent='';get<HTMLDialogElement>('clear-dialog').showModal();};
 get('clear-cancel').onclick=()=>get<HTMLDialogElement>('clear-dialog').close();
 get<HTMLButtonElement>('clear-confirm').onclick=async()=>{
  if(deleting)return;deleting=true;++revision;clearTimeout(timer);busy(true);get('clear-status').textContent='';
  const buttons=['clear-confirm','clear-cancel','history-clear','history-refresh','history-period-clear'].map(id=>get<HTMLButtonElement>(id));
  buttons.forEach(button=>button.disabled=true);input.disabled=from.disabled=until.disabled=true;
  try{
   await beforeClear();await storage({type:'clear_history'});entries=[];shownKey='';shownDescription='';hasMore=false;list.replaceChildren();
   get<HTMLDialogElement>('clear-dialog').close();deleting=false;await refresh();
  }catch{status.textContent='Не удалось очистить историю. Существующие записи сохранены.';get('clear-status').textContent=status.textContent;}
  finally{deleting=false;buttons.forEach(button=>button.disabled=false);input.disabled=from.disabled=until.disabled=false;busy(false);}
 };
}
