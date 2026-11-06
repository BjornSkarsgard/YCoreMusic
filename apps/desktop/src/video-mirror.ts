import {invoke} from '@tauri-apps/api/core';
import {hostAvailable} from './player-host';
/** Native DWM surfaces contain no iframe or network player. */
export async function mountVideoMirror(stage:HTMLElement,overlays:()=>HTMLElement[],shown:()=>boolean=()=>true){
 if(!await hostAvailable())return;
 let busy=false,pending=false,frame=0,failures=0;
 const rect=(element:HTMLElement)=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
 async function update(){
  frame=0;if(busy){pending=true;return;}busy=true;pending=false;
  const bounds=rect(stage),style=getComputedStyle(stage);
  const visible=shown()&&style.display!=='none'&&style.visibility!=='hidden'&&bounds.width>0&&bounds.height>0;
  try{await invoke('player_host_mirror',{surface:{visible,stage:bounds,holes:overlays().filter(element=>!element.hidden&&getComputedStyle(element).display!=='none').map(rect),dimmed:!!document.querySelector('dialog[open]')}});failures=0;delete document.body.dataset.videoMirrorFailure;}
  catch(error){if(++failures>=3){document.body.dataset.videoMirrorFailure=String(error).slice(0,200);document.dispatchEvent(new Event('video-mirror-error'));}}
  finally{busy=false;if(pending)schedule();}
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(()=>void update());}
 const resize=new ResizeObserver(schedule);resize.observe(stage);
 const changes=new MutationObserver(schedule);changes.observe(document.body,{attributes:true,attributeFilter:['class','open','hidden'],subtree:true});
 window.addEventListener('resize',schedule);document.addEventListener('fullscreenchange',schedule);
 const timer=setInterval(schedule,1000);schedule();
 window.addEventListener('beforeunload',()=>{clearInterval(timer);cancelAnimationFrame(frame);resize.disconnect();changes.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('fullscreenchange',schedule);});
}
