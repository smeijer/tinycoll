// store.test.ts
import assert from 'node:assert';
import { test } from 'node:test';
import { createCollection } from '../src/store';

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

await test('insert, findOne, and watchById', () => {
  const users = createCollection('test-users');
  users.remove({});
  users.insert({ _id: 'abc', name: 'Stephan', nationality: 'Dutch' });

  const found = users.findOne({ _id: 'abc' });
  assert.strictEqual(found?.name, 'Stephan');
});

await test('query with $gt, $in, $and', () => {
  const users = createCollection('query-users');
  users.remove({});
  users.insert({ _id: '1', age: 30 });
  users.insert({ _id: '2', age: 40 });
  users.insert({ _id: '3', age: 20 });

  const over30 = users.find({ age: { $gt: 30 } });
  assert.deepStrictEqual(over30.map(u => u._id), ['2']);

  const multi = users.find({ $and: [{ age: { $gt: 25 } }, { _id: { $in: ['1', '2'] } }] });
  assert.deepStrictEqual(multi.map(u => u._id).sort(), ['1', '2']);
});

await test.only('update, remove, and batch', () => {
  const users = createCollection('batch-users');
  users.remove({});

  // users.batch(() => {
    users.insert({ _id: 'a', value: 1 });
    users.insert({ _id: 'b', value: 2 });
    users.insert({ _id: 'c', value: 3 });
  // });

  const found = users.find({ value: 2 }).toArray();
  console.log('----');
  console.dir({ found });
  users.update({ value: 2 }, { $set: { value: 42 } });
  console.log('--- result');
  const updated = users.findOne({ _id:'b' });
  console.log('updated', updated);
  assert.strictEqual(users.findOne({ _id:'b' })!.value, 42);


  users.remove({ _id: 'a' });
  // assert.strictEqual(users.findOne({ _id: 'a' }), undefined);
});

await test('reactive count and find', () => {
  const users = createCollection('reactive-users');
  users.remove({});
  const all = users.find({});

  users.insert({ _id: 'x', x: 1 });
  users.insert({ _id: 'y', y: 2 });

  assert.strictEqual(all.count(), 2);

  users.remove({ _id: 'x' });
  assert.strictEqual(all.count(), 1);
});

await test('ttl index removes expired documents', async () => {
  const now = Date.now();
  const ttlUsers = createCollection('ttl-users', {
    ttlIndexes: [{ field: 'expiresAt', expireAfterSeconds: 0 }],
  });

  ttlUsers.remove({});
  ttlUsers.insert({ _id: 'gone', expiresAt: now - 10_000 });
  ttlUsers.insert({ _id: 'stay', expiresAt: now + 60_000 });

  assert.strictEqual(ttlUsers.count(), 2);
  await delay(1100);
  assert.strictEqual(ttlUsers.count(), 1);
});

// await test.skip('indexedDbStorage adapter (browser-only)', async () => {
//   const coll = createCollection('idb-test', { storage: indexedDbStorage });
//   coll.clear();
//   coll.insert({ _id: 'idb', name: 'Browser' });
//   await delay(10); // allow effect to write
//   const check = coll.findOne({ _id: 'idb' });
//   assert.strictEqual(check.value?.name, 'Browser');
// });
//
// await test.skip('fileStorage adapter (Node)', async () => {
//   const coll = createCollection('file-test', {
//     storage: createFileStorage('./tmp-store.json'),
//   });
//   coll.clear();
//   coll.insert({ _id: 'file', name: 'Node' });
//   await delay(10);
//   const check = coll.findOne({ _id: 'file' });
//   assert.strictEqual(check.value?.name, 'Node');
// });
