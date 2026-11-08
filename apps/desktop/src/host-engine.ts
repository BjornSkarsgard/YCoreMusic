import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type {HostCache,HostCommand,HostLoad,HostPacket} from './host-protocol';
import {mountCueBrand} from './cue-brand';
import type {FrameRequest} from './macos-player-frame';

// Composite the transparent mark with the sole source image, before native
// mirroring. A rectangular cutout in the destination exposed its black stage.
const embedded=window.parent!==window&&location.hostname==='127.0.0.1';
const cueBrand=embedded?undefined:mountCueBrand(document.body);
let hasVideo=false,showBrand=true;

type Engine=YT.Player&{getOptions?(module:string):string[];getOption?(module:string,option:string):unknown;loadModule?(module:string):void;unloadModule?(module:string):void;setOption?(module:string,option:string,value:unknown):void};
let player:Engine|undefined,epoch=0,sequence=0,ready=false,apiPromise:Promise<void>|undefined;
let publish=(packet:HostPacket)=>{void invoke('player_host_event',{packet}).catch(()=>{});};
function api(){if(window.YT?.Player)return Promise.resolve();if(apiPromise)return apiPromise;apiPromise=new Promise<void>((resolve,reject)=>{
 const script=document.createElement('script'),timer=setTimeout(fail,15000);function fail(){clearTimeout(timer);script.remove();apiPromise=undefined;reject(Error('YouTube API unavailable'));}
 script.src='https://www.youtube.com/iframe_api';script.onerror=fail;window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);resolve();};document.head.append(script);
});return apiPromise;}
function cache():HostCache{
 let captionOptions:string[]=[],captionTracks:HostCache['captionTracks']=[];
 try{
  captionOptions=player?.getOptions?.('captions')??[];
  const tracks=player?.getOption?.('captions','tracklist');
  if(Array.isArray(tracks))captionTracks=tracks.slice(0,64).flatMap(track=>typeof track.languageCode==='string'?[{languageCode:track.languageCode.slice(0,64),kind:String(track.kind??'').slice(0,64),name:String(track.name??'').slice(0,256),displayName:String(track.displayName??track.languageName??track.languageCode).slice(0,256)}]:[]);
 }catch{/* Caption options are absent until YouTube loads the module. */}
 return {position:player?.getCurrentTime?.()??0,duration:player?.getDuration?.()??0,playback:player?.getPlayerState?.()??-1,quality:player?.getPlaybackQuality?.()??'default',captionOptions:captionOptions.slice(0,16),captionTracks,iframeCount:document.querySelectorAll('iframe').length};
}
function report(kind:HostPacket['kind'],errorCode?:number,overrides:Partial<HostCache>={}){const packet:HostPacket={epoch,sequence:++sequence,kind,cache:{...cache(),...overrides},...(errorCode===undefined?{}:{errorCode})};cueBrand?.update(hasVideo&&showBrand,packet.cache.playback);publish(packet);}
async function load(options:HostLoad){
 if(options.epoch<=epoch)return;
 epoch=options.epoch;sequence=0;ready=false;hasVideo=false;showBrand=!options.controls;cueBrand?.update(false,-1);player?.destroy();player=undefined;
 const current=epoch;
 try{
  await api();if(epoch!==current)return;
  if(!document.getElementById('engine-player')){const mount=document.createElement('div');mount.id='engine-player';document.body.append(mount);}
  player=new YT.Player('engine-player',{width:'100%',height:'100%',playerVars:{autoplay:0,playsinline:1,controls:options.controls?1:0,disablekb:1,fs:0,rel:0,iv_load_policy:3,cc_load_policy:1,origin:location.origin},events:{
   onReady:()=>{if(epoch===current){ready=true;report('ready');}},
   onStateChange:event=>{if(epoch===current)report('state',undefined,{playback:event.data});},
   onError:event=>{if(epoch===current)report('error',event.data);},
   onApiChange:()=>{if(epoch===current)report('api');},
   onPlaybackQualityChange:event=>{if(epoch===current)report('quality',undefined,{quality:event.data});},
   onAutoplayBlocked:()=>{if(epoch===current)report('blocked');},
  }});
 }catch{if(epoch===current)report('error',5);}
}
function command(value:{epoch:number;command:HostCommand}){
 if(value.epoch!==epoch)return;const action=value.command;
 if(action.type==='destroy'){ready=false;hasVideo=false;player?.destroy();player=undefined;report('tick');return;}
 if(!ready||!player)return;
 switch(action.type){
  case 'cue':hasVideo=true;cueBrand?.update(showBrand,-1);player.cueVideoById({videoId:action.videoId,startSeconds:action.position});break;
  case 'play':player.playVideo();break;case 'pause':player.pauseVideo();break;
  case 'seek':player.seekTo(action.position,true);break;case 'volume':player.setVolume(action.level);break;
  case 'load_captions':player.loadModule?.('captions');break;case 'unload_captions':player.unloadModule?.('captions');break;
  case 'caption_track':player.setOption?.('captions','track',{languageCode:action.languageCode,kind:action.kind,name:action.name});break;
  case 'caption_size':player.setOption?.('captions','fontSize',action.size);break;
 }
}
async function start(){
 await listen<HostLoad>('player-host-load',event=>void load(event.payload));
 await listen<{epoch:number;command:HostCommand}>('player-host-command',event=>command(event.payload));
 const initial=await invoke<HostLoad|null>('player_host_ready');if(initial)void load(initial);
}
function startFrame(){
 const connect=(event:MessageEvent)=>{
  if(event.source!==window.parent||(event.origin!=='tauri://localhost'&&event.origin!=='null')||
     event.data?.type!=='ycore-player-connect'||event.data.path!==location.pathname||event.ports.length!==1)return;
  window.removeEventListener('message',connect);
  const port=event.ports[0];
  publish=packet=>port.postMessage(packet);
  port.onmessage=({data}:MessageEvent<FrameRequest>)=>{
   if(data?.type==='load')void load(data.load);
   else if(data?.type==='command')command(data);
  };
 };
 window.addEventListener('message',connect);
}
if(embedded)startFrame();
else void start().catch(()=>{});
const timer=setInterval(()=>{if(ready)report('tick');},250);
window.addEventListener('beforeunload',()=>{clearInterval(timer);player?.destroy();});
