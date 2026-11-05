export interface VideoFavorite {videoId:string;unavailable:boolean}
export interface SavedVideos {videos:VideoFavorite[];lastVideoId:string|null;preferredVideoId?:string|null;excludedVideoIds?:string[]}
/** Shuffle every replay, excluding the previous video from first place when possible. */
export function favoriteOrder<T extends {id:string;preferred?:boolean}>(items:readonly T[],previous?:string|null,random= Math.random):T[]{
 const shuffled=[...items];
 for(let index=shuffled.length-1;index>0;index--){const other=Math.min(index,Math.floor(Math.max(0,random())*(index+1)));[shuffled[index],shuffled[other]]=[shuffled[other],shuffled[index]];}
 if(shuffled.length>1&&shuffled[0].id===previous){const other=1+Math.min(shuffled.length-2,Math.floor(Math.max(0,random())*(shuffled.length-1)));[shuffled[0],shuffled[other]]=[shuffled[other],shuffled[0]];}
 const preferred=shuffled.findIndex(item=>item.preferred);if(preferred>0)shuffled.unshift(...shuffled.splice(preferred,1));
 return shuffled;
}
