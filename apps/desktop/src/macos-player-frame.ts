import type {HostCommand,HostLoad,HostPacket} from './host-protocol';

export type FrameRequest =
 | {type:'load';load:HostLoad}
 | {type:'command';command:HostCommand;epoch:number};

export class MacPlayerFrame {
 readonly iframe = document.createElement('iframe');
 private readonly channel = new MessageChannel();
 private started = false;

 constructor(mount:string, url:URL, options:HostLoad, receive:(packet:HostPacket)=>void) {
  const frame = this.iframe;
  frame.id = mount;
  frame.title = 'YouTube';
  frame.src = url.href;
  frame.sandbox.add('allow-scripts','allow-same-origin');
  frame.allow = 'autoplay *; fullscreen *; encrypted-media *';
  frame.allowFullscreen = true;
  this.channel.port1.onmessage = ({data}:MessageEvent<HostPacket>) => {
   if(data?.epoch===options.epoch && Number.isSafeInteger(data.sequence) &&
      (data.cache?.iframeCount===1||(data.kind==='error'&&data.cache?.iframeCount===0)))receive(data);
  };
  frame.addEventListener('load',()=>{
   if(this.started || !frame.contentWindow)return;
   this.started = true;
   frame.contentWindow.postMessage({type:'ycore-player-connect',path:url.pathname},url.origin,[this.channel.port2]);
   this.send({type:'load',load:options});
  },{once:true});
  const target = document.getElementById(mount);
  if(!target)throw new Error('Missing clip surface');
  target.replaceWith(frame);
 }

 send(request:FrameRequest){this.channel.port1.postMessage(request);}

 close(){
  this.channel.port1.close();
  if(!this.started)this.channel.port2.close();
  this.iframe.remove();
 }
}
