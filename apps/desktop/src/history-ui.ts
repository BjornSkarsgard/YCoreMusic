import {isTauri} from '@tauri-apps/api/core';
import {storage,type HistoryEntry} from './storage';

/** History browsing owns no playback cursor; actions go through the coordinator. */
export function mountHistory(play:(entry:HistoryEntry)=>void,enqueue:(entry:HistoryEntry,next:boolean)=>void){
 const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 const input=get<HTMLInputElement>('history-query'),list=get('history-list'),more=get<HTMLButtonElement>('history-more'),status=get('history-status');
 let revision=0,entries:HistoryEntry[]=[],shownQuery='',hasMore=false,deleting=false;
 let timer:ReturnType<typeof setTimeout>|undefined;
 function busy(value:boolean){
  list.inert=value;list.setAttribute('aria-busy',String(value));
  more.disabled=value||input.value.trim()!==shownQuery;more.hidden=!hasMore;
 }
 function row(entry:HistoryEntry){
  const item=document.createElement('li'),text=document.createElement('span'),title=document.createElement('strong'),artist=document.createElement('small'),date=document.createElement('time');
  title.textContent=entry.title;artist.textContent=entry.artist;date.dateTime=entry.startedAt;date.textContent=new Date(entry.startedAt).toLocaleString('ru-RU');text.append(title,artist,date);
  const now=document.createElement('button'),next=document.createElement('button'),append=document.createElement('button');
  now.textContent='Воспроизвести';now.onclick=()=>play(entry);
  next.textContent='Следом';next.onclick=()=>enqueue(entry,true);
  append.textContent='В конец';append.onclick=()=>enqueue(entry,false);
  item.append(text,now,next,append);return item;
 }
 async function refresh(append=false){
  if(deleting)return;
  clearTimeout(timer);const version=++revision,query=input.value.trim();
  const beforeId=append&&query===shownQuery?entries.at(-1)?.id:undefined;
  if(append&&!beforeId)return;
  if(!isTauri()){busy(false);status.textContent='История доступна в desktop-версии.';return;}
  busy(true);status.textContent=append?'Загружаем более ранние прослушивания…':'Загружаем историю…';
  try{
   const received=await storage<HistoryEntry[]>({type:'history',query,beforeId:beforeId??null});
   if(version!==revision)return;
   if(!Array.isArray(received))throw new Error('Invalid history response');
   if(append){entries.push(...received);list.append(...received.map(row));}else{entries=received;list.replaceChildren(...entries.map(row));}
   shownQuery=query;hasMore=received.length===100;
   status.textContent=entries.length?'Показано записей: '+entries.length+(hasMore?'. Можно загрузить более ранние.':'.'):query?'В истории ничего не найдено.':'История пока пуста.';
  }catch{
   if(version===revision)status.textContent='Не удалось прочитать историю. Повторите попытку.'+(entries.length?' Показаны предыдущие записи'+(shownQuery?' для «'+shownQuery+'»':'')+'.':'');
  }finally{if(version===revision)busy(false);}
 }
 input.oninput=()=>{++revision;clearTimeout(timer);busy(true);timer=setTimeout(()=>void refresh(),200);};
 get('history-refresh').onclick=()=>void refresh();more.onclick=()=>void refresh(true);
 get<HTMLDetailsElement>('history-panel').ontoggle=()=>{if(get<HTMLDetailsElement>('history-panel').open)void refresh();};
 get('history-clear').onclick=()=>{get('clear-status').textContent='';get<HTMLDialogElement>('clear-dialog').showModal();};
 get('clear-cancel').onclick=()=>get<HTMLDialogElement>('clear-dialog').close();
 get<HTMLButtonElement>('clear-confirm').onclick=async()=>{
  if(deleting)return;deleting=true;++revision;clearTimeout(timer);busy(true);get('clear-status').textContent='';
  const buttons=['clear-confirm','clear-cancel','history-clear','history-refresh'].map(id=>get<HTMLButtonElement>(id));
  buttons.forEach(button=>button.disabled=true);input.disabled=true;
  try{
   await storage({type:'clear_history'});entries=[];shownQuery='';hasMore=false;list.replaceChildren();
   get<HTMLDialogElement>('clear-dialog').close();deleting=false;await refresh();
  }catch{status.textContent='Не удалось очистить историю. Существующие записи сохранены.';get('clear-status').textContent=status.textContent;}
  finally{deleting=false;buttons.forEach(button=>button.disabled=false);input.disabled=false;busy(false);}
 };
}
