import {icon,setIconLabel} from './icons';
let openActions:(track:{id:string;title:string})=>void=()=>{};
export function setTrackActions(open:typeof openActions){openActions=open;}
interface State {trackId:string|null;playing:boolean;queueKey?:string}
let current:State={trackId:null,playing:false},toggle=()=>{};
const bindings=new WeakMap<HTMLElement,{button:HTMLButtonElement;title:string;iconOnly:boolean;key?:string;painted?:string}>();
function paint(row:HTMLElement){
 const binding=bindings.get(row);if(!binding)return;
 const selected=row.dataset.playbackTrack===current.trackId&&(!binding.key||binding.key===current.queueKey);
 const signature=selected+':'+(selected&&current.playing);if(binding.painted===signature)return;binding.painted=signature;
 row.classList.toggle('track-current',selected);row.classList.toggle('track-playing',selected&&current.playing);
 const label=selected&&current.playing?'Приостановить':'Воспроизвести';
 setIconLabel(binding.button,selected&&current.playing?'pause':'play',binding.key||binding.iconOnly?binding.title:label,binding.iconOnly);
 binding.button.setAttribute('aria-label',binding.key||binding.iconOnly?label+' '+binding.title:label);
}
export function setRowPlayback(state:State,onToggle:()=>void){
 toggle=onToggle;if(current.trackId===state.trackId&&current.playing===state.playing&&current.queueKey===state.queueKey)return;
 current=state;document.querySelectorAll<HTMLElement>('[data-playback-track]').forEach(paint);
}
export function bindPlaybackRow(row:HTMLElement,button:HTMLButtonElement,track:{id:string;title:string},start:()=>void,options:{iconOnly?:boolean;queueKey?:string}={}){
 button.classList.add("track-play-action");
 row.dataset.playbackTrack=track.id;bindings.set(row,{button,title:track.title,iconOnly:options.iconOnly??true,key:options.queueKey});
 button.onclick=()=>{const selected=row.dataset.playbackTrack===current.trackId&&(!options.queueKey||options.queueKey===current.queueKey);if(selected)toggle();else start();};
 paint(row);
 if(/^[0-9]{1,64}$/.test(track.id)){
  const more=document.createElement('button');more.type='button';more.className='track-more';
  more.innerHTML=icon('more');more.setAttribute('aria-label','Действия с треком '+track.title);more.title='Действия с треком';
  more.setAttribute('aria-haspopup','dialog');
  more.onclick=()=>openActions(track);
  row.classList.add('has-track-actions');
  // Rows add the playback button synchronously after binding.
  queueMicrotask(()=>row.append(more));
 }
}
