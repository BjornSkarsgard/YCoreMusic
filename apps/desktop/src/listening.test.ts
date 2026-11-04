import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ListeningMeter} from './listening';

test('listening excludes pause, buffering and seeks but keeps earlier listening across recovery',()=>{
 let at=0;const meter=new ListeningMeter(()=>at);
 meter.state(true,0);at=5000;meter.sample(5);assert.equal(meter.listenedMs,5000);
 meter.state(false,5);at+=60000;meter.sample(5);assert.equal(meter.listenedMs,5000);
 meter.seek(90);meter.state(true,90);at+=2000;meter.sample(92);assert.equal(meter.listenedMs,7000);
 meter.state(false,92);at+=15000;meter.seek(92);meter.state(true,92);at+=1000;meter.sample(93);assert.equal(meter.listenedMs,8000);
 at+=500;meter.sample(119);assert.equal(meter.listenedMs,8000);
 at+=500;meter.sample(119.5);assert.equal(meter.listenedMs,8500);
});
test('a stalled PLAYING flag adds nothing; hidden playback counts media advance and a new play starts empty',()=>{
 let at=0;const meter=new ListeningMeter(()=>at);meter.state(true,0);
 at=15000;meter.sample(0);assert.equal(meter.listenedMs,0);
 at+=60000;meter.sample(60);assert.equal(meter.listenedMs,60000);
 at+=1000;meter.sample(Number.NaN);at+=1000;meter.sample(62);assert.equal(meter.listenedMs,60000);
 assert.equal(new ListeningMeter(()=>at).listenedMs,0);
});
