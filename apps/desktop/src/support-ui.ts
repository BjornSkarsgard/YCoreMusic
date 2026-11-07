import {invoke,isTauri} from '@tauri-apps/api/core';

const links={donate:'https://www.donationalerts.com/r/affor_1337',review:'https://ycore-music.ru/#reviews'};
const reminderKey='ycore.supportReminder.v1';
const week=7*24*60*60*1000;

async function openLink(destination:keyof typeof links,button:HTMLButtonElement,status:HTMLElement){
 status.textContent='';
 if(!isTauri()){
  window.open(links[destination],'_blank','noopener,noreferrer');
  return true;
 }
 button.disabled=true;
 try{
  await invoke('support_open',{destination});
  return true;
 }catch{
  status.textContent='Не удалось открыть браузер. Адрес страницы: '+links[destination];
  return false;
 }finally{
  button.disabled=false;
 }
}

export function mountSupport(isBusy:()=>boolean){
 const support=document.querySelector<HTMLButtonElement>('#support-developer')!;
 const status=document.getElementById('support-status')!;
 support.onclick=()=>void openLink('donate',support,status);
 if(!isTauri())return;

 let nextAt=Date.now()+week;
 let disabled=false;
 function save(){
  try{localStorage.setItem(reminderKey,JSON.stringify({nextAt,disabled}));}catch{/* Use this launch's schedule if storage is unavailable. */}
 }
 try{
  const stored=JSON.parse(localStorage.getItem(reminderKey)??'null');
  if(typeof stored?.nextAt==='number'&&Number.isFinite(stored.nextAt))nextAt=stored.nextAt;
  disabled=stored?.disabled===true;
 }catch{/* Start with the default schedule. */}
 save();
 if(disabled)return;

 const dialog=document.createElement('dialog');
 dialog.id='support-reminder';
 dialog.setAttribute('aria-labelledby','support-reminder-title');
 dialog.innerHTML=`
  <h2 id="support-reminder-title">Нравится YCore Music?</h2>
  <p>Оставьте отзыв или поддержите разработчика.</p>
  <p id="support-reminder-status" role="status" hidden></p>
  <div class="dialog-actions">
   <button type="button" id="support-reminder-review">Оставить отзыв</button>
   <button type="button" id="support-reminder-donate">Поддержать</button>
   <button type="button" id="support-reminder-later">Позже</button>
   <button type="button" id="support-reminder-disable">Больше не показывать</button>
  </div>`;
 document.body.append(dialog);
 const notice=dialog.querySelector<HTMLElement>('#support-reminder-status')!;
 const review=dialog.querySelector<HTMLButtonElement>('#support-reminder-review')!;
 const donate=dialog.querySelector<HTMLButtonElement>('#support-reminder-donate')!;
 async function follow(destination:keyof typeof links,button:HTMLButtonElement){
  const opened=await openLink(destination,button,notice);
  notice.hidden=opened;
  if(opened)dialog.close();
 }
 review.onclick=()=>void follow('review',review);
 donate.onclick=()=>void follow('donate',donate);
 dialog.querySelector<HTMLButtonElement>('#support-reminder-later')!.onclick=()=>dialog.close();
 dialog.querySelector<HTMLButtonElement>('#support-reminder-disable')!.onclick=()=>{
  disabled=true;save();dialog.close();
 };

 function consider(){
  if(disabled||Date.now()<nextAt||isBusy()||document.hidden||!document.hasFocus())return;
  if(document.fullscreenElement||document.querySelector('dialog[open]'))return;
  if(document.activeElement?.matches('input,textarea,select,[contenteditable]'))return;
  dialog.showModal();
  nextAt=Date.now()+week;
  save();
 }
 const timer=setInterval(consider,60_000);
 const startup=setTimeout(consider,2000);
 window.addEventListener('focus',consider);
 window.addEventListener('beforeunload',()=>{
  clearInterval(timer);
  clearTimeout(startup);
  window.removeEventListener('focus',consider);
 },{once:true});
}
