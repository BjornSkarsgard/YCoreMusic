import {invoke,isTauri} from '@tauri-apps/api/core';
interface Status {enabled:boolean;canChange:boolean}
export function mountAutostart(){
 const root=document.getElementById('autostart-settings')!;
 root.innerHTML='<h3>Запуск приложения</h3><label class="setting-toggle"><input id="autostart-enabled" type="checkbox" disabled>Запускать YCore Music при входе в систему</label><p class="panel-description">YCore Music откроется в трее. Музыка останется на паузе.</p><p id="autostart-status" role="status"></p><button id="autostart-refresh">Проверить настройку</button>';
 const checkbox=document.getElementById('autostart-enabled') as HTMLInputElement,refresh=document.getElementById('autostart-refresh') as HTMLButtonElement,status=document.getElementById('autostart-status')!;
 let state:Status|undefined,busy=false;
 function paint(){checkbox.checked=state?.enabled??false;checkbox.disabled=busy||!state?.canChange;refresh.disabled=busy;}
 function validate(value:Status){if(!value||typeof value.enabled!=='boolean'||typeof value.canChange!=='boolean')throw Error('Invalid autostart response');return value;}
 function describe(){status.textContent=!state?.canChange?'Изменение автозапуска недоступно в этом запуске.':state.enabled?'Автозапуск включён.':'Автозапуск выключен.';}
 async function read(){
  if(busy)return;
  if(!isTauri()){status.textContent='Настройка доступна в приложении YCore Music.';refresh.disabled=true;return;}
  busy=true;paint();status.textContent='Проверяем автозапуск…';
  try{state=validate(await invoke<Status>('autostart_status'));describe();}
  catch{state=undefined;status.textContent='Не удалось прочитать настройку. Нажмите «Проверить настройку», чтобы повторить.';}
  finally{busy=false;paint();}
 }
 checkbox.onchange=async()=>{
  if(busy||!state?.canChange){paint();return;}
  const desired=checkbox.checked,previous=state;busy=true;checkbox.disabled=true;refresh.disabled=true;status.textContent='Сохраняем настройку…';
  try{state=validate(await invoke<Status>('autostart_set',{enabled:desired}));describe();}
  catch{state=previous;status.textContent='Не удалось подтвердить изменение автозапуска. Проверьте настройку повторно.';}
  finally{busy=false;paint();}
 };
 root.addEventListener('settings-open',()=>void read());refresh.onclick=()=>void read();
}
