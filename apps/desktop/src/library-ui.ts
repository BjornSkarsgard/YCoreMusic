import {setIconLabel} from './icons';
import {bindPlaybackRow} from './playback-rows';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {collectionPage,type CatalogueEntity,type CatalogueSelection} from './catalogue-ui';
import type {Track} from './queue';
interface Overview {playlists:CatalogueEntity[];liked_count:number}
export function mountLibrary(select:(selection:CatalogueSelection)=>void){
 const root=document.getElementById('library')!;
 root.innerHTML='<div class="library-heading"><h2>Моя музыка</h2><button id="library-refresh">Обновить</button></div><p id="library-status" role="status"></p><div id="library-content"></div>';
 const status=document.getElementById('library-status')!,content=document.getElementById('library-content')!;
 let overview:Overview|undefined,revision=0,stale=false,loadedAt=0;
 function button(text:string,action:()=>void){const b=document.createElement('button');b.textContent=text;b.onclick=action;return b;}
 function home(){
  ++revision;if(!overview)return;content.replaceChildren();
  const likes=button('Мне нравится · '+overview.liked_count,()=>void open({kind:'likes',id:'0',title:'Мне нравится',subtitle:''}));likes.id='library-likes';likes.className='library-likes';setIconLabel(likes,'heart','Мне нравится · '+overview.liked_count);content.append(likes);
  const heading=document.createElement('h3');heading.textContent='Мои плейлисты';content.append(heading);
  if(!overview.playlists.length){const p=document.createElement('p');p.textContent='В Яндекс Музыке пока нет сохранённых плейлистов.';content.append(p);}
  for(const entity of overview.playlists){const b=button('',()=>void open(entity));b.className='catalogue-card library-playlist';const title=document.createElement('strong'),subtitle=document.createElement('span');title.textContent=entity.title;subtitle.textContent=entity.subtitle;b.append(title,subtitle);content.append(b);}
 }
 async function refresh(){
  if(!isTauri()){status.textContent='Подключите Яндекс в desktop-версии YCore Music.';return;}
  const epoch=++revision;status.textContent='Загрузка твоей музыки…';
  try{const value=await invoke<Overview>('library_overview');if(epoch!==revision)return;overview=value;stale=false;loadedAt=Date.now();home();status.textContent='Твои плейлисты и любимые треки из Яндекс Музыки.';}
  catch(error){if(epoch===revision)status.textContent=/Authorization|credential|token/i.test(String(error))?'Для личных плейлистов и любимых треков войдите: Настройки → Яндекс Музыка. Поиск и чарт доступны без входа.':'Не удалось загрузить медиатеку. Проверьте сеть и подключение Яндекса.';}
 }
 async function open(entity:CatalogueEntity){
  const epoch=++revision;let tracks:Track[]=[],page=0,hasMore=false,busy=false;
  content.replaceChildren(button('Моя музыка',()=>{home();status.textContent='Твои плейлисты и любимые треки из Яндекс Музыки.';}));setIconLabel(content.firstElementChild as HTMLElement,'back','Моя музыка');
  const heading=document.createElement('h3');heading.textContent=entity.title;
  const playAll=button('Воспроизвести список',()=>select({tracks:[...tracks],title:entity.title,collection:{entity,page,hasMore}}));setIconLabel(playAll,'play','Воспроизвести список');playAll.disabled=true;playAll.id='library-play-all';
  const rows=document.createElement('div'),more=button('Ещё песни',()=>void load(page+1));more.className='library-more';more.hidden=true;content.append(heading,playAll,rows,more);
  const pane=root.closest('.panel-scroll');if(pane)pane.scrollTop=0;
  async function load(next:number){
   if(busy)return;busy=true;more.disabled=true;status.textContent='Загрузка списка…';
   try{const result=await collectionPage(entity,next);if(epoch!==revision)return;tracks.push(...result.tracks);page=next;hasMore=result.hasMore;
    rows.replaceChildren(...tracks.map((track,index)=>{const row=document.createElement('div');row.className='catalogue-track';const text=document.createElement('span');text.className='track-text';const title=document.createElement('strong'),artist=document.createElement('small');title.textContent=track.title;artist.textContent=track.artist;text.append(title,artist);const play=document.createElement('button');bindPlaybackRow(row,play,track,()=>select({tracks:tracks.slice(index),title:entity.title,collection:{entity,page,hasMore}}));row.append(text,play);return row;}));
    playAll.disabled=!tracks.length;more.hidden=!hasMore;status.textContent=tracks.length?'Список загружен.':'В этом списке пока нет треков.';
   }catch{if(epoch===revision)status.textContent='Не удалось открыть список. Попробуйте обновить медиатеку.';}
   finally{busy=false;more.disabled=false;}
  }
  await load(0);
 }
 document.getElementById('library-refresh')!.onclick=()=>void refresh();
 window.addEventListener('feedback-changed',()=>{stale=true;});
 root.addEventListener('library-open',()=>{if(!overview||stale||Date.now()-loadedAt>60000)void refresh();});
}
