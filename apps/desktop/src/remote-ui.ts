import {invoke,isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type {CatalogueEntity} from './catalogue-ui';
import type {Track} from './queue';

export type RemoteControl =
 | {type:'play'|'pause'|'next'|'previous'|'mute'|'repeat'}
 | {type:'seek';seconds:number}
 | {type:'volume';level:number}
 | {type:'queue';generation:number;ordinal:number}
 | {type:'clip';generation:number;ordinal:number;id:string}
 | {type:'wave';station:string}
 | {type:'more'}
 | {type:'undo_dislike';key:string}
 | {type:'reaction';generation:number;ordinal:number;target:'like'|'dislike'|'clip';active:boolean;video_id?:string}
 | {type:'track';track:Track}
 | {type:'list';tracks:Track[];title:string;entity:CatalogueEntity|null;page:number;has_more:boolean}
 | {type:'catalogue';id:string;title:string;artist:string}
 | {type:'history';id:string;title:string;artist:string;video_id:string};

interface Playback {
 title:string;artist:string;playing:boolean;position:number;duration:number;volume:number;
 queue_generation:number;
 queue:{ordinal:number;title:string;artist:string;current:boolean}[];
 repeat:'off'|'one'|'queue';
 clips:{id:string;title:string;current:boolean;views?:number|null;durationSeconds?:number|null;needsReview?:boolean}[];
 music:{
  stations:{id:string;title:string}[];station:string;source:string;wave_status:string;wave_busy:boolean;more:boolean;muted:boolean;
  track_like:boolean|null;track_dislike:boolean|null;clip_like:boolean|null;video_id:string|null;undo_key:string|null;
 };
}

interface RemoteView {
 origin:string|null;
 qr_active:boolean;
 devices:{id:string;name:string}[];
 qr_svg:string|null;
 pair_url:string|null;
}

export async function mountRemote(snapshot:()=>Playback,control:(action:RemoteControl)=>void){
 if(!isTauri())return;
 const request=(action:Record<string,unknown>)=>invoke<RemoteView>('remote_command',{action});
 const initial=await request({type:'read'}).catch(()=>null);
 if(!initial)return;
 const stopListening=await listen<RemoteControl>('remote-control',event=>control(event.payload)).catch(()=>null);
 if(!stopListening)return;

 const root=document.createElement('section');
 root.id='remote-settings';
 root.innerHTML=`
  <h3>Пульт</h3>
  <p>Пульт работает через интернет. Отсканируйте QR-код камерой телефона.</p>
  <div class="remote-actions"><button id="remote-pair" type="button">Подключить телефон</button><button id="remote-stop" type="button" hidden>Выключить пульт</button></div>
  <div id="remote-qr" hidden></div>
  <div id="remote-devices"></div>
  <p id="remote-status" role="status"></p>`;
 document.getElementById('updates-settings')?.after(root);
 const get=<T extends HTMLElement=HTMLElement>(id:string)=>root.querySelector<T>('#'+id)!;
 const pair=get<HTMLButtonElement>('remote-pair');
 const stop=get<HTMLButtonElement>('remote-stop');
 const status=get('remote-status');
 const qr=get('remote-qr');
 let view=initial, busy=false, reading=false, actionRevision=0, rendered='', qrTimer:ReturnType<typeof setTimeout>|undefined;
 const enabledKey='ycore.remote.enabled';
 let enabled=false,nextRestore=0;
 try{enabled=localStorage.getItem(enabledKey)==='1';}catch{/* The pult works for this session. */}
 function remember(value:boolean){
  enabled=value;
  try{if(value)localStorage.setItem(enabledKey,'1');else localStorage.removeItem(enabledKey);}catch{/* The pult works for this session. */}
 }

 function clearQr(){
  clearTimeout(qrTimer);
  qr.replaceChildren();qr.hidden=true;
  delete qr.dataset.pairUrl;
 }
 function button(label:string,action:Record<string,unknown>){
  const result=document.createElement('button');
  result.type='button';result.textContent=label;
  result.onclick=()=>void run(action);
  return result;
 }
 function paint(){
  stop.hidden=!view.origin;
  pair.textContent=view.origin?'Новый QR-код':'Подключить телефон';
  if(!view.qr_active)clearQr();
  if(view.qr_svg&&view.pair_url){
   clearQr();
   const svg=new DOMParser().parseFromString(view.qr_svg,'image/svg+xml').documentElement;
   svg.setAttribute('role','img');
   svg.setAttribute('aria-label','QR-код для подключения телефона');
   qr.dataset.pairUrl=view.pair_url;
   qr.append(svg);qr.hidden=false;
   qrTimer=setTimeout(clearQr,120000);
  }
  const key=JSON.stringify(view.devices);
  if(key===rendered)return;
  rendered=key;
  const devices=get('remote-devices');devices.replaceChildren();
  for(const device of view.devices){
   const row=document.createElement('div');row.className='remote-actions';
   const name=document.createElement('span');name.textContent=device.name;
   row.append(name,button('Отозвать доступ',{type:'revoke',id:device.id}));devices.append(row);
  }
 }
 async function run(action:Record<string,unknown>,restoring=false){
  if(busy)return;
  if(action.type==='stop')remember(false);
  busy=true;++actionRevision;pair.disabled=stop.disabled=true;status.textContent='';
  try{
   view=await request(action);
   if(action.type==='start')remember(true);
   if(restoring)view={...view,qr_svg:null,pair_url:null};
   paint();
  }
  catch(error){
   status.textContent=String(error)==='relay_unavailable'?'Сервис пульта недоступен. Проверьте интернет и повторите.':'Не удалось выполнить действие. Повторите попытку.';
  }finally{busy=false;pair.disabled=stop.disabled=false;nextRestore=Date.now()+15000;}
 }
 pair.onclick=()=>void run({type:view.origin?'pair':'start'});
 stop.onclick=()=>void run({type:'stop'});
 const timer=setInterval(async()=>{
  if(busy||reading)return;
  if(!view.origin){
   if(enabled&&Date.now()>=nextRestore)void run({type:'start'},true);
   return;
  }
  reading=true;
  const revision=actionRevision;
  try{
   const next=await request({type:'read'});
   if(revision!==actionRevision)return;
   view=next;paint();
   if(view.origin)await invoke('remote_publish',{playback:snapshot()});
  }catch{/* The next tick refreshes connection state. */}
  finally{reading=false;}
 },1000);
 paint();
 if(view.origin)remember(true);
 else if(enabled)void run({type:'start'},true);
 window.addEventListener('beforeunload',()=>{clearInterval(timer);clearTimeout(qrTimer);stopListening();},{once:true});
}
