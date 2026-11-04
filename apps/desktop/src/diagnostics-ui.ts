import {invoke,isTauri} from '@tauri-apps/api/core';
interface Snapshot{version:string;platform:string;architecture:string;storageAvailable:boolean;yandex:string}
const messages:Record<string,string>={saved:'Подключение сохранено. Доступ ещё не проверен.',connected:'Подключение работает.',missing:'Яндекс Музыка не подключена.',store_unavailable:'Системное хранилище доступа недоступно.',authorization_denied:'Яндекс отклонил доступ. Нужно обновить подключение.',network_unavailable:'Нет связи с Яндексом. Проверьте сеть и повторите.',rate_limited:'Яндекс просит подождать. Повторите проверку позже.',service_unavailable:'Яндекс временно недоступен. Повторите проверку позже.'};
export function mountDiagnostics(){
 const root=document.getElementById('diagnostics')!;
 root.innerHTML='<h3>Состояние Encore</h3><dl><dt>Приложение</dt><dd id="diagnostics-version">Проверяем…</dd><dt>История и избранное</dt><dd id="diagnostics-storage">Проверяем…</dd><dt>Яндекс Музыка</dt><dd id="diagnostics-yandex">Проверяем…</dd></dl><button id="diagnostics-check">Проверить подключение</button><p id="diagnostics-status" role="status"></p>';
 const version=document.getElementById('diagnostics-version')!,storage=document.getElementById('diagnostics-storage')!,yandex=document.getElementById('diagnostics-yandex')!,status=document.getElementById('diagnostics-status')!,button=document.getElementById('diagnostics-check') as HTMLButtonElement;
 let busy=false,loaded=false;
 async function read(checkYandex:boolean){
  if(busy)return;
  if(!isTauri()){version.textContent='Предпросмотр интерфейса';storage.textContent='Проверяется в приложении';yandex.textContent='Проверяется в приложении';button.disabled=true;return;}
  busy=true;button.disabled=true;status.textContent=checkYandex?'Проверяем доступ к Яндекс Музыке…':'Проверяем состояние Encore…';
  try{
   const value=await invoke<Snapshot>('diagnostics_status',{checkYandex});
   if(!value||typeof value.storageAvailable!=='boolean'||!messages[value.yandex])throw Error('Invalid diagnostics');
   const platforms:Record<string,string>={windows:'Windows',macos:'macOS',linux:'Linux'};
   version.textContent='Encore '+value.version+' · '+(platforms[value.platform]??value.platform)+' '+value.architecture;
   storage.textContent=value.storageAvailable?'Хранилище открыто.':'Хранилище недоступно. Существующие данные сохранены.';
   yandex.textContent=messages[value.yandex];status.textContent=checkYandex?'Проверено в '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';loaded=true;
  }catch{status.textContent='Не удалось проверить состояние. Повторите попытку.';}
  finally{busy=false;button.disabled=false;}
 }
 root.addEventListener('settings-open',()=>{if(!loaded)void read(false);});button.onclick=()=>void read(true);
}
