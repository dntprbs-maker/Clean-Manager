import { createHash } from 'node:crypto';

// Private, server-only journal. Store identifiers, never credentials or copies
// of unrestricted business records. Head + receipt + sequence are atomic.
export async function recordAppReadChange(db, event, collection) {
  const { companyId, id } = event.params;
  const head = db.doc(`companies/${companyId}/meta/readRevision`);
  const stream = db.doc(`appAuthReadStreams/${companyId}`);
  const receipt = stream.collection('changes').doc(createHash('sha256').update(event.id).digest('hex'));
  return db.runTransaction(async tx => {
    const previous = await tx.get(receipt);
    if (previous.exists) return;
    const state = await tx.get(head);
    const revision = (state.data()?.revision || 0) + 1;
    if (!Number.isSafeInteger(revision)) throw Error('read revision exhausted');
    const eventIds = collection === 'reports'
      ? [...new Set([event.data?.before.data()?.eventId, event.data?.after.data()?.eventId].filter(v => typeof v === 'string' && v && !v.includes('/')))]
      : collection === 'events' ? [id] : [];
    tx.create(receipt, { revision, collection, id, eventIds });
    tx.set(head, { revision, journalVersion: 1 }, { merge: true });
  });
}

// A gap, old client, changed permission scope or long absence requires a safe
// range snapshot. Ordinary edits only load their changed document identifiers.
export async function readAppChanges(db, companyId, input, prepared) {
  const since = input.knownRevision;
  if (input.deltaVersion !== 1 || input.scopeKey !== prepared.scopeKey
      || !Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(prepared.revision)
      || since > prepared.revision || prepared.revision - since > 200) return null;
  const events = new Set(input.refreshEventIds || []), reports = new Set(input.refreshReportIds || []), sources = new Set(events);
  if (reports.size) {
    const current = await getSourceIds(db,companyId,'reports',[...reports]);
    for (const d of current.docs) if (typeof d.data().eventId === 'string') sources.add(d.data().eventId);
  }
  if (since === prepared.revision) return events.size || reports.size
    ? {eventIds:[...events],reportIds:[...reports],sourceIds:[...sources]} : null;
  const snap = await db.doc(`appAuthReadStreams/${companyId}`).collection('changes')
    .where('revision', '>', since).where('revision', '<=', prepared.revision).orderBy('revision').limit(201).get();
  let expected = since;
  for (const d of snap.docs) {
    const row = d.data();
    if (row.revision !== ++expected || !['events', 'reports'].includes(row.collection)) return null;
    if (row.collection === 'events') events.add(row.id);
    else reports.add(row.id);
    for (const id of row.eventIds || []) sources.add(id);
  }
  if (expected !== prepared.revision) return null;
  return { eventIds: [...events], reportIds: [...reports], sourceIds: [...sources] };
}

export async function getSourceIds(db, companyId, kind, ids) {
  const unique = [...new Set(ids)];
  const docs = [];
  for (let i = 0; i < unique.length; i += 100) {
    docs.push(...await db.getAll(...unique.slice(i, i + 100).map(id => db.doc(`companies/${companyId}/${kind}/${id}`))));
  }
  return { docs: docs.filter(d => d.exists) };
}
