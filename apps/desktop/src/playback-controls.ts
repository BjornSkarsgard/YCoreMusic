export class PreviousGesture {
  private last:number|null=null;
  reset(){this.last=null;}
  press(now:number):'restart'|'previous'{
    if(this.last!==null&&now>=this.last&&now-this.last<=3000){this.last=null;return 'previous';}
    this.last=now;return 'restart';
  }
}
export class VolumeState {
  private value=50;
  private silent=false;
  get level(){return this.value;}
  get muted(){return this.silent;}
  get output(){return this.silent?0:this.value;}
  set(value:number){if(!Number.isFinite(value))return;this.value=Math.round(Math.max(0,Math.min(100,value)));this.silent=false;}
  toggleMute(){this.silent=!this.silent;}
  serialize(){return JSON.stringify({level:this.value,muted:this.silent});}
  static restore(raw:string|null){
    const state=new VolumeState();
    try{const value=JSON.parse(raw??'null');if(value&&typeof value.level==='number'&&Number.isFinite(value.level)&&typeof value.muted==='boolean'){state.set(value.level);state.silent=value.muted;}}catch{}
    return state;
  }
}
