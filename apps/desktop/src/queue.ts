export interface Track { id: string; title: string; artist: string }
export interface QueueEntry extends Track { ordinal: number; videoId?: string }
/** The sole queue cursor. Source adapter bookkeeping is not a playback queue. */
export class PlaybackQueue {
  private entries: QueueEntry[] = [];
  private cursor = 0;
  private epoch = 0;
  get generation() { return this.epoch; }
  get current() { return this.entries[this.cursor]; }
  get snapshot(): readonly QueueEntry[] { return this.entries.map(entry => ({...entry})); }
  reset(tracks: Track[]) { this.epoch++; this.cursor = 0; this.entries = []; this.append(tracks); }
  append(tracks: Track[]) { for (const track of tracks) this.entries.push({...track, ordinal:this.entries.length}); }
  resolve(ordinal: number, videoId: string, generation: number): boolean {
    if (generation !== this.epoch || !this.entries[ordinal]) return false;
    this.entries[ordinal].videoId = videoId; return true;
  }
  clearVideo(ordinal:number) { if(this.entries[ordinal]) this.entries[ordinal].videoId=undefined; }
  next(): QueueEntry | undefined {
    if (this.cursor + 1 >= this.entries.length) return undefined;
    return this.entries[++this.cursor];
  }
}
