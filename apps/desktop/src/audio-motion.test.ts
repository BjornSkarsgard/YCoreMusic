import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudioMotion} from './audio-motion';
test('bass attacks create impacts, a sustained tone settles, and silence does not invent beats',()=>{
 const motion=new AudioMotion(),levels=new Float32Array(48);
 for(let i=0;i<100;i++)assert.deepEqual(motion.update(levels,16),{bass:0,energy:0,impact:0,burst:false});
 levels.fill(.9,0,14);const attack=motion.update(levels,16);assert(attack.impact>.9&&attack.burst);
 let sustain=attack;for(let i=0;i<150;i++)sustain=motion.update(levels,16);assert(sustain.impact<.05&&!sustain.burst);
 levels.fill(0);for(let i=0;i<100;i++)motion.update(levels,16);levels.fill(.9,0,14);assert(motion.update(levels,16).burst);
 motion.reset();levels.fill(0);levels.fill(.8,30);assert.equal(motion.update(levels,16).impact,0);
});
