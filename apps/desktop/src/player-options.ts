interface CaptionApi {
  getOptions?(module?:string):string[];
  getOption?(module:string,option:string):unknown;
  setOption?(module:string,option:string,value:unknown):void;
  loadModule?(module:string):void;
  unloadModule?(module:string):void;
}
interface CaptionTrack {languageCode:string;kind:string;name:string;label:string;key:string}
// Only use options the running player reports. Caption track controls are
// experimentally exposed by YouTube; fontSize is part of its documented API.
export class CaptionControls {
  private api:CaptionApi|undefined;
  private tracks:CaptionTrack[]=[];
  private pending=true;
  private wanted='off';
  private lastApply=0;
  constructor(private select:HTMLSelectElement,private size:HTMLSelectElement,private status:HTMLElement){
    select.onchange=()=>{
      const track=this.tracks.find(track=>track.key===select.value);
      try{this.wanted=track?.key??'off';this.apply();status.textContent='';}
      catch{status.textContent='Не удалось изменить субтитры. Повторите или откройте панель YouTube.';}
    };
    size.onchange=()=>{try{this.api?.setOption?.('captions','fontSize',Number(size.value));}catch{status.textContent='Не удалось изменить размер субтитров.';}};
    this.reset();
  }
  private apply(){
    this.lastApply=Date.now();
    const track=this.tracks.find(track=>track.key===this.wanted);
    if(track){this.api?.loadModule?.('captions');this.api?.setOption?.('captions','track',{languageCode:track.languageCode,kind:track.kind,name:track.name});}
    else if(this.api?.unloadModule)this.api.unloadModule('captions');
    else this.api?.setOption?.('captions','track',{});
    this.api?.setOption?.('captions','fontSize',Number(this.size.value));
  }
  reset(){this.api=undefined;this.tracks=[];this.pending=true;this.select.replaceChildren(new Option('Субтитры недоступны','off'));this.select.disabled=true;this.size.disabled=true;}
  refresh(player:unknown,enforce=false){
    const api=player as CaptionApi;
    if(!api?.getOptions || !api.getOption || !api.setOption)return;
    try{
      const options=api.getOptions('captions');
      if(!Array.isArray(options))return;
      this.api=api;this.size.disabled=!options.includes('fontSize');
      if(!options.includes('tracklist')||!options.includes('track'))return;
      const raw=api.getOption('captions','tracklist');
      if(!Array.isArray(raw))return;
      this.tracks=raw.slice(0,100).flatMap(value=>{
        if(!value || typeof value.languageCode!=='string' || value.languageCode.length>64)return [];
        const languageCode=value.languageCode,kind=typeof value.kind==='string'?value.kind.slice(0,64):'',name=typeof value.name==='string'?value.name.slice(0,256):'';
        const label=String(value.displayName??value.languageName??languageCode).slice(0,256)+(kind==='asr'?' · автоматически':'');
        return [{languageCode,kind,name,label,key:JSON.stringify([languageCode,kind,name])}];
      });
      if(!this.tracks.length){this.select.disabled=true;return;}
      this.select.replaceChildren(new Option('Выкл.','off'),...this.tracks.map(track=>new Option(track.label,track.key)));
      this.select.disabled=false;
      // getOption(track) can retain the last language after captions are off.
      // Keep the explicit choice, rather than turning the selector back on.
      if(this.pending||enforce||(this.wanted==='off'&&Date.now()-this.lastApply>250)){this.pending=false;this.apply();}
      this.select.value=this.tracks.some(track=>track.key===this.wanted)?this.wanted:'off';
    }catch{this.select.disabled=true;this.size.disabled=true;}
  }
}
export function qualityLabel(value:string){
  const labels:Record<string,string>={tiny:'144p',small:'240p',medium:'360p',large:'480p',hd720:'720p',hd1080:'1080p',hd1440:'1440p',hd2160:'2160p',highres:'Высокое'};
  return labels[value]??'Авто';
}
