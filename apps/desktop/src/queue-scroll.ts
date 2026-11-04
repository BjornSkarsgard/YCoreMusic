interface QueueScrollOptions {eligible:()=>boolean;generation:()=>number;count:()=>number;ahead:()=>number;load:()=>Promise<boolean>}
/** Extends the existing queue; it never chooses a track or changes playback intent. */
export function mountQueueScroll(options:QueueScrollOptions){
 const root=document.querySelector<HTMLElement>('[data-pane=queue]')!;
 const pane=()=>root.closest<HTMLElement>('[data-queue-scroll],.panel-scroll')!;
 const status=document.getElementById('queue-load-status')!,retry=document.getElementById('queue-load-more') as HTMLButtonElement;
 let busy=false,failed=false,epoch=options.generation(),count=options.count(),frame=0;
 function nearBottom(){const view=pane();return view.scrollHeight-view.scrollTop-view.clientHeight<120;}
 async function load(){
  if(busy||!options.eligible()||options.ahead()>=500)return;
  busy=true;failed=false;const requested=options.generation();status.textContent='Подгружаем следующие треки волны…';retry.hidden=true;
  try{const loaded=await options.load();if(requested!==options.generation())return;failed=!loaded;}
  catch{if(requested===options.generation())failed=true;}
  finally{busy=false;updated();}
 }
 function check(){frame=0;if(!root.hidden&&!busy&&!failed&&options.eligible()&&nearBottom())void load();}
 function updated(){
  const nextEpoch=options.generation(),nextCount=options.count();
  if(nextEpoch!==epoch||nextCount>count)failed=false;epoch=nextEpoch;count=nextCount;
  retry.hidden=!failed;retry.disabled=busy;
  if(!options.eligible()){status.textContent='';retry.hidden=true;return;}
  if(!busy)status.textContent=failed?'Не удалось подгрузить треки. Повторите попытку.':options.ahead()>=500?'Подготовлено около 500 следующих треков. Новые будут добавляться по мере воспроизведения.':'';
  if(!frame)frame=requestAnimationFrame(check);
 }
 const scrolled=(event:Event)=>{if(event.target===pane())updated();};
 retry.onclick=()=>void load();document.addEventListener('scroll',scrolled,{passive:true,capture:true});root.addEventListener('queue-open',updated);
 window.addEventListener('beforeunload',()=>{cancelAnimationFrame(frame);document.removeEventListener('scroll',scrolled,true);});
 return updated;
}
