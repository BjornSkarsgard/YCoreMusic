export interface Track { id: string; title: string; artist: string;waveRef?:string }
export interface QueueEntry extends Track { ordinal: number; videoId?: string;historyVideoId?:string;playbackSource?:import('./listening').PlaybackSource }
export type QueueInput = Track & { videoId?: string;historyVideoId?:string;playbackSource?:import('./listening').PlaybackSource };
/** The sole queue cursor. Source adapter bookkeeping is not a playback queue. */
export class PlaybackQueue {
  private entries: QueueEntry[] = [];
  private cursor = 0;
  private epoch = 0;
  private nextOrdinal = 0;
  get generation() { return this.epoch; }
  get current() { return this.entries[this.cursor]; }
  get snapshot(): readonly QueueEntry[] { return this.entries.map(entry => ({...entry})); }
  reset(tracks: QueueInput[]) { this.epoch++; this.cursor = 0; this.nextOrdinal=0; this.entries = []; this.append(tracks); }
  append(tracks: QueueInput[]) { this.entries.push(...tracks.map(track=>({...track,ordinal:this.nextOrdinal++}))); }
  insertNext(tracks:QueueInput[]) { this.entries.splice(this.cursor+1,0,...tracks.map(track=>({...track,ordinal:this.nextOrdinal++}))); }
  trimPast(retain:number){const remove=Math.max(0,this.cursor-retain);if(remove){this.entries.splice(0,remove);this.cursor-=remove;}}
  rewind():QueueEntry|undefined { this.cursor=0;return this.current; }
  get hasNext() { return this.cursor+1<this.entries.length; }
  ahead(count=3):readonly QueueEntry[] { return this.entries.slice(this.cursor,this.cursor+count).map(entry=>({...entry})); }
  resolve(ordinal: number, videoId: string, generation: number): boolean {
    if (generation !== this.epoch) return false;
    const entry=this.entries.find(entry=>entry.ordinal===ordinal);
    if(!entry)return false;
    entry.videoId = videoId; return true;
  }
  clearVideo(ordinal:number) { const entry=this.entries.find(entry=>entry.ordinal===ordinal);if(entry)entry.videoId=undefined; }
  previous(): QueueEntry | undefined {if(this.cursor<=0)return undefined;return this.entries[--this.cursor];}
  next(): QueueEntry | undefined {
    if (this.cursor + 1 >= this.entries.length) return undefined;
    return this.entries[++this.cursor];
  }
}
