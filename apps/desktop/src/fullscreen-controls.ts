/** Presentation only: the existing player and controls stay mounted. */
export function mountFullscreenControls(workspace:HTMLElement,hud:HTMLElement){
 let timer:ReturnType<typeof setTimeout>|undefined;
 let dragging=false;
 const active=()=>document.fullscreenElement===workspace;
 function hide(){
   clearTimeout(timer);
   if(!active())return;
   if(dragging||hud.matches(':hover')||hud.querySelector(':focus-visible')){
     timer=setTimeout(hide,3000);return;
   }
   workspace.classList.remove('hud-visible');
 }
 function reveal(){
   if(!active())return;
   workspace.classList.add('hud-visible');clearTimeout(timer);timer=setTimeout(hide,3000);
 }
 workspace.addEventListener('pointermove',reveal);
 workspace.addEventListener('pointerdown',()=>{dragging=true;reveal();});
 window.addEventListener('pointerup',()=>{dragging=false;reveal();});
 window.addEventListener('pointercancel',()=>{dragging=false;reveal();});
 hud.addEventListener('focusin',reveal);
 hud.addEventListener('focusout',()=>{if(active()){clearTimeout(timer);timer=setTimeout(hide,3000);}});
 workspace.addEventListener('keydown',reveal);
 document.addEventListener('fullscreenchange',()=>{
   clearTimeout(timer);dragging=false;
   if(!active())workspace.classList.remove('hud-visible');
   else if(workspace.classList.contains('hud-visible'))reveal();
 });
}
