import {isTauri} from '@tauri-apps/api/core';
import {storage} from './storage';
import {savedVideos} from './favorite-store';
interface Context {trackId:string;videoId?:string;key:string}
export function mountVideoFavorites(current:()=>Context|undefined,choose:(videoId:string)=>void,changed:(trackId:string)=>void,title:(videoId:string)=>string|undefined){
 const save=document.getElementById('save-current-video') as HTMLButtonElement,list=document.getElementById('favorite-list')!,status=document.getElementById('favorite-status')!;
 let epoch=0,selected=false;
 async function refresh(){
  const revision=++epoch,context=current();save.disabled=true;save.setAttribute('aria-pressed','false');save.textContent='☆ Клип';list.replaceChildren();
  if(!isTauri()||!context||!/^\d+$/.test(context.trackId)){status.textContent='Избранные клипы доступны для песен Яндекс Музыки.';return;}
  try{
   const value=await savedVideos(context.trackId);if(revision!==epoch||current()?.key!==context.key)return;
   selected=value.videos.some(video=>video.videoId===context.videoId);save.disabled=!context.videoId;save.setAttribute('aria-pressed',String(selected));save.textContent=selected?'★ Клип':'☆ Клип';save.title=selected?'Убрать этот клип из избранного':'Сохранить этот клип в избранное';
   status.textContent=value.videos.length?'Избранные клипы меняются случайно, без повтора подряд.':'Сохранённых клипов пока нет.';
   for(const video of value.videos){
    const row=document.createElement('div');row.className='favorite-row';
    const image=document.createElement('img');image.src='https://i.ytimg.com/vi/'+video.videoId+'/mqdefault.jpg';image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';
    const play=document.createElement('button');play.textContent=(title(video.videoId)??'Клип '+video.videoId)+(video.unavailable?' · недоступен, попробовать снова':'');play.onclick=()=>{if(current()?.key===context.key)choose(video.videoId);};
    const remove=document.createElement('button');remove.textContent='Удалить';remove.setAttribute('aria-label','Удалить избранный клип '+video.videoId);remove.onclick=()=>{
     remove.disabled=true;void storage({type:'remove_favorite',trackId:context.trackId,videoId:video.videoId}).then(()=>{changed(context.trackId);void refresh();}).catch(()=>{remove.disabled=false;status.textContent='Не удалось удалить сохранённый клип.';});
    };row.append(image,play,remove);list.append(row);
   }
  }catch{if(revision===epoch)status.textContent='Не удалось прочитать избранные клипы.';}
 }
 save.onclick=()=>{
  const context=current();if(!context?.videoId)return;save.disabled=true;
  void storage({type:selected?'remove_favorite':'save_video',trackId:context.trackId,videoId:context.videoId}).then(()=>{changed(context.trackId);void refresh();}).catch(()=>{status.textContent='Не удалось сохранить выбор.';save.disabled=false;});
 };
 document.getElementById('video-dialog')!.addEventListener('favorites-open',()=>void refresh());
 return ()=>void refresh();
}
