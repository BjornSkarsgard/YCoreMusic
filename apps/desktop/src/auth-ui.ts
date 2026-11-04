import {invoke,isTauri} from '@tauri-apps/api/core';

type Status='idle'|'waiting'|'checking'|'connected'|'cancelled'|'expired'|'denied'|'network_error'|'service_error'|'store_error'|'test_mode';
const messages:Record<Status,string>={idle:'',waiting:'Заверши вход в отдельном окне Яндекса.',checking:'Проверяем доступ к Яндекс Музыке…',connected:'Яндекс Музыка подключена. Обновляем Encore…',cancelled:'Вход отменён. Прежнее подключение сохранено.',expired:'Время входа истекло. Попробуй ещё раз.',denied:'Доступ не подтверждён. Прежнее подключение сохранено.',network_error:'Не удалось проверить доступ: нет связи с Яндексом. Попробуй ещё раз.',service_error:'Не удалось завершить вход. Попробуй ещё раз.',store_error:'Не удалось сохранить доступ в системном хранилище. Прежнее подключение сохранено.',test_mode:'Изменение подключения отключено в тестовом запуске.'};
export function mountAuth(onChanged:()=>void){
 const root=document.getElementById('account-settings')!;
 root.innerHTML='<h3>Яндекс Музыка</h3><p>Вход откроется в отдельном окне Яндекса. После подключения Encore обновится, музыка останется на паузе. История и избранные клипы сохранятся.</p><div class="account-actions"><button id="account-connect">Войти в Яндекс</button><button id="account-disconnect">Отключить аккаунт</button><button id="account-cancel" hidden>Отменить вход</button></div><p id="account-status" role="status" aria-live="polite"></p><dialog id="account-disconnect-dialog"><form method="dialog"><h3>Отключить Яндекс Музыку?</h3><p>Музыка остановится. Доступ будет удалён с этого устройства. История и избранные клипы сохранятся.</p><button value="cancel">Оставить подключение</button><button id="account-disconnect-confirm" type="button">Отключить</button></form></dialog>';
 const connect=root.querySelector<HTMLButtonElement>('#account-connect')!,disconnect=root.querySelector<HTMLButtonElement>('#account-disconnect')!,cancel=root.querySelector<HTMLButtonElement>('#account-cancel')!,status=root.querySelector<HTMLElement>('#account-status')!,dialog=root.querySelector<HTMLDialogElement>('dialog')!,confirm=root.querySelector<HTMLButtonElement>('#account-disconnect-confirm')!;
 let busy=false,timer:ReturnType<typeof setTimeout>|undefined,revision=0;
 const render=(value:Status)=>{
  if(!(value in messages))throw Error('Invalid connection status');
  busy=value==='waiting'||value==='checking';connect.disabled=busy;disconnect.disabled=busy;cancel.hidden=!busy;status.textContent=messages[value];
 };
 async function poll(epoch:number){
  try{
   const value=await invoke<Status>('auth_command',{action:'status'});if(epoch!==revision)return;
   render(value);
   if(value==='connected'){onChanged();return;}
   if(busy)timer=setTimeout(()=>void poll(epoch),750);
  }catch{if(epoch===revision){render('service_error');}}
 }
 connect.onclick=async()=>{
  if(busy)return;const epoch=++revision;clearTimeout(timer);render('waiting');
  try{const value=await invoke<Status>('auth_command',{action:'begin'});if(epoch!==revision)return;render(value);if(value==='connected')onChanged();else if(busy)timer=setTimeout(()=>void poll(epoch),500);}
  catch{if(epoch===revision)render('service_error');}
 };
 cancel.onclick=async()=>{
  const epoch=++revision;clearTimeout(timer);cancel.disabled=true;
  try{const value=await invoke<Status>('auth_command',{action:'cancel'});if(epoch!==revision)return;render(value);if(value==='connected')onChanged();}
  catch{if(epoch===revision)render('service_error');}finally{cancel.disabled=false;}
 };
 disconnect.onclick=()=>dialog.showModal();
 confirm.onclick=async()=>{
  if(busy)return;busy=true;confirm.disabled=true;connect.disabled=true;disconnect.disabled=true;status.textContent='Отключаем аккаунт…';
  try{const value=await invoke<Status>('auth_command',{action:'disconnect'});if(value==='idle'){dialog.close();onChanged();}else render(value);}
  catch{status.textContent='Не удалось отключить аккаунт. Подключение сохранено.';}
  finally{busy=false;confirm.disabled=false;connect.disabled=false;disconnect.disabled=false;}
 };
 if(!isTauri()){connect.disabled=true;disconnect.disabled=true;status.textContent='Вход доступен в приложении Encore.';}
 window.addEventListener('pagehide',()=>{++revision;clearTimeout(timer);});
}
