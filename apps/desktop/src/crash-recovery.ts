import {invoke,isTauri} from '@tauri-apps/api/core';
export interface ResumeSnapshot {trackId:string;title:string;artist:string;videoId:string;position:number}
export function mountCrashRecovery(resume:(snapshot:ResumeSnapshot)=>void){
 const dialog=document.createElement('dialog');dialog.id='crash-recovery';dialog.setAttribute('aria-labelledby','crash-recovery-title');
 dialog.innerHTML='<h2 id="crash-recovery-title">Продолжить после сбоя?</h2><p>Предыдущий запуск завершился неожиданно. Можно продолжить клип с сохранённого места. Музыка включится только после нажатия «Продолжить».</p><p id="crash-recovery-track"></p><div class="scene-actions"><button id="crash-recovery-resume" class="primary">Продолжить</button><button id="crash-recovery-discard">Начать заново</button></div><p id="crash-recovery-status" role="status"></p>';
 document.body.append(dialog);
 const yes=dialog.querySelector<HTMLButtonElement>('#crash-recovery-resume')!,no=dialog.querySelector<HTMLButtonElement>('#crash-recovery-discard')!,status=dialog.querySelector<HTMLElement>('#crash-recovery-status')!;
 let candidate:ResumeSnapshot|undefined,lastSave=0,writer=Promise.resolve(),busy=false,revision=0;
 const request=(value:object)=>invoke<ResumeSnapshot|null>('crash_recovery',{request:value});
 const dismiss=()=>{candidate=undefined;dialog.close();};
 function write(value:object){writer=writer.then(()=>request(value)).then(()=>{}).catch(()=>{document.getElementById('storage-status')!.textContent='Не удалось сохранить точку восстановления после сбоя.';});return writer;}
 async function choose(continuePlayback:boolean){
  if(busy||!candidate)return;busy=true;yes.disabled=no.disabled=true;
  const snapshot=candidate,choiceRevision=revision;
  try{await writer;await request({type:'discard'});if(choiceRevision!==revision)return;dismiss();if(continuePlayback)resume(snapshot);}
  catch{status.textContent='Не удалось закрыть точку восстановления. Повторите попытку.';}
  finally{busy=false;yes.disabled=no.disabled=false;}
 }
 yes.onclick=()=>void choose(true);no.onclick=()=>void choose(false);
 dialog.addEventListener('cancel',event=>{event.preventDefault();void choose(false);});
 function offer(){if(!candidate||dialog.open||document.hidden||document.querySelector('dialog[open]'))return;dialog.showModal();}
 const readRevision=revision;
 if(isTauri())void request({type:'read'}).then(snapshot=>{
  if(!snapshot||revision!==readRevision)return;
  candidate=snapshot;dialog.querySelector('#crash-recovery-track')!.textContent=[snapshot.title,snapshot.artist].filter(Boolean).join(' · ')+' · '+Math.floor(snapshot.position/60)+':'+String(Math.floor(snapshot.position%60)).padStart(2,'0');offer();
 }).catch(()=>{document.getElementById('storage-status')!.textContent='Точка восстановления после сбоя недоступна.';});
 const timer=setInterval(offer,500);
 window.addEventListener('beforeunload',()=>clearInterval(timer));
 return {
  checkpoint(snapshot:ResumeSnapshot){if(!isTauri())return;++revision;dismiss();const now=performance.now();if(lastSave&&now-lastSave<5000)return;lastSave=now;void write({type:'save',snapshot});},
  clear(){if(!isTauri())return;++revision;dismiss();lastSave=0;void write({type:'discard'});},
 };
}
