import test from 'node:test';
import assert from 'node:assert/strict';
import { trackedFirestore, withReadUsage, identifyReadUsage } from '../lib/readUsage.js';

function fakeDb() {
  const ref = { get: async () => ({ exists: false }) };
  const query = { where() { assert.equal(this, query); return this; }, get: async () => ({ docs: [{}, {}] }) };
  return { ref, db: { doc: () => ref, collection: () => query,
    getAll: async (...refs) => { assert.ok(refs.every(r => r === ref)); return refs.map(() => ({ exists: true })); },
    runTransaction: async callback => callback({ get: async r => { assert.equal(r, ref); return { exists: true }; }, set(r) { assert.equal(r, ref); return this; } }) } };
}

test('counts native reads, empty queries, transaction refs; emits no document body', async () => {
  const { db } = fakeDb(); const wrapped = trackedFirestore(db); const rows = [];
  await withReadUsage('appReadData', async () => {
    identifyReadUsage({ user: { uid: 'verified-id', companyId: 'co', pw: 'must-not-log' }, kind: 'admin' });
    await wrapped.collection('events').where('date', '==', 'secret-content').get();
    await wrapped.doc('secret-path').get();
    await wrapped.getAll(wrapped.doc('a'), wrapped.doc('b'));
    await wrapped.runTransaction(async tx => { await tx.get(wrapped.doc('c')); tx.set(wrapped.doc('d'), {}); });
  }, row => rows.push(row))();
  assert.equal(rows[0].documentReads, 6); assert.equal(rows[0].readCalls, 4);
  assert.equal(rows[0].accountId, 'verified-id');
  assert.ok(!JSON.stringify(rows).includes('secret')); assert.ok(!JSON.stringify(rows).includes('must-not-log'));
  const empty = trackedFirestore({ get: async () => ({ docs: [] }) });
  await withReadUsage('empty', async () => empty.get(), row => rows.push(row))();
  assert.equal(rows[1].documentReads, 1);
});

test('parallel requests keep accounts and counts separate, errors preserve original behavior', async () => {
  const { db } = fakeDb(); const wrapped = trackedFirestore(db); const rows = [];
  await Promise.all(['a', 'b'].map(account => withReadUsage('parallel', async () => {
    identifyReadUsage({ user: { uid: account } });
    await new Promise(resolve => setTimeout(resolve, account === 'a' ? 10 : 1));
    await wrapped.doc('x').get();
    if (account === 'a') await wrapped.doc('y').get();
  }, row => rows.push(row))()));
  assert.equal(rows.find(r => r.accountId === 'a').documentReads, 2);
  assert.equal(rows.find(r => r.accountId === 'b').documentReads, 1);
  const failure = new Error('preserved');
  await assert.rejects(withReadUsage('failure', async () => { await wrapped.doc('z').get(); throw failure; }, r => rows.push(r)), error => error === failure);
  assert.equal(rows.at(-1).status, 'error'); assert.equal(rows.at(-1).documentReads, 1);
  assert.equal(await withReadUsage('log-failure', async () => 42, () => { throw Error(); })(), 42);
});
