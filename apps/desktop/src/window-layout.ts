import {showPanel} from './shell';
import {platformCapabilities} from './platform';

const preference='ycore.mainLayout.v1';
export type MainLayout='video'|'controls'|'spectrum';
/** Reuses the mounted controls and lists; never creates a playback session or player. */
export function mountWindowLayout(){
 const layout=document.querySelector<HTMLElement>('.app-layout')!;
 const side=document.querySelector<HTMLElement>('.side-panel')!;
 const top=document.querySelector<HTMLElement>('.panel-top')!;
 const scroll=document.querySelector<HTMLElement>('.panel-scroll')!;
 const queue=document.querySelector<HTMLElement>('[data-pane=queue]')!;
 const alternatives=document.getElementById('video-alternatives')!;
 const screen=document.querySelector<HTMLElement>('.screen')!;
 const select=document.getElementById('window-layout') as HTMLSelectElement;
 const content=document.createElement('section');content.className='controls-content';content.setAttribute('aria-label','Музыкальные списки');content.hidden=true;
 const rail=document.createElement('aside');rail.className='controls-queue';rail.setAttribute('aria-label','Очередь и варианты клипа');rail.hidden=true;
 const heading=document.createElement('h2');heading.textContent='Очередь воспроизведения';
 const queueScroll=document.createElement('div');queueScroll.className='controls-queue-scroll';queueScroll.dataset.queueScroll='';
 rail.append(heading,queueScroll);layout.append(content,rail);
 let current:MainLayout='video';
 function apply(next:MainLayout){
  if(next===current)return;
  if(document.fullscreenElement)return;
  const selected=document.querySelector<HTMLButtonElement>('.navigation [aria-pressed=true]')?.dataset.panel??'wave';
  current=next;const controls=next==='controls';
  document.body.classList.toggle('controls-layout',controls);document.body.classList.remove('panel-collapsed');
  document.body.classList.toggle('spectrum-layout',next==='spectrum');
  screen.setAttribute('aria-hidden',String(controls));
  content.hidden=rail.hidden=!controls;
  if(controls){content.append(top,scroll);queueScroll.append(queue);rail.append(alternatives);}
  else{side.prepend(top,scroll);scroll.append(queue);side.append(alternatives);}
  select.value=next;
  // A pinned queue must not replace the catalogue when changing views.
  showPanel(selected==='queue'?'wave':selected);
  queue.dispatchEvent(new Event('queue-open'));
  try{localStorage.setItem(preference,select.value);}catch{/* The view remains usable without persistence. */}
  document.dispatchEvent(new CustomEvent<MainLayout>('window-layout-mode',{detail:next}));
 }
 select.onchange=()=>apply(select.value as MainLayout);
 document.addEventListener('fullscreenchange',()=>{select.disabled=!!document.fullscreenElement;screen.setAttribute('aria-hidden',String(current==='controls'&&!document.fullscreenElement));});
 document.addEventListener('window-layout-change',()=>screen.setAttribute('aria-hidden',String(current==='controls'&&!document.body.classList.contains('compact'))));
 let saved:string|null=null;try{saved=localStorage.getItem(preference);}catch{/* Default to the video layout. */}
 if(saved==='controls'||saved==='spectrum')apply(saved);
 void platformCapabilities().then(capabilities=>{
  if(!capabilities||capabilities.audioAnalysis)return;
  const option=select.querySelector<HTMLOptionElement>('option[value=spectrum]')!;
  option.disabled=true;option.textContent='Визуализатор · пока недоступен';
  if(current==='spectrum'){
   apply('video');
   // Keep the preferred layout for a later build with an audio adapter.
   try{localStorage.setItem(preference,'spectrum');}catch{/* Session view remains usable. */}
  }
 });
 return {layout:()=>current};
}
