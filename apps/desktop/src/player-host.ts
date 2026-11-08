import {invoke,isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type {HostCache,HostCommand,HostPacket} from './host-protocol';
import {MacPlayerFrame} from './macos-player-frame';
const emptyCache=():HostCache=>({position:0,duration:0,playback:-1,quality:'default',captionOptions:[],captionTracks:[],iframeCount:0});
let capability:Promise<boolean>|undefined,available=false,epoch=0,active:HostPlayer|undefined;
let macPage:Promise<URL>|undefined,macUrl:URL|undefined;
export function hostAvailable(){
 if(capability)return capability;
 capability=(async()=>{
  if(!isTauri())return false;
  const status=await invoke<{supported:boolean;epoch:number}>('player_host_status');
  if(!status?.supported)return false;
  epoch=status.epoch;
  await listen<HostPacket>('player-host-event',event=>active?.receive(event.payload));
  await listen('player-host-panel-closed',()=>document.dispatchEvent(new Event('player-host-panel-closed')));
  available=true;document.body.classList.add('native-player-host');return true;
 })().catch(()=>false);return capability;
}
export async function preparePlayer(){
 if(await hostAvailable())return true;
 // Development already has an HTTP origin. The packaged WKWebView uses the
 // Tauri scheme and requires the bundled player page on a browser HTTP origin.
 if(!isTauri()||location.protocol!=='tauri:'||!/^Mac/.test(navigator.platform))return false;
 macPage ??= invoke<string>('macos_player_url').then(value=>{
  const url=new URL(value);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||
     !/^\/player\/[a-f0-9]{32}\/player-host\.html$/.test(url.pathname))throw Error('Invalid Mac player origin');
  return macUrl=url;
 }).catch(error=>{macPage=undefined;throw error;});
 await macPage;
 return true;
}
class HostPlayer {
 private cache=emptyCache();private sequence=-1;private destroyed=false;
 private commands:Promise<void>=Promise.resolve();
 readonly epoch=++epoch;
 private macFrame:MacPlayerFrame|undefined;
 constructor(private options:YT.PlayerOptions, mount:string){
  active=this;
  delete document.body.dataset.playerHostFailure;
  const load={epoch:this.epoch,controls:options.playerVars?.controls===1};
  if(macUrl)this.macFrame=new MacPlayerFrame(mount,macUrl,load,packet=>this.receive(packet));
  else void invoke('player_host_load',{options:load}).catch(error=>{document.body.dataset.playerHostFailure='load: '+String(error).slice(0,200);this.emit('onError',5);});
 }
 private command(command:HostCommand){if(this.destroyed)return;if(this.macFrame){this.macFrame.send({type:'command',epoch:this.epoch,command});return;}this.commands=this.commands.then(async()=>{if(this.destroyed&&command.type!=='destroy')return;await invoke('player_host_command',{epoch:this.epoch,command});}).catch(error=>{document.body.dataset.playerHostFailure='command: '+String(error).slice(0,200);this.emit('onError',5);});}
 private emit(name:keyof YT.Events,data?:unknown){if(this.destroyed)return;const callback=this.options.events?.[name] as ((event:unknown)=>void)|undefined;callback?.({target:this,data});}
 receive(packet:HostPacket){
  if(this.destroyed||packet.epoch!==this.epoch||packet.sequence<=this.sequence)return;
  const captionsChanged=JSON.stringify([this.cache.captionOptions,this.cache.captionTracks])!==JSON.stringify([packet.cache.captionOptions,packet.cache.captionTracks]),qualityChanged=this.cache.quality!==packet.cache.quality;
  this.sequence=packet.sequence;this.cache=packet.cache;
  switch(packet.kind){
   case 'ready':this.emit('onReady');break;
   case 'state':this.emit('onStateChange',packet.cache.playback);break;
   case 'error':this.emit('onError',packet.errorCode??5);break;
   case 'api':this.emit('onApiChange');break;
   case 'quality':this.emit('onPlaybackQualityChange',packet.cache.quality);break;
   case 'blocked':this.emit('onAutoplayBlocked');break;
   case 'tick':if(captionsChanged)this.emit('onApiChange');if(qualityChanged)this.emit('onPlaybackQualityChange',packet.cache.quality);break;
  }
 }
 cueVideoById(value:string|YT.VideoByIdSettings){this.command({type:'cue',videoId:typeof value==='string'?value:value.videoId,position:typeof value==='string'?0:value.startSeconds??0});}
 playVideo(){this.command({type:'play'});}pauseVideo(){this.command({type:'pause'});}
 seekTo(position:number){this.command({type:'seek',position});}
 setVolume(level:number){this.command({type:'volume',level});}
 getCurrentTime(){return this.cache.position;}getDuration(){return this.cache.duration;}getPlayerState(){return this.cache.playback;}
 getPlaybackQuality(){return this.cache.quality;}
 getOptions(module?:string){return module==='captions'?this.cache.captionOptions:['captions'];}
 getOption(module:string,option:string){if(module==='captions'&&option==='tracklist')return this.cache.captionTracks;return undefined;}
 setOption(module:string,option:string,value:unknown){
  if(module!=='captions')return;
  if(option==='fontSize'&&typeof value==='number')this.command({type:'caption_size',size:value});
  if(option==='track'&&value&&typeof value==='object'){
   const track=value as {languageCode?:string;kind?:string;name?:string};
   if(track.languageCode)this.command({type:'caption_track',languageCode:track.languageCode,kind:track.kind??'',name:track.name??''});
   else this.command({type:'unload_captions'});
  }
 }
 loadModule(module:string){if(module==='captions')this.command({type:'load_captions'});}
 unloadModule(module:string){if(module==='captions')this.command({type:'unload_captions'});}
 getIframe(){return this.macFrame?.iframe;}
 destroy(){if(this.destroyed)return;if(this.macFrame)this.macFrame.close();else this.command({type:'destroy'});this.destroyed=true;if(active===this)active=undefined;}
}
export function createPlayer(mount:string,options:YT.PlayerOptions):YT.Player{return available||macUrl?new HostPlayer(options,mount) as unknown as YT.Player:new YT.Player(mount,options);}
