import { createHash } from 'node:crypto';

export const COLLECTIONS = ['events', 'cals', 'reports'];
const stream = (db, companyId) => db.doc(`mcpHubStreams/${companyId}`);
const EVENT_FIELDS = new Set(['title','description','status','completed','start','end','startTime','endTime','allDay','place','calId','team','source','exceptions']);
export function serializeHubSource(d, collection) {
  const data = d.data();
  const fields = collection === 'events'
    ? Object.fromEntries(Object.entries(data).filter(([k]) => EVENT_FIELDS.has(k) || k.startsWith('repeat')))
    : collection === 'cals' ? { label: data.label || data.name || '' }
    : Object.fromEntries(['eventId','date','status'].filter(k => data[k] !== undefined).map(k => [k,data[k]]));
  if (collection === 'events') for (const k of ['gcalSync','icsRaw','icsUid']) if (data[k]) fields[k] = true;
  return { ...fields, id: d.id, __hubUpdatedAt: d.updateTime?.toDate().toISOString() || null };
}

// Re-read the authoritative document inside the sequence transaction. Eventarc
// delivery order is irrelevant: late notifications publish the current state.
// The journal row is also the durable event receipt; no TTL or deletion.
export async function recordHubChange(db, { companyId, collection, documentId, deliveryId }) {
  if (!COLLECTIONS.includes(collection) || !deliveryId) throw Error('invalid change notification');
  const head = stream(db, companyId);
  const receipt = head.collection('mcpHubChanges').doc(createHash('sha256').update(deliveryId).digest('hex'));
  return db.runTransaction(async tx => {
    const previous = await tx.get(receipt);
    if (previous.exists) return { duplicate: true, sequence: previous.data().sequence };
    const source = await tx.get(db.doc(`companies/${companyId}/${collection}/${documentId}`));
    const state = await tx.get(head);
    const sequence = (state.data()?.sequence || 0) + 1;
    if (!Number.isSafeInteger(sequence)) throw Error('sequence exhausted');
    tx.create(receipt, { sequence, collection, document_id: documentId, value: source.exists ? serializeHubSource(source, collection) : null });
    tx.set(head, { sequence, schema_version: 1 });
    return { sequence };
  });
}

export async function exportHubChanges(db, companyId, { cursor, through, limit = 200 } = {}) {
  const head = stream(db, companyId);
  if (cursor === undefined) {
    // Fence BEFORE source reads. Writes during the snapshot, including delayed
    // triggers, are replayed after this fence. Replays are whole-document sets.
    const state = await head.get();
    const fence = state.data()?.sequence || 0;
    const snapshots = await Promise.all(COLLECTIONS.map(c => db.collection(`companies/${companyId}/${c}`).get()));
    return { schema_version: 1, mode: 'bootstrap', cursor: fence,
      delivery_status: 'eventually_consistent', source_quiescence: 'unknown',
      sources: Object.fromEntries(COLLECTIONS.map((c, i) => [c, snapshots[i].docs.map(d => serializeHubSource(d, c))])) };
  }
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw Error('invalid cursor/limit');
  const high = (await head.get()).data()?.sequence || 0;
  const bound = through ?? high;
  if (!Number.isSafeInteger(bound) || bound < cursor || bound > high) throw Error('invalid upper fence');
  if (cursor === bound) return { schema_version: 1, mode: 'delta', items: [], cursor, through: bound, has_more: false,
    delivery_status: 'eventually_consistent', source_quiescence: 'unknown' };
  const snap = await head.collection('mcpHubChanges').where('sequence', '>', cursor).where('sequence', '<=', bound).orderBy('sequence').limit(limit).get();
  const items = snap.docs.map(d => d.data());
  // Atomic head+journal writes mean there must be no gaps. Fail closed if the
  // journal is missing/corrupt rather than silently moving the cursor.
  let expected = cursor;
  for (const item of items) if (item.sequence !== ++expected) throw Error('change journal gap');
  if (!items.length) throw Error('change journal unavailable');
  return { schema_version: 1, mode: 'delta', items, cursor: expected, through: bound, has_more: expected < bound };
}
