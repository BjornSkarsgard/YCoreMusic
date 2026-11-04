export type PlaybackSource='my_wave'|'smart_history'|'catalogue'|'history'|'manual';
export type EndReason='natural'|'skip'|'dislike'|'error'|'source_change'|'video_change'|'shutdown';

/** Counts observed playback, rather than the timeline position or time in buffering. */
export class ListeningMeter {
 private elapsed=0;
 private at:number;
 private position:number|undefined;
 private playing=false;
 constructor(private now:()=>number=()=>performance.now()){this.at=now();}
 sample(position:number|undefined){
  const at=this.now(),wall=Math.max(0,(at-this.at)/1000);
  if(this.playing&&position!==undefined&&Number.isFinite(position)&&this.position!==undefined){
   const advanced=position-this.position;
   // Unknown timeline jumps are seeks; a sleeping/stalled player adds no wall time.
   if(advanced>0&&advanced<=Math.max(2,wall*4))this.elapsed+=Math.min(advanced,wall)*1000;
  }
  this.at=at;this.position=position!==undefined&&Number.isFinite(position)?position:undefined;
 }
 state(playing:boolean,position:number|undefined){this.sample(position);this.playing=playing;}
 seek(position:number){this.at=this.now();this.position=position;}
 get listenedMs(){return Math.floor(this.elapsed);}
}
