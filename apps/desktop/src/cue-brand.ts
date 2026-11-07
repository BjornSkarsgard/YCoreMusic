import './cue-brand.css';
const mark=new URL('./assets/ycore-mark-512.png',import.meta.url).href;
/** Decoration for the cued state; transport stays in our existing controls. */
export function mountCueBrand(stage:HTMLElement){
 const element=document.createElement('div');element.className='cue-brand';element.hidden=true;element.setAttribute('aria-hidden','true');
 const image=document.createElement('img');image.src=mark;image.alt='';element.append(image);stage.append(element);
 return {element,update(hasVideo:boolean,state:number){const hidden=!(hasVideo&&(state===5||state===-1));if(element.hidden!==hidden)element.hidden=hidden;}};
}
