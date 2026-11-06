import {invoke,isTauri} from '@tauri-apps/api/core';
export interface PlatformCapabilities {videoMirrors:boolean;audioAnalysis:boolean}
let pending:Promise<PlatformCapabilities|null>|undefined;
export function platformCapabilities(){
 return pending??=(async()=>{
  if(!isTauri())return null;
  try{
   const value=await invoke<PlatformCapabilities>('platform_capabilities');
   return typeof value?.videoMirrors==='boolean'&&typeof value?.audioAnalysis==='boolean'?value:null;
  }catch{return null;}
 })();
}
