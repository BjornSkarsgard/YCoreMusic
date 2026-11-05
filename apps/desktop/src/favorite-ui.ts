import {setIconLabel,icon} from './icons';
import {isTauri} from '@tauri-apps/api/core';
import {storage} from './storage';
import {savedVideos} from './favorite-store';
interface Context {trackId:string;videoId?:string;key:string}
export function mountVideoFavorites(current:()=>Context|undefined,choose:(videoId:string)=>void,changed:(trackId:string)=>void,title:(videoId:string)=>string|undefined){
 const save=document.getElementById('save-current-video') as HTMLButtonElement,list=document.getElementById('favorite-list')!,status=document.getElementById('favorite-status')!;
 const preferences=document.createElement('section');preferences.id='clip-preferences';preferences.innerHTML=`<h3>Выбор видео для этой песни</h3><div class="clip-preference-actions"><button id="prefer-video" aria-pressed="false" disabled>${icon('pin')}<span>Предпочитать этот клип</span></button><button id="exclude-video" disabled>${icon('close')}<span>Не выбирать это видео</span></button></div><p>Предпочтительный клип выбирается первым. Исключение видео не меняет лайк или дизлайк песни в Яндекс Музыке.</p><details id="excluded-clips" hidden><summary>Исключённые видео</summary><div id="excluded-video-list"></div></details>`;
 document.getElementById('find-video')!.after(preferences);
 const prefer=preferences.querySelector<HTMLButtonElement>('#prefer-video')!,exclude=preferences.querySelector<HTMLButtonElement>('#exclude-video')!,excludedList=preferences.querySelector<HTMLElement>('#excluded-video-list')!,excludedDetails=preferences.querySelector<HTMLDetailsElement>('#excluded-clips')!;
 let epoch=0,selected=false,preferred=false,excluded=false,busy=false,rendered:Context|undefined;
 function disable(){save.disabled=prefer.disabled=exclude.disabled=true;for(const button of list.querySelectorAll<HTMLButtonElement>('button'))button.disabled=true;for(const button of excludedList.querySelectorAll<HTMLButtonElement>('button'))button.disabled=true;}
 async function mutate(context:Context,request:Record<string,unknown>){
  if(busy)return;busy=true;disable();let failed=false;
  try{await storage(request);changed(context.trackId);}
  catch{failed=true;}
  finally{busy=false;await refresh();if(failed&&current()?.key===context.key)status.textContent='Не удалось сохранить выбор видео. Повторите попытку.';}
 }
 async function refresh(){
  const revision=++epoch,context=current();rendered=undefined;disable();save.setAttribute('aria-pressed','false');setIconLabel(save,'star','Клип');list.replaceChildren();excludedList.replaceChildren();excludedDetails.hidden=true;prefer.setAttribute('aria-pressed','false');
  if(!isTauri()||!context||!/^\d+$/.test(context.trackId)){status.textContent='Избранные клипы доступны для песен Яндекс Музыки.';return;}
  try{
   const value=await savedVideos(context.trackId);if(revision!==epoch||current()?.key!==context.key||current()?.videoId!==context.videoId)return;
   rendered=context;selected=value.videos.some(video=>video.videoId===context.videoId);preferred=!!context.videoId&&value.preferredVideoId===context.videoId;excluded=!!context.videoId&&(value.excludedVideoIds?.includes(context.videoId)??false);
   save.disabled=prefer.disabled=exclude.disabled=busy||!context.videoId;save.setAttribute('aria-pressed',String(selected));setIconLabel(save,'star','Клип');save.title=selected?'Убрать этот клип из избранного':'Сохранить этот клип в избранное';prefer.setAttribute('aria-pressed',String(preferred));setIconLabel(prefer,'pin',preferred?'Снять предпочтение':'Предпочитать этот клип');setIconLabel(exclude,'close',excluded?'Вернуть это видео в подбор':'Не выбирать это видео');
   status.textContent=value.preferredVideoId?'Предпочтительный клип выбирается первым; при недоступности пробуем остальные.':value.videos.length?'Избранные клипы меняются случайно, без повтора подряд.':'Сохранённых клипов пока нет.';
   for(const video of value.videos){
    const row=document.createElement('div');row.className='favorite-row';
    const image=document.createElement('img');image.src='https://i.ytimg.com/vi/'+video.videoId+'/mqdefault.jpg';image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';
    const play=document.createElement('button');play.textContent=(title(video.videoId)??'Клип '+video.videoId)+(video.unavailable?' · недоступен, попробовать снова':'');play.onclick=()=>{if(current()?.key===context.key)choose(video.videoId);};
    const remove=document.createElement('button');remove.textContent='Удалить';remove.setAttribute('aria-label','Удалить избранный клип '+video.videoId);remove.onclick=()=>void mutate(context,{type:'remove_favorite',trackId:context.trackId,videoId:video.videoId});
    play.disabled=busy||!!value.excludedVideoIds?.includes(video.videoId);
    if(value.excludedVideoIds?.includes(video.videoId))play.textContent+=' · исключён из подбора';
    if(value.preferredVideoId===video.videoId)play.textContent+=' · предпочтительный';
    remove.disabled=busy;row.append(image,play,remove);list.append(row);
   }
   const excludedIds=value.excludedVideoIds??[];excludedDetails.hidden=!excludedIds.length;
   for(const id of excludedIds){const row=document.createElement('div');row.className='favorite-row excluded-row';const label=document.createElement('span');label.textContent=title(id)??'Видео '+id;const restore=document.createElement('button');restore.textContent='Вернуть в подбор';restore.setAttribute('aria-label','Вернуть в подбор '+id);restore.disabled=busy;restore.onclick=()=>void mutate(context,{type:'exclude_video',trackId:context.trackId,videoId:id,excluded:false});row.append(label,restore);excludedList.append(row);}
  }catch{if(revision===epoch)status.textContent='Не удалось прочитать избранные клипы.';}
 }
 function currentRendered(){const context=current();return context?.videoId&&rendered?.key===context.key&&rendered.videoId===context.videoId?context:undefined;}
 save.onclick=()=>{const context=currentRendered();if(context)void mutate(context,{type:selected?'remove_favorite':'save_video',trackId:context.trackId,videoId:context.videoId});};
 prefer.onclick=()=>{const context=currentRendered();if(context)void mutate(context,{type:'prefer_video',trackId:context.trackId,videoId:preferred?null:context.videoId});};
 exclude.onclick=()=>{const context=currentRendered();if(context)void mutate(context,{type:'exclude_video',trackId:context.trackId,videoId:context.videoId,excluded:!excluded});};
 document.getElementById('video-dialog')!.addEventListener('favorites-open',()=>void refresh());
 return ()=>void refresh();
}
