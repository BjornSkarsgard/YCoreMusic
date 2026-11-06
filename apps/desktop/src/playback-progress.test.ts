import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackProgress} from './playback-progress';

test('a stale PLAYING flag times out at zero, a frozen position or an invalid position',()=>{
 for(const position of [0,17,NaN]){
  const progress=new PlaybackProgress();assert.equal(progress.stalled(position,0,true),false);
  for(let second=1;second<15;second++)assert.equal(progress.stalled(position,second*1000,true),false);
  assert.equal(progress.stalled(position,15000,true),true);
 }
});
test('real media advance, seeks, pause and a different video each reset the stall budget',()=>{
 const progress=new PlaybackProgress();
 for(let second=0;second<60;second++)assert.equal(progress.stalled(second,second*1000,true),false);
 assert.equal(progress.stalled(3,60000,true),false);
 assert.equal(progress.stalled(3,74000,true),false);
 assert.equal(progress.stalled(3,75000,false),false);
 assert.equal(progress.stalled(3,100000,true),false);
 progress.reset();assert.equal(progress.stalled(0,200000,true),false);
 assert.equal(progress.stalled(0,215000,true),true);
});
