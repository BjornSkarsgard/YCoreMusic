import {setIconLabel} from './icons';
import {bindPlaybackRow} from './playback-rows';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {collectionPage,collectionWaveButton,type CatalogueEntity,type CatalogueSelection,type StartRelatedWave} from './catalogue-ui';
import type {Track} from './queue';
interface Overview {playlists:CatalogueEntity[];liked_count:number;owned_playlists?:CatalogueEntity[];albums?:CatalogueEntity[]|null}
export function mountLibrary(select:(selection:CatalogueSelection)=>void,startWave:StartRelatedWave,currentTrack:()=>Track|undefined){
 const root=document.getElementById('library')!;
 root.innerHTML='<div class="library-heading"><h2>Моя музыка</h2><button id="library-refresh">Обновить</button></div><p id="library-status" role="status"></p><div id="library-content"></div>';
 const status=document.getElementById('library-status')!,content=document.getElementById('library-content')!;
 let overview:Overview|undefined,revision=0,stale=false,loadedAt=0;
 function button(text:string,action:()=>void){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;return b;}
 let editing=false;
 async function edit(action:Record<string,unknown>,success:()=>Promise<void>,message:string){
  if(editing)return;
  editing=true;status.textContent='Сохраняем в Яндекс Музыке…';
  const before=revision;
  try{
   await invoke('library_edit',{action});stale=true;
   if(before===revision){await success();status.textContent=message;}
  }catch(error){if(before===revision)status.textContent=String(error).includes('Playlist changed')?'Плейлист изменился в Яндексе. Откройте его заново.':'Не удалось подтвердить изменение. Обновите список перед повтором.';}
  finally{editing=false;}
 }
 function home(){
  ++revision;if(!overview)return;content.replaceChildren();
  const likes=button('Мне нравится · '+overview.liked_count,()=>void open({kind:'likes',id:'0',title:'Мне нравится',subtitle:''}));likes.id='library-likes';likes.className='library-likes';setIconLabel(likes,'heart','Мне нравится · '+overview.liked_count);content.append(likes);
  const heading=document.createElement('h3');heading.textContent='Мои плейлисты';content.append(heading);
  const create=document.createElement('form');create.className='input-row';
  const name=document.createElement('input');name.placeholder='Название нового плейлиста';name.setAttribute('aria-label',name.placeholder);name.required=true;name.maxLength=100;
  const submit=document.createElement('button');submit.textContent='Создать';create.append(name,submit);
  create.onsubmit=event=>{event.preventDefault();if(name.value.trim())void edit({type:'create',title:name.value.trim()},refresh,'Плейлист создан.');};
  content.append(create);
  if(!overview.playlists.length){const p=document.createElement('p');p.textContent='В Яндекс Музыке пока нет сохранённых плейлистов.';content.append(p);}
  for(const entity of overview.playlists){const b=button('',()=>void open(entity));b.className='catalogue-card library-playlist';const title=document.createElement('strong'),subtitle=document.createElement('span');title.textContent=entity.title;subtitle.textContent=entity.subtitle;b.append(title,subtitle);content.append(b);}
  if(overview.albums?.length){
   const heading=document.createElement('h3');heading.textContent='Сохранённые альбомы';content.append(heading);
   for(const album of overview.albums){
    const card=button(album.title,()=>void open(album));card.className='catalogue-card library-playlist';content.append(card);
   }
  }
 }
 async function refresh(){
  if(!isTauri()){status.textContent='Подключите Яндекс в desktop-версии YCore Music.';return;}
  const epoch=++revision;status.textContent='Загрузка твоей музыки…';
  try{const value=await invoke<Overview>('library_overview');if(epoch!==revision)return;overview=value;stale=false;loadedAt=Date.now();home();status.textContent='Твои плейлисты и любимые треки из Яндекс Музыки.';}
  catch(error){if(epoch===revision)status.textContent=/Authorization|credential|token/i.test(String(error))?'Для личных плейлистов и любимых треков войдите: Настройки → Яндекс Музыка. Поиск и чарт доступны без входа.':'Не удалось загрузить медиатеку. Проверьте сеть и подключение Яндекса.';}
 }
 async function open(entity:CatalogueEntity){
  const epoch=++revision;let tracks:Track[]=[],page=0,hasMore=false,busy=false,playlistRevision:number|null|undefined;
  const owned=overview?.owned_playlists?.some(item=>item.id===entity.id&&item.owner===entity.owner);
  content.replaceChildren(button('Моя музыка',()=>{home();status.textContent='Твои плейлисты и любимые треки из Яндекс Музыки.';}));setIconLabel(content.firstElementChild as HTMLElement,'back','Моя музыка');
  const heading=document.createElement('h3');heading.textContent=entity.title;
  const playAll=button('Воспроизвести список',()=>select({tracks:[...tracks],title:entity.title,collection:{entity,page,hasMore}}));setIconLabel(playAll,'play','Воспроизвести список');playAll.disabled=true;playAll.id='library-play-all';
  const actions=document.createElement('div');actions.className='source-actions';actions.append(playAll);
  const wave=collectionWaveButton(entity,startWave);if(wave)actions.append(wave);
  if(owned)actions.append(button('Добавить текущий трек',()=>{
   const track=currentTrack();
   if(!track||!/^[0-9]{1,64}$/.test(track.id)){status.textContent='Выберите трек из Яндекс Музыки.';return;}
   void edit({type:'insert',kind:entity.id,track:track.id},()=>open(entity),'Трек добавлен.');
  }));
  if(entity.kind==='album')actions.append(button('Убрать альбом из коллекции',()=>void edit({type:'save_album',id:entity.id,save:false},refresh,'Альбом убран из коллекции.')));
  const rows=document.createElement('div'),more=button('Ещё песни',()=>void load(page+1));more.className='library-more';more.hidden=true;content.append(heading,actions,rows,more);
  const pane=root.closest('.panel-scroll');if(pane)pane.scrollTop=0;
  async function load(next:number){
   if(busy)return;busy=true;more.disabled=true;status.textContent='Загрузка списка…';
   try{const result=await collectionPage(entity,next);if(epoch!==revision)return;
    if(next>0&&owned&&result.revision!==playlistRevision){status.textContent='Плейлист изменился. Откройте его заново.';return;}
    playlistRevision=result.revision;tracks.push(...result.tracks);page=next;hasMore=result.hasMore;
    rows.replaceChildren(...tracks.map((track,index)=>{
     const row=document.createElement('div');row.className='catalogue-track';
     const text=document.createElement('span');text.className='track-text';
     const title=document.createElement('strong'),artist=document.createElement('small');title.textContent=track.title;artist.textContent=track.artist;text.append(title,artist);
     const play=document.createElement('button');bindPlaybackRow(row,play,track,()=>select({tracks:tracks.slice(index),title:entity.title,collection:{entity,page,hasMore}}));row.append(text,play);
     if(owned&&playlistRevision!=null){
      const controls=document.createElement('div');controls.className='playlist-edit-actions';
      for(const [label,direction] of [['Поднять',-1],['Опустить',1],['Убрать',0]] as const){
       const editRow=button(label,()=>void edit({type:'change_row',kind:entity.id,revision:playlistRevision,index,direction},()=>open(entity),'Плейлист обновлён.'));
       editRow.disabled=(direction===-1&&index===0)||(direction===1&&index===tracks.length-1&&!hasMore);
       editRow.setAttribute('aria-label',label+' · '+track.title);controls.append(editRow);
      }
      row.append(controls);
     }
     return row;
    }));
    playAll.disabled=!tracks.length;more.hidden=!hasMore;status.textContent=tracks.length?'Список загружен.':'В этом списке пока нет треков.';
   }catch{if(epoch===revision)status.textContent='Не удалось открыть список. Попробуйте обновить медиатеку.';}
   finally{busy=false;more.disabled=false;}
  }
  await load(0);
 }
 document.getElementById('library-refresh')!.onclick=()=>void refresh();
 window.addEventListener('feedback-changed',()=>{stale=true;});
 window.addEventListener('library-changed',()=>{stale=true;});
 root.addEventListener('library-open',()=>{if(!overview||stale||Date.now()-loadedAt>60000)void refresh();});
}
