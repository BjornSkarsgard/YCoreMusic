import {invoke,isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {icon} from './icons';
interface Status {remainingSeconds:number;active:boolean;expired:boolean;revision:number}
export function mountSleepTimer(pause:()=>void){
 const open=document.createElement('button');open.id='sleep-timer-open';open.type='button';open.innerHTML=icon('history')+'<span>Таймер сна</span>';open.setAttribute('aria-haspopup','dialog');
 document.querySelector('.player-options')!.append(open);
 const settings=document.createElement('section');settings.id='sleep-timer-settings';settings.innerHTML='<h3>Таймер сна</h3><p>Поставит музыку на паузу через выбранное время, в том числе при работе в трее. Действует до выхода из приложения.</p><button type="button">Настроить таймер</button>';document.getElementById('autostart-settings')!.after(settings);
 const dialog=document.createElement('dialog');dialog.id='sleep-timer-dialog';dialog.setAttribute('aria-labelledby','sleep-timer-title');dialog.innerHTML='<h2 id="sleep-timer-title">Таймер сна</h2><p>По окончании музыка остановится на паузе. Компьютер и приложение останутся включены.</p><label for="sleep-timer-minutes">Через сколько минут</label><input id="sleep-timer-minutes" type="number" min="1" max="720" step="1" value="30"><div class="sleep-timer-presets"></div><p id="sleep-timer-remaining" aria-live="off"></p><div class="scene-actions"><button id="sleep-timer-start" class="primary">Запустить</button><button id="sleep-timer-cancel">Отменить таймер</button><button id="sleep-timer-close">Закрыть</button></div><p id="sleep-timer-status" role="status"></p>';document.body.append(dialog);
 const minutes=dialog.querySelector<HTMLInputElement>('input')!,start=dialog.querySelector<HTMLButtonElement>('#sleep-timer-start')!,cancel=dialog.querySelector<HTMLButtonElement>('#sleep-timer-cancel')!,remaining=dialog.querySelector<HTMLElement>('#sleep-timer-remaining')!,status=dialog.querySelector<HTMLElement>('#sleep-timer-status')!;
 for(const value of [15,30,45,60,90,120]){const button=document.createElement('button');button.type='button';button.textContent=value+' мин';button.onclick=()=>{minutes.value=String(value);};dialog.querySelector('.sleep-timer-presets')!.append(button);}
 let busy=false,state:Status|undefined,handled=-1,disposed=false;
 const request=(request:object)=>invoke<Status>('sleep_timer',{request});
 function paint(value:Status){if(!value||typeof value.revision!=='number')return;if(state&&(value.revision<state.revision||(value.revision===state.revision&&state.expired&&!value.expired)))return;state=value;const seconds=value.remainingSeconds,time=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');open.querySelector('span')!.textContent=value.active?'Сон через '+time:'Таймер сна';remaining.textContent=value.active?'Осталось '+time:value.expired?'Таймер завершён. Музыка на паузе.':'Таймер выключен.';cancel.disabled=busy||!value.active;if(value.expired&&handled!==value.revision){handled=value.revision;pause();status.textContent='Таймер завершён. Для продолжения нажмите Play.';}}
 async function read(){if(disposed||busy||!isTauri())return;try{paint(await request({type:'read'}));}catch{if(dialog.open)status.textContent='Не удалось прочитать таймер. Повторите попытку.';}}
 async function change(type:'start'|'cancel'){
  if(busy)return;const value=Number(minutes.value);if(type==='start'&&(!Number.isInteger(value)||value<1||value>720)){status.textContent='Укажите от 1 до 720 минут.';return;}
  busy=true;start.disabled=cancel.disabled=true;
  try{const result=await request(type==='start'?{type,seconds:value*60}:{type});paint(result);status.textContent=type==='start'?'Таймер запущен. По окончании — пауза.':'Таймер отменён.';}
  catch{status.textContent='Не удалось изменить таймер. Повторите попытку.';}
  finally{busy=false;start.disabled=false;cancel.disabled=!state?.active;}
 }
 const show=()=>{status.textContent='';if(!dialog.open)dialog.showModal();void read();};open.onclick=show;settings.querySelector('button')!.onclick=show;start.onclick=()=>void change('start');cancel.onclick=()=>void change('cancel');dialog.querySelector<HTMLButtonElement>('#sleep-timer-close')!.onclick=()=>dialog.close();
 if(isTauri())void listen<Status>('sleep-timer-expired',()=>void read(),{target:{kind:'WebviewWindow',label:'main'}}).catch(()=>{});
 const timer=setInterval(()=>void read(),1000);void read();window.addEventListener('beforeunload',()=>{disposed=true;clearInterval(timer);});
}
