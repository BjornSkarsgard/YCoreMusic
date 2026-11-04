import {storage} from './storage';
import type {SavedVideos} from './video-favorites';
export async function savedVideos(trackId:string):Promise<SavedVideos>{
 const value=await storage<SavedVideos|undefined>({type:'get_videos',trackId});
 if(value&&Array.isArray(value.videos))return value;
 // Compatibility with an older bridge; new stores always return the full set.
 const single=await storage<string|null>({type:'get_video',trackId});
 return {videos:single?[{videoId:single,unavailable:false}]:[],lastVideoId:null};
}
