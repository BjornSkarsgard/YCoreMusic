import {storage} from './storage';
import type {SavedVideos} from './video-favorites';
const policies=new Map<string,SavedVideos>(),versions=new Map<string,number>();
function rememberPolicy(trackId:string,value:SavedVideos){policies.delete(trackId);policies.set(trackId,value);if(policies.size>1024)policies.delete(policies.keys().next().value!);}
export const videoPolicyVersion=(trackId:string)=>versions.get(trackId)??0;
export function invalidateVideoPolicy(trackId:string){versions.set(trackId,videoPolicyVersion(trackId)+1);}
export const videoExcluded=(trackId:string,videoId:string)=>policies.get(trackId)?.excludedVideoIds?.includes(videoId)??false;
export function allowedVideos<T extends {id:string}>(trackId:string,videos:T[]|null|undefined):T[]{return Array.isArray(videos)?videos.filter(video=>!videoExcluded(trackId,video.id)):[];}
export async function savedVideos(trackId:string):Promise<SavedVideos>{
 const version=videoPolicyVersion(trackId);
 const value=await storage<SavedVideos|undefined>({type:'get_videos',trackId});
 if(version!==videoPolicyVersion(trackId))return savedVideos(trackId);
 if(value&&Array.isArray(value.videos)){rememberPolicy(trackId,value);return value;}
 // Compatibility with an older bridge; new stores always return the full set.
 const single=await storage<string|null>({type:'get_video',trackId});
 if(version!==videoPolicyVersion(trackId))return savedVideos(trackId);
 const saved={videos:single?[{videoId:single,unavailable:false}]:[],lastVideoId:null};rememberPolicy(trackId,saved);return saved;
}
