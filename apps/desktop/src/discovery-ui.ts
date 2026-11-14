import {setIconLabel} from './icons';
import {bindPlaybackRow} from './playback-rows';
import {invoke,isTauri} from '@tauri-apps/api/core';
import type {CatalogueEntity,CatalogueSelection} from './catalogue-ui';
import type {Track} from './queue';
interface Discovery {title:string;tracks:Track[];playlists:CatalogueEntity[];personal_playlists?:CatalogueEntity[];new_releases?:CatalogueEntity[];playlistsAvailable?:boolean}
export function mountDiscovery(select:(selection:CatalogueSelection)=>void,browse:(entity:CatalogueEntity)=>void){
 const root=document.getElementById('discovery')!;
 root.innerHTML='<div class="library-heading discovery-actions"><button id="discovery-refresh">Обновить</button></div><p id="discovery-status" role="status"></p><div id="discovery-content"></div>';
 const status=document.getElementById('discovery-status')!,content=document.getElementById('discovery-content')!;let loaded=false,revision=0;
 async function refresh(){
  if(!isTauri()){status.textContent='Чарты доступны в приложении YCore Music, в том числе без входа.';return;}
  const epoch=++revision;status.textContent='Загрузка актуального чарта…';
  try{const value=await invoke<Discovery>('discovery_fetch');if(epoch!==revision)return;loaded=true;content.replaceChildren();
   const chart=document.createElement('section');
   const playAll=document.createElement('button');playAll.id='discovery-play-all';setIconLabel(playAll,'play',"Включить чарт",false);playAll.disabled=!value.tracks.length;playAll.onclick=()=>select({tracks:value.tracks,title:value.title});chart.append(playAll);
   for(const [index,track] of value.tracks.entries()){
    const row=document.createElement('div');row.className='catalogue-track discovery-track';const number=document.createElement('span');number.className='chart-position';number.textContent=String(index+1);
    const text=document.createElement('span');text.className='track-text';const title=document.createElement('strong'),artist=document.createElement('small');title.textContent=track.title;artist.textContent=track.artist;text.append(title,artist);
    const play=document.createElement('button');bindPlaybackRow(row,play,track,()=>select({tracks:value.tracks.slice(index),title:value.title}));row.append(number,text,play);chart.append(row);
   }
   const sections:[string,CatalogueEntity[]][]=[
    ['Для вас',value.personal_playlists??[]],
    ['Новые релизы',value.new_releases??[]],
    ['Подборки Яндекс Музыки',value.playlists],
   ];
   for(const [label,items] of sections){
    const heading=document.createElement('h3');heading.textContent=label;content.append(heading);
    if(!items.length){
     const empty=document.createElement('p');empty.className='panel-description';
     empty.textContent=label==='Для вас'?'Персональные подборки недоступны. Проверь вход в Яндекс Музыку.':'Яндекс Музыка не вернула данные для этого раздела.';
     content.append(empty);
    }
    for(const entity of items){
     const button=document.createElement('button');button.type='button';button.className='catalogue-card library-playlist';
     const title=document.createElement('strong');title.textContent=entity.title;button.append(title);
     button.onclick=()=>browse(entity);content.append(button);
    }
   }
   content.append(chart);
   status.textContent='Обновлено в '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+' · порядок Яндекс Музыки';
   if(value.playlistsAvailable===false)status.textContent+=' · Подборки сейчас недоступны. Публичные плейлисты можно найти через поиск.';
  }catch{if(epoch===revision)status.textContent='Не удалось обновить чарт. Проверьте сеть и повторите.';}
 }
 root.addEventListener('discovery-open',()=>{if(!loaded)void refresh();});document.getElementById('discovery-refresh')!.onclick=()=>void refresh();
}
