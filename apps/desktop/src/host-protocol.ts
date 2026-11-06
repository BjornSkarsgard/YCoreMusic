export interface HostCache {position:number;duration:number;playback:number;quality:string;captionOptions:string[];captionTracks:{languageCode:string;kind:string;name:string;displayName:string}[];iframeCount:number}
export interface HostPacket {epoch:number;sequence:number;kind:'ready'|'state'|'error'|'api'|'quality'|'blocked'|'tick';cache:HostCache;errorCode?:number}
export interface HostLoad {epoch:number;controls:boolean}
export type HostCommand={type:'cue';videoId:string;position:number}|{type:'seek';position:number}|{type:'volume';level:number}|{type:'play'|'pause'|'destroy'|'load_captions'|'unload_captions'}|{type:'caption_track';languageCode:string;kind:string;name:string}|{type:'caption_size';size:number};
