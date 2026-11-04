import type {Track,QueueInput} from './queue';
export interface SmartCandidate extends Track {historyVideoId:string;weight:number}
export function historyBatch(pool:readonly SmartCandidate[],previous?:string,count=8,random=Math.random):QueueInput[]{
 const eligible=pool.filter(track=>Number.isFinite(track.weight)&&track.weight>0&&track.id&&/^[\w-]{11}$/.test(track.historyVideoId));
 const batch:QueueInput[]=[];let last=previous;
 for(let index=0;index<count&&eligible.length;index++){
  const choices=eligible.length>1?eligible.filter(track=>track.id!==last):eligible;
  let target=random()*choices.reduce((sum,track)=>sum+track.weight,0),chosen=choices.at(-1)!;
  for(const track of choices){target-=track.weight;if(target<0){chosen=track;break;}}
  batch.push({id:chosen.id,title:chosen.title,artist:chosen.artist,historyVideoId:chosen.historyVideoId});last=chosen.id;
 }
 return batch;
}
