import test from 'node:test';import assert from 'node:assert/strict';import {historyBatch} from './smart-history';
test('history sampling honors weights without immediate repeats and keeps known video IDs',()=>{
 const pool=[{id:'1',title:'A',artist:'Artist',historyVideoId:'Aaaaaaaaaaa',weight:100},{id:'2',title:'B',artist:'Artist',historyVideoId:'Bbbbbbbbbbb',weight:1}];
 const batch=historyBatch(pool,'1',8,()=>0);assert.equal(batch[0].id,'2');for(let i=1;i<batch.length;i++)assert.notEqual(batch[i].id,batch[i-1].id);assert.equal(batch[0].historyVideoId,'Bbbbbbbbbbb');
 assert.equal(historyBatch(pool,undefined,1,()=>.5)[0].id,'1');assert.equal(historyBatch(pool,undefined,1,()=>.999)[0].id,'2');assert.equal(historyBatch([pool[0]],'1',3).length,3);assert.deepEqual(historyBatch([],undefined),[]);assert.deepEqual(historyBatch([{...pool[0],weight:NaN}],undefined),[]);
});
