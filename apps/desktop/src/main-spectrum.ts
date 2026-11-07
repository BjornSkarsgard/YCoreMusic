import {invoke,isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {mountSpectrum,type AnalysisFrame,type VisualOptions} from './spectrum';
import type {MainLayout} from './window-layout';

const key='ycore.mainSpectrum.v1';
const allowedFps=new Set([0,30,60,90,120,144,165,180,240]);
const qualities=new Set<VisualOptions['quality']>(['low','medium','high','ultra']);
type Saved=Pick<VisualOptions,'fps'|'quality'|'preset'>;

function restore():Saved {
 try {
  const value=JSON.parse(localStorage.getItem(key)??'{}') as Partial<Saved>;
  return {fps:allowedFps.has(value.fps??0)?value.fps??0:0,quality:qualities.has(value.quality??'high')?value.quality??'high':'high',...(['ambient','liquid','particles'].includes(value.preset??'')?{preset:value.preset}:{})};
 } catch { return {fps:0,quality:'high'}; }
}

/** Own-window Spectrum. Uses the same shared native analysis as external scenes. */
export function mountMainSpectrum(stage:HTMLElement,current:()=>MainLayout,currentArtwork:()=>string|undefined=()=>undefined){
 let widget:ReturnType<typeof mountSpectrum>|undefined;
 const options=restore();
 const panel=document.getElementById('main-spectrum-options')!;
 const fps=document.getElementById('main-spectrum-fps') as HTMLSelectElement;
 const quality=document.getElementById('main-spectrum-quality') as HTMLSelectElement;
 const preset=document.createElement('select');preset.id='main-visualizer-preset';preset.setAttribute('aria-label','Тип визуализатора');preset.replaceChildren(...['Spectrum','Ambient','Liquid','Particles'].map(name=>new Option(name,name.toLowerCase())));preset.value=options.preset??'spectrum';panel.prepend(preset);
 document.querySelector('#window-layout option[value=spectrum]')!.textContent='Визуализатор';
 preset.onchange=()=>{if(preset.value==='spectrum')delete options.preset;else options.preset=preset.value as VisualOptions['preset'];save();configure();};
 const status=document.createElement('p');status.id='main-spectrum-status';status.setAttribute('role','status');stage.append(status);
 quality.value=options.quality;
 let readingMonitor=false,lastMonitorRead=0,monitorHz:number|null=null;
 function fpsOptions(){
  fps.replaceChildren(new Option('Частота экрана','0'));
  for(const value of allowedFps)if(value&&(!monitorHz||value<=monitorHz))fps.append(new Option(value+' кадров/с',String(value)));
  if(options.fps&&![...fps.options].some(option=>option.value===String(options.fps)))fps.append(new Option(options.fps+' кадров/с · сохранено',String(options.fps)));
  fps.value=String(options.fps);
 }
 fpsOptions();
 let disposed=false,watching=false,leased=false,analysisError=false;
 let unlisten:(()=>void)|undefined;
 const active=()=>current()==='spectrum'&&!document.hidden;
 async function readMonitor(){
  if(readingMonitor||disposed||!active()||!isTauri()||Date.now()-lastMonitorRead<3000)return;
  readingMonitor=true;lastMonitorRead=Date.now();
  try{
   const value=await invoke<{refreshHz:number|null}|null>('monitor_current');
   const hz=typeof value?.refreshHz==='number'&&value.refreshHz>0?value.refreshHz:null;
   if(hz!==monitorHz){monitorHz=hz;fpsOptions();}
  }catch{/* Keep the user's existing FPS and quality if the monitor cannot be read. */}
  finally{readingMonitor=false;}
 }
 const statusText=()=>analysisError?'Визуализатор временно недоступен. Воспроизведение продолжается.':(options.preset??'spectrum')+' · реакция на звук YCore Music.';
 function save(){try{localStorage.setItem(key,JSON.stringify(options));}catch{/* Spectrum stays configurable for this session. */}}
 function configure(){
  const enabled=active();
  panel.hidden=!enabled;
  stage.classList.toggle('spectrum-active',enabled);
  if(enabled)widget??=mountSpectrum(stage);
  widget?.artwork(currentArtwork());
  widget?.configure({content:enabled?'visualizer':'video',fps:options.fps,quality:options.quality,preset:options.preset});
  status.textContent=enabled?statusText():'';
  void watch();
  void readMonitor();
 }
 async function watch(){
  if(watching||disposed||!isTauri())return;
  const wanted=active();
  if(!wanted&&!leased)return;
  watching=true;
  try { await invoke('analysis_watch',{active:wanted});leased=wanted; }
  catch { if(active())analysisError=true; }
  finally { watching=false;if(active())status.textContent=statusText();if(wanted!==active())void watch(); }
 }
 fps.onchange=()=>{options.fps=Number(fps.value);save();configure();};
 quality.onchange=()=>{options.quality=quality.value as VisualOptions['quality'];save();configure();};
 document.addEventListener('window-layout-mode',configure);
 document.addEventListener('track-artwork',()=>widget?.artwork(currentArtwork()));
 document.addEventListener('visibilitychange',configure);
 if(isTauri())void listen<AnalysisFrame>('audio-analysis',event=>{
  widget?.receive(event.payload);analysisError=!event.payload.available;
  if(active())status.textContent=statusText();
 },{target:{kind:'WebviewWindow',label:'main'}}).then(stop=>{if(disposed)stop();else unlisten=stop;}).catch(()=>{analysisError=true;if(active())status.textContent='Spectrum временно недоступен. Воспроизведение продолжается.';});
 configure();
 const timer=setInterval(()=>{void watch();void readMonitor();},750);
 window.addEventListener('beforeunload',()=>{disposed=true;clearInterval(timer);unlisten?.();widget?.destroy();});
 return {isActive:active};
}
