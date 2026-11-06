/** A PLAYING event is not proof that media time is actually advancing. */
export class PlaybackProgress {
 private at:number|undefined;
 private position:number|undefined;
 reset(){this.at=undefined;this.position=undefined;}
 stalled(position:number,now:number,playing:boolean){
  if(!playing){this.reset();return false;}
  if(this.at===undefined){this.at=now;this.position=position;return false;}
  if(Number.isFinite(position)&&(this.position===undefined||!Number.isFinite(this.position)||Math.abs(position-this.position)>0.05)){
   this.at=now;this.position=position;
  }
  return now-this.at>=15000;
 }
}
