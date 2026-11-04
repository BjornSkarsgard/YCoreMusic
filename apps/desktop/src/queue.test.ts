import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackQueue } from './queue';
const tracks = ['A','B','C'].map(id => ({id,title:id,artist:'fixture'}));

test('selecting a stable queue entry keeps earlier items, duplicates and the following order',()=>{
 const queue=new PlaybackQueue();queue.reset([...tracks,tracks[0]]);const epoch=queue.generation;
 queue.insertNext([{...tracks[1],videoId:'inserted-B'}]);
 const order=queue.snapshot.map(track=>track.ordinal);
 assert.equal(queue.select(2,epoch)?.id,'C');assert.equal(queue.next()?.id,'A');assert.equal(queue.select(0,epoch)?.id,'A');assert.equal(queue.next()?.videoId,'inserted-B');assert.equal(queue.next()?.id,'B');
 assert.deepEqual(queue.snapshot.map(track=>track.ordinal),order);
 assert.equal(queue.select(999,epoch),undefined);assert.equal(queue.current?.id,'B');queue.reset(tracks);assert.equal(queue.select(2,epoch),undefined);assert.equal(queue.current?.id,'A');
});
test('ready C never overtakes pending B; duplicates keep independent ordinal', () => {
  const queue=new PlaybackQueue(); queue.reset(tracks);
  queue.resolve(2,'video-C',queue.generation);
  assert.equal(queue.next()?.id,'B'); assert.equal(queue.current?.videoId,undefined);
  assert.equal(queue.next()?.videoId,'video-C');
  queue.append([tracks[0]]); assert.equal(queue.next()?.ordinal,3);
  assert.equal(queue.next(),undefined); assert.equal(queue.current?.ordinal,3);
});
test('late resolution from an old source cannot alter a new queue', () => {
  const queue=new PlaybackQueue(); queue.reset(tracks); const stale=queue.generation;
  queue.reset([tracks[1]]); assert.equal(queue.resolve(0,'stale',stale),false);
  assert.equal(queue.current?.videoId,undefined);
  const snapshot=queue.snapshot; snapshot[0].title='mutated'; assert.equal(queue.current?.title,'B');
});


test('inserting next preserves the current cursor, stable async identities and repeated entries',()=>{
  const queue=new PlaybackQueue();queue.reset(tracks);const epoch=queue.generation;
  const pendingB=queue.snapshot[1].ordinal,pendingC=queue.snapshot[2].ordinal;
  queue.insertNext([{...tracks[0],videoId:'saved-A'}]);queue.append([{...tracks[1],videoId:'saved-B'}]);
  assert.equal(queue.current?.id,'A');assert.equal(queue.generation,epoch);
  assert.equal(queue.resolve(pendingB,'matched-B',epoch),true);assert.equal(queue.resolve(pendingC,'matched-C',epoch),true);
  assert.deepEqual(queue.ahead().map(entry=>entry.id),['A','A','B']);
  assert.equal(queue.next()?.videoId,'saved-A');assert.equal(queue.next()?.videoId,'matched-B');assert.equal(queue.next()?.videoId,'matched-C');assert.equal(queue.next()?.videoId,'saved-B');
  assert.equal(queue.hasNext,false);assert.equal(new Set(queue.snapshot.map(entry=>entry.ordinal)).size,5);
});

test('trimming an infinite queue bounds memory without changing live IDs or the current track',()=>{
 const queue=new PlaybackQueue();queue.reset(tracks);for(let n=0;n<100;n++){queue.append(tracks);queue.next();}
 const current=queue.current!.ordinal;queue.trimPast(10);assert.equal(queue.current!.ordinal,current);assert(queue.snapshot.findIndex(item=>item.ordinal===current)<=10);assert(queue.resolve(current,'current-video',queue.generation));
});
