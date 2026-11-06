/** Envelopes and positive spectral flux from actual FFT bands, never a beat clock. */
export class AudioMotion {
 private floor=0;private previousBass=0;private impact=0;
 update(levels:Float32Array,delta:number){
  const bass=levels.subarray(0,14).reduce((sum,v)=>sum+v,0)/14;
  const energy=Math.sqrt(levels.reduce((sum,v)=>sum+v,0)/levels.length);
  const flux=Math.max(0,bass-this.previousBass);this.previousBass=bass;
  const attack=Math.min(1,Math.max(flux*9,(bass-this.floor-.04)*3));
  this.floor+=(bass-this.floor)*(1-Math.exp(-delta/450));
  this.impact=Math.max(attack,this.impact*Math.exp(-delta/120));
  return {bass,energy,impact:this.impact,burst:flux>.018&&attack>.22};
 }
 reset(){this.floor=this.previousBass=this.impact=0;}
}
