import {setIconLabel} from './icons';
import {bindPlaybackRow} from './playback-rows';
import {invoke,isTauri} from '@tauri-apps/api/core';
import type {CatalogueEntity,CatalogueSelection} from './catalogue-ui';
import type {Track} from './queue';
interface Discovery {title:string;tracks:Track[];playlists:CatalogueEntity[];playlistsAvailable?:boolean}
export function mountDiscovery(select:(selection:CatalogueSelection)=>void,browse:(entity:CatalogueEntity)=>void){
 const root=document.getElementById('discovery')!;
 root.innerHTML='<div class="library-heading discovery-actions"><button id="discovery-refresh">Обновить</button></div><p id="discovery-status" role="status"></p><div id="discovery-content"></div>';
 const status=document.getElementById('discovery-status')!,content=document.getElementById('discovery-content')!;let loaded=false,revision=0;
 async function refresh(){
  if(!isTauri()){status.textContent='Чарты доступны в приложении YCore Music, в том числе без входа.';return;}
  const epoch=++revision;status.textContent='Загрузка актуального чарта…';
  try{const value=await invoke<Discovery>('discovery_fetch');if(epoch!==revision)return;loaded=true;content.replaceChildren();
   const playAll=document.createElement('button');playAll.id='discovery-play-all';setIconLabel(playAll,'play',"Включить чарт",false);playAll.disabled=!value.tracks.length;playAll.onclick=()=>select({tracks:value.tracks,title:value.title});content.append(playAll);
   for(const [index,track] of value.tracks.entries()){
    const row=document.createElement('div');row.className='catalogue-track discovery-track';const number=document.createElement('span');number.className='chart-position';number.textContent=String(index+1);
    const text=document.createElement('span');text.className='track-text';const title=document.createElement('strong'),artist=document.createElement('small');title.textContent=track.title;artist.textContent=track.artist;text.append(title,artist);
    const play=document.createElement('button');bindPlaybackRow(row,play,track,()=>select({tracks:value.tracks.slice(index),title:value.title}));row.append(number,text,play);content.append(row);
   }
   if(value.playlists.length){const h=document.createElement('h3');h.textContent='Подборки Яндекс Музыки';content.append(h);for(const entity of value.playlists){const b=document.createElement('button');b.className='catalogue-card library-playlist';const title=document.createElement('strong');title.textContent=entity.title;b.append(title);b.onclick=()=>browse(entity);content.append(b);}}
   status.textContent='Обновлено в '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+' · порядок Яндекс Музыки';
   if(value.playlistsAvailable===false)status.textContent+=' · Подборки сейчас недоступны. Публичные плейлисты можно найти через поиск.';
  }catch{if(epoch===revision)status.textContent='Не удалось обновить чарт. Проверьте сеть и повторите.';}
 }
 root.addEventListener('discovery-open',()=>{if(!loaded)void refresh();});document.getElementById('discovery-refresh')!.onclick=()=>void refresh();
}
