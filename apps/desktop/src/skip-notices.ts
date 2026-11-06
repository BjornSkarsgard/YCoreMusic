import {icon} from './icons';
let nextId=0;
/** Inspecting the cause must never activate the row's Play action. */
export function markSkipped(row:HTMLElement,title:string,reason:string){
 row.classList.add('track-skipped');
 const button=document.createElement('button');button.type='button';button.className='skip-reason';
 button.innerHTML=icon('info');button.setAttribute('aria-label','Причина пропуска: '+title);button.title='Причина пропуска';
 const message=document.createElement('div');message.id='skip-reason-'+ ++nextId;message.className='skip-reason-message';message.setAttribute('popover','auto');
 const name=document.createElement('strong'),text=document.createElement('p');name.textContent=title;text.textContent=reason;message.append(name,text);
 button.popoverTargetElement=message;button.setAttribute('aria-controls',message.id);button.addEventListener('click',event=>event.stopPropagation());row.append(button,message);
}
/** Use only the recorded reason, never guess region/age/network restrictions. */
export function historySkipReason(endReason:string|null|undefined):string|undefined{
 if(endReason==='error')return 'Воспроизведение клипа завершилось с ошибкой. Более подробная причина для этой записи не сохранена.';
}
