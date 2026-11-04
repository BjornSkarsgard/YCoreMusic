import { invoke } from '@tauri-apps/api/core';
export function storage<T>(request:Record<string,unknown>):Promise<T>{return invoke<T>('storage_command',{request});}
export interface HistoryEntry{id:number;trackId:string;title:string;artist:string;videoId:string;startedAt:string;source?:string|null;listenedMs?:number|null;durationMs?:number|null;endReason?:string|null;endedAt?:string|null}
