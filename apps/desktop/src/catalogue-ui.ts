import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Track } from './queue';
export interface CatalogueEntity {kind:'artist'|'album'|'playlist'|'likes';id:string;owner?:string;title:string;subtitle:string}
export interface CatalogueCollection {title:string;tracks:Track[];hasMore:boolean;page:number}
interface Results {corrected?:string;artists:CatalogueEntity[];tracks:Track[];albums:CatalogueEntity[];playlists:CatalogueEntity[];page:number}
export interface CollectionContext {entity:CatalogueEntity;page:number;hasMore:boolean}
export interface CatalogueSelection {tracks:Track[];title:string;collection?:CollectionContext}
export function collectionPage(entity:CatalogueEntity,page:number):Promise<CatalogueCollection>{return invoke('catalogue_collection',{kind:entity.kind,id:entity.id,owner:entity.owner??null,page});}
export function mountCatalogue(select:(selection:CatalogueSelection)=>void){
 const root=document.getElementById('catalogue')!;
 root.innerHTML=`<h2>Поиск в Яндекс Музыке</h2><form id="catalogue-search"><label for="catalogue-query">Исполнитель, песня, альбом или плейлист</label><div class="input-row"><input id="catalogue-query" placeholder="Например, рамштайн" autocomplete="off"><button>Найти</button></div></form><p id="catalogue-status" role="status"></p><div id="catalogue-filters" class="catalogue-filters" aria-label="Тип результатов"></div><div id="catalogue-results"></div><button id="catalogue-more" hidden>Ещё результаты</button><section id="catalogue-collection" hidden></section>`;
 const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 let searchRevision=0,collectionRevision=0,page=0,query='',timer:ReturnType<typeof setTimeout>|undefined;
 let filter='Всё';
 let results:Results={artists:[],tracks:[],albums:[],playlists:[],page:0};
 let opened:{entity:CatalogueEntity;tracks:Track[];page:number;hasMore:boolean}|undefined;
 let browsingCollection=false,hasSearchMore=false,resultsScroll=0;
 let collectionReturn:(()=>void)|undefined;
 let returnFocus:HTMLElement|undefined;
 const scrollPane=()=>root.closest('.panel-scroll') as HTMLElement|null;
 function collectionView(show:boolean){
   browsingCollection=show;
   get('catalogue-results').hidden=show;
   get('catalogue-filters').hidden=show;
   get('catalogue-more').hidden=show||!hasSearchMore;
   get('catalogue-collection').hidden=!show;
 }
 function backButton(){
   const button=document.createElement('button');button.type='button';button.id='catalogue-back';button.textContent=collectionReturn?'← К обзору':'← К результатам поиска';
   button.onclick=()=>{
     ++collectionRevision;opened=undefined;collectionView(false);
     get('catalogue-status').textContent='Результаты Яндекс Музыки.';
     const pane=scrollPane();if(pane)pane.scrollTop=resultsScroll;
     if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
     const back=collectionReturn;collectionReturn=undefined;back?.();
   };
   return button;
 }
 function play(tracks:Track[],title:string,context?:CollectionContext){select({tracks,title,collection:context});}
 function trackRows(tracks:Track[],onPlay:(index:number)=>void){
   return tracks.map((track,index)=>{
     const row=document.createElement('div');row.className='catalogue-track';
     const text=document.createElement('span');text.className='track-text';const title=document.createElement('strong'),artist=document.createElement('small');title.textContent=track.title;artist.textContent=track.artist;text.append(title,artist);
     const button=document.createElement('button');button.type='button';button.textContent='▶';button.setAttribute('aria-label','Воспроизвести '+track.title);button.onclick=()=>onPlay(index);
     row.append(text,button);return row;
   });
 }
 function render(){
   const container=get('catalogue-results');container.replaceChildren();
   get('catalogue-filters').replaceChildren(...['Всё','Треки','Исполнители','Альбомы','Плейлисты'].map(name=>{const button=document.createElement('button');button.textContent=name;button.setAttribute('aria-pressed',String(name===filter));button.onclick=()=>{filter=name;render();};return button;}));
   const sections:[string,CatalogueEntity[]][]=[['Исполнители',results.artists],['Альбомы',results.albums],['Плейлисты',results.playlists]];
   for(const [name,entities] of sections){
     if(!entities.length || (filter!=='Всё'&&filter!==name))continue;
     const section=document.createElement('section'),heading=document.createElement('h3'),cards=document.createElement('div');heading.textContent=name;cards.className='catalogue-cards'+(name==='Исполнители'?' catalogue-artists':'');
     for(const entity of entities){const button=document.createElement('button');button.type='button';button.className='catalogue-card';button.dataset.initial=entity.title.slice(0,1);const title=document.createElement('strong'),subtitle=document.createElement('span');title.textContent=entity.title;subtitle.textContent=entity.subtitle;button.append(title,subtitle);button.onclick=()=>void open(entity,false);cards.append(button);}
     section.append(heading,cards);container.append(section);
     if(name==='Исполнители'&&results.tracks.length&&filter==='Всё')renderTracks(container);
   }
   if(results.tracks.length&&(filter==='Треки'||(!results.artists.length&&filter==='Всё')))renderTracks(container);
   if(!container.childElementCount){const empty=document.createElement('p');empty.className='panel-description';empty.textContent=filter==='Всё'?'Ничего не найдено.':'В разделе «'+filter+'» пока нет результатов. Попробуйте другой фильтр или запрос.';container.append(empty);}
 }
 function renderTracks(container:HTMLElement){const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent='Треки';section.append(heading,...trackRows(results.tracks,index=>play([results.tracks[index]],results.tracks[index].title)));container.append(section);}
 function renderCollection(){
   if(!opened)return;
   const value=opened,container=get('catalogue-collection');container.hidden=false;container.replaceChildren();
   const heading=document.createElement('h3');heading.textContent=value.entity.title;
   const playAll=document.createElement('button');playAll.id='catalogue-play-all';playAll.textContent='▶ Воспроизвести список';playAll.disabled=!value.tracks.length;playAll.onclick=()=>play([...value.tracks],value.entity.title,{entity:value.entity,page:value.page,hasMore:value.hasMore});
   const more=document.createElement('button');more.textContent='Ещё песни';more.hidden=!value.hasMore;more.onclick=()=>void open(value.entity,true);
   container.append(backButton(),heading,playAll,...trackRows(value.tracks,index=>play(value.tracks.slice(index),value.entity.title,{entity:value.entity,page:value.page,hasMore:value.hasMore})),more);
 }
 async function open(entity:CatalogueEntity,append:boolean){
   const revision=++collectionRevision;
   const requestedPage=append&&opened?opened.page+1:0;
   const container=get('catalogue-collection');
   if(!append){
     if(!browsingCollection){resultsScroll=scrollPane()?.scrollTop??0;returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;}
     opened=undefined;container.replaceChildren(backButton());
   }
   collectionView(true);if(!append){const pane=scrollPane();if(pane)pane.scrollTop=0;}
   get('catalogue-status').textContent='Загрузка списка…';
   try{
     const response=await collectionPage(entity,requestedPage);
     if(revision!==collectionRevision)return;
     opened={entity,tracks:append&&opened?[...opened.tracks,...response.tracks]:response.tracks,page:requestedPage,hasMore:response.hasMore};
     renderCollection();get('catalogue-status').textContent=opened.tracks.length?'Список загружен. Текущее воспроизведение не менялось.':'В этом списке нет доступных записей.';
   }catch{if(revision===collectionRevision)get('catalogue-status').textContent='Не удалось открыть список. Проверьте доступ или повторите.';}
 }
 async function search(append:boolean){
   clearTimeout(timer);
   const text=get<HTMLInputElement>('catalogue-query').value.trim();
   const revision=++searchRevision;
   if(text.length<2){get('catalogue-status').textContent='Введите хотя бы два символа.';return;}
   if(!isTauri()){get('catalogue-status').textContent='Каталог Яндекса доступен в desktop-версии после подключения аккаунта.';return;}
   const requestedPage=append?page+1:0;
   get('catalogue-status').textContent='Поиск в Яндекс Музыке…';get<HTMLButtonElement>('catalogue-more').disabled=true;
   if(!append){++collectionRevision;opened=undefined;collectionView(false);}
   try{
     const response=await invoke<Results>('catalogue_search',{query:text,page:requestedPage});
     if(revision!==searchRevision)return;
     const count=response.artists.length+response.tracks.length+response.albums.length+response.playlists.length;
     if(append&&query===text){results={...response,artists:[...results.artists,...response.artists],tracks:[...results.tracks,...response.tracks],albums:[...results.albums,...response.albums],playlists:[...results.playlists,...response.playlists]};}else results=response;
     page=requestedPage;query=text;render();hasSearchMore=count>0;get('catalogue-more').hidden=browsingCollection||!hasSearchMore;
     get('catalogue-status').textContent=count?(response.corrected?'Результаты Яндекса для «'+response.corrected+'».':'Результаты Яндекс Музыки.'):append?'Больше результатов нет.':'Ничего не найдено.';
   }catch{if(revision===searchRevision)get('catalogue-status').textContent='Поиск недоступен. Проверьте сеть и подключение аккаунта.';}
   finally{if(revision===searchRevision)get<HTMLButtonElement>('catalogue-more').disabled=false;}
 }
 get<HTMLFormElement>('catalogue-search').onsubmit=event=>{event.preventDefault();void search(false);};
 get('catalogue-more').onclick=()=>void search(true);
 get('catalogue-query').oninput=()=>{
   collectionReturn=undefined;
   ++searchRevision;clearTimeout(timer);get<HTMLButtonElement>('catalogue-more').disabled=true;
   ++collectionRevision;opened=undefined;collectionView(false);
   if(get<HTMLInputElement>('catalogue-query').value.trim().length<2){
     ++collectionRevision;opened=undefined;get('catalogue-collection').hidden=true;get('catalogue-results').replaceChildren();get('catalogue-more').hidden=true;get('catalogue-status').textContent='Введите хотя бы два символа.';return;
   }
   timer=setTimeout(()=>void search(false),400);
 };
 return (entity:CatalogueEntity,back?:()=>void)=>{collectionReturn=back;void open(entity,false);};
}
