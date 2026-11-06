import {setIconLabel} from './icons';
let locked=false;
export const playbackLocked=()=>locked;
export function allowPlaybackChange(){
 if(!locked)return true;
 const notice=document.getElementById('playback-lock-notice');if(notice)notice.textContent='Защита включена. Чтобы сменить трек, клип или позицию, нажмите замок.';
 return false;
}
export function mountPlaybackGuard(onLock:()=>void){
 const button=document.createElement('button');button.id='playback-lock';button.type='button';button.setAttribute('aria-pressed','false');
 const notice=document.createElement('p');notice.id='playback-lock-notice';notice.setAttribute('role','status');document.querySelector('.sound')!.prepend(button);document.getElementById('player-options-status')!.after(notice);
 function paint(){setIconLabel(button,'lock',locked?'Выключить защиту от переключений':'Включить защиту от переключений',true);button.setAttribute('aria-pressed',String(locked));document.body.classList.toggle('playback-locked',locked);}
 button.onclick=()=>{locked=!locked;paint();notice.textContent=locked?'Защита включена · пауза и громкость доступны.':'';if(locked)onLock();document.dispatchEvent(new Event('scene-playback-state'));};paint();
 // Prevent reaction/preference writes before handlers can cause a skip.
 document.addEventListener('click',event=>{if(!locked||!(event.target instanceof Element))return;if(event.target.closest('#dislike,#repeat,#exclude-video,#prefer-video,#favorite-list button,#excluded-video-list button')){event.preventDefault();event.stopImmediatePropagation();allowPlaybackChange();}},true);
}
