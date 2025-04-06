import assert from 'node:assert';
import { test } from 'node:test';
import { Collection } from '../src/store';
import { Query } from '../src/match';

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

await test('insert, findOne, and watchById', () => {
  const users = new Collection<{ id: string; name: string; nationality: string }>('test-users');
  users.remove({});
  users.insert({ id: 'abc', name: 'Stephan', nationality: 'Dutch' });


  const found = users.findOne({ id: 'abc' });
  assert.strictEqual(found?.name, 'Stephan');
});

await test('query with $gt, $in, $and', () => {
  const users = new Collection<{ id: string; age: number }>('query-users');
  users.remove({});
  users.insert({ id: '1', age: 30 });
  users.insert({ id: '2', age: 40 });
  users.insert({ id: '3', age: 20 });

  const over30 = users.find({ age: { $gt: 30 } });
  assert.deepStrictEqual(over30.map(u => u.id), ['2']);

  const multi = users.find({ $and: [{ age: { $gt: 25 } }, { id: { $in: ['1', '2'] } }] });
  assert.deepStrictEqual(multi.map(u => u.id).sort(), ['1', '2']);
});

await test('update, remove, and batch', () => {
  const users = new Collection<{ id: string; value: number }>('batch-users');
  users.remove({});

  users.batch(() => {
    users.insert({ id: 'a', value: 1 });
    users.insert({ id: 'b', value: 2 });
    users.insert({ id: 'c', value: 3 });
  });

  users.update({ value: 2 }, { $set: { value: 42 } });
  const updated = users.findOne({ id:'b' });
  assert.strictEqual(updated!.value, 42);

  users.remove({ id: 'a',  });
});

await test('reactive count and find', () => {
  const users = new Collection<{ id: string; x?: number; y?: number }>('reactive-users');
  users.remove({});
  const all = users.find({});

  users.insert({ id: 'x', x: 1 });
  users.insert({ id: 'y', y: 2 });

  assert.strictEqual(all.count(), 2);

  users.remove({ id: 'x' });
  assert.strictEqual(all.count(), 1);
});

await test('ttl index removes expired documents', async () => {
  const now = Date.now();
  const ttlUsers = new Collection<{ id: string; expiresAt: number }>('ttl-users', {
    ttlIndexes: [{ field: 'expiresAt', expireAfterSeconds: 0 }],
    ttlInterval: 50,
  });

  ttlUsers.remove({});
  ttlUsers.insert({ id: 'gone', expiresAt: now - 10_000 });
  ttlUsers.insert({ id: 'stay', expiresAt: now + 60_000 });

  assert.strictEqual(ttlUsers.count(), 2);
  await delay(100);
  assert.strictEqual(ttlUsers.count(), 1);
});

// await test.skip('indexedDbStorage adapter (browser-only)', async () => {
//   const coll = new Collection<{ id: string; name: string }>('idb-test', { storage: indexedDbStorage });
//   coll.clear();
//   coll.insert({ id: 'idb', name: 'Browser' });
//   await delay(10); // allow effect to write
//   const check = coll.findOne({ id: 'idb' });
//   assert.strictEqual(check.value?.name, 'Browser');
// });
//
// await test.skip('fileStorage adapter (Node)', async () => {
//   const coll = new Collection<{ id: string; name: string }>('file-test', {
//     storage: createFileStorage('./tmp-store.json'),
//   });
//   coll.clear();
//   coll.insert({ id: 'file', name: 'Node' });
//   await delay(10);
//   const check = coll.findOne({ id: 'file' });
//   assert.strictEqual(check.value?.name, 'Node');
// });
