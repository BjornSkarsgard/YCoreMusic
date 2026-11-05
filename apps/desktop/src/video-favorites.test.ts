import test from 'node:test';import assert from 'node:assert/strict';
import {favoriteOrder} from './video-favorites';
test('favorites shuffle without an immediate repeat and retain every fallback',()=>{
 const items=[{id:'A'},{id:'B'},{id:'C'}];
 for(const random of [()=>0,()=>.5,()=>.999])for(const previous of ['A','B','C']){
  const ordered=favoriteOrder(items,previous,random);assert.notEqual(ordered[0].id,previous);assert.deepEqual(ordered.map(i=>i.id).sort(),['A','B','C']);
 }
 assert.deepEqual(favoriteOrder([],null),[]);assert.deepEqual(favoriteOrder([{id:'A'}],'A'),[{id:'A'}]);assert.deepEqual(items.map(i=>i.id),['A','B','C']);
});

test('an explicit preferred clip takes priority while other favorites remain as fallbacks',()=>{
 const items=[{id:'A'},{id:'B',preferred:true},{id:'C'}];
 for(const random of [()=>0,()=>.5,()=>.999]){const ordered=favoriteOrder(items,'B',random);assert.equal(ordered[0].id,'B');assert.deepEqual(ordered.map(item=>item.id).sort(),['A','B','C']);}
});
