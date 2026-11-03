import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackQueue } from './queue';
const tracks = ['A','B','C'].map(id => ({id,title:id,artist:'fixture'}));
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
