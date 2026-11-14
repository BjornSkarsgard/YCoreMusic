import {invoke} from '@tauri-apps/api/core';
import type {CatalogueEntity, StartRelatedWave} from './catalogue-ui';
import {setTrackActions} from './playback-rows';

type Track = {id:string; title:string};

export function mountTrackActions(wave:StartRelatedWave,similar:(track:Track)=>void){
 const dialog=document.createElement('dialog');
 dialog.setAttribute('aria-labelledby','track-actions-title');
 dialog.innerHTML=`
  <h2 id="track-actions-title"></h2>
  <div class="source-actions">
   <button type="button" data-wave>Запустить волну по треку</button>
   <button type="button" data-similar>Похожие треки</button>
   <button type="button" data-playlists>Добавить в плейлист</button>
  </div>
  <section data-picker hidden>
   <label class="field-label">Мои плейлисты <select data-list></select></label>
   <button type="button" data-add>Добавить трек</button>
   <form class="source-actions">
    <label>Название нового плейлиста <input required maxlength="100"></label>
    <button>Создать и добавить трек</button>
   </form>
  </section>
  <p role="status"></p>
  <div class="dialog-actions"><button type="button" data-close>Закрыть</button></div>`;
 document.body.append(dialog);
 const get=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
 const list=get<HTMLSelectElement>('[data-list]'),picker=get('[data-picker]'),status=get('[role=status]');
 const form=get<HTMLFormElement>('form'),name=get<HTMLInputElement>('input');
 const add=get<HTMLButtonElement>('[data-add]');
 let track:Track|undefined, busy=false, created:string|undefined;
 function setBusy(value:boolean){
  busy=value;
  for(const control of dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('button,input,select'))control.disabled=value;
  add.disabled=value||!list.value;
 }
 setTrackActions(next=>{
  if(dialog.open||busy)return;
  track=next;created=undefined;list.replaceChildren();form.reset();form.hidden=false;picker.hidden=true;status.textContent='';
  get('h2').textContent=next.title;
  dialog.showModal();
 });
 get('[data-close]').onclick=()=>dialog.close();
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 get('[data-wave]').onclick=()=>{if(track){dialog.close();wave('track:'+track.id,track.title);}};
 get('[data-similar]').onclick=()=>{if(track){dialog.close();similar(track);}};
 get('[data-playlists]').onclick=async()=>{
  if(busy)return;
  status.textContent='Загружаем плейлисты…';setBusy(true);
  try{
   const playlists=await invoke<CatalogueEntity[]>('library_owned_playlists');
   list.replaceChildren(...playlists.map(item=>new Option(item.title,item.id)));
   picker.hidden=false;
   status.textContent=playlists.length?'':'Создай первый плейлист, чтобы добавить трек.';
  }catch{status.textContent='Не удалось загрузить плейлисты. Проверь вход в Яндекс Музыку.';}
  finally{setBusy(false);}
 };
 async function save(title?:string){
  if(!track||busy||(!title&&!list.value&&!created))return;
  setBusy(true);status.textContent='Сохраняем в Яндекс Музыке…';
  try{
   if(title){
    const kind=await invoke<string>('library_edit',{action:{type:'create',title}});
    list.add(new Option(title,kind));list.value=kind;created=kind;form.hidden=true;
    window.dispatchEvent(new Event('library-changed'));
   }
   await invoke('library_edit',{action:{type:'insert',kind:list.value,track:track.id}});
   created=undefined;
   status.textContent='Трек добавлен в «'+list.selectedOptions[0]?.textContent+'».';
   window.dispatchEvent(new Event('library-changed'));
   add.hidden=true;form.hidden=true;
  }catch{
   status.textContent=created?'Плейлист создан. Добавление трека не подтверждено.': 'Не удалось подтвердить сохранение в Яндекс Музыке.';
  }finally{setBusy(false);}
 }
 list.onchange=()=>{add.hidden=false;};
 add.onclick=()=>void save();
 form.onsubmit=event=>{event.preventDefault();if(name.value.trim())void save(name.value.trim());};
 dialog.addEventListener('close',()=>{add.hidden=false;});
}
