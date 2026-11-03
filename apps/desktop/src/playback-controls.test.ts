import test from 'node:test';
import assert from 'node:assert/strict';
import {PreviousGesture,VolumeState} from './playback-controls';
test('Previous restarts first, goes back within 3 seconds, resets after timeout and track change',()=>{
 const gesture=new PreviousGesture();assert.equal(gesture.press(0),'restart');assert.equal(gesture.press(3000),'previous');
 assert.equal(gesture.press(4000),'restart');assert.equal(gesture.press(7001),'restart');gesture.reset();assert.equal(gesture.press(7100),'restart');
});
test('volume persists mute independently, clamps and never changes its pre-mute level',()=>{
 const volume=new VolumeState();volume.set(35);volume.toggleMute();assert.equal(volume.output,0);assert.equal(volume.level,35);
 const restored=VolumeState.restore(volume.serialize());assert.equal(restored.output,0);restored.toggleMute();assert.equal(restored.output,35);
 restored.set(150);assert.equal(restored.output,100);restored.set(-1);assert.equal(restored.output,0);restored.toggleMute();restored.toggleMute();assert.equal(restored.output,0);
 assert.equal(VolumeState.restore('broken').level,50);
});
