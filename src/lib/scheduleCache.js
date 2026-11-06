// Projected, account-scoped application snapshots survive process termination.
// This cache is display-only: server confirmation remains required for money.
const DB = 'clean-manager-schedule-v1';
const STORE = 'snapshots';
export function applySavedEntity(rows,id,patch,remove=false,version) {
  if (remove) return rows.filter(row=>row.id!==id);
  const update=row=>{
    const next={...row,id,...(version?{__readVersion:version}:{})};
    for(const [key,value] of Object.entries(patch||{})) {
      const parts=key.split('.');
      if(parts[0]==='exceptions'&&row.__occurrenceOnly) {
        if(parts[1]===(row._origDate||row.start))Object.assign(next,value);
        continue;
      }
      let target=next;
      for(const part of parts.slice(0,-1)){target[part]={...target[part]};target=target[part];}
      target[parts.at(-1)]=value;
    }
    return next;
  };
  return rows.some(row=>row.id===id)?rows.map(row=>row.id===id?update(row):row):[...rows,update({})];
}
let opened;
function database() {
  if (!opened) opened = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(() => null);
  return opened;
}
export async function readScheduleCache(key) {
  try {
    const db = await database();
    if (!db) return null;
    return await new Promise(resolve => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result?.version === 1 ? request.result : null);
      request.onerror = () => resolve(null);
    });
  } catch { return null; }
}
export async function writeScheduleCache(key, data) {
  try {
    if (!localStorage.getItem('loginUser')) return false;
    const db = await database();
    if (!db) return false;
    return await new Promise(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      const store=tx.objectStore(STORE);
      const existing=store.get(key);
      existing.onsuccess=()=>{
        if (!localStorage.getItem('loginUser')) return;
        const previous=existing.result?.data;
        if (Number.isSafeInteger(previous?.revision) && Number.isSafeInteger(data.revision) && previous.revision>data.revision) return;
        store.put({ version: 1, data, savedAt: Date.now() }, key);
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    });
  } catch { return false; }
}
export async function clearScheduleCache() {
  try {
    const db = await database();
    if (!db) return;
    await new Promise(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = tx.onerror = tx.onabort = resolve;
    });
  } catch { /* Storage unavailable does not prevent signing out. */ }
}
export function mergeScheduleSnapshot(previous, incoming) {
  if (incoming.notModified) return { ...previous, serverAt: incoming.serverAt };
  if (!incoming.delta) return incoming;
  if (!previous) throw Error('Delta has no complete local snapshot');
  const merge = (old, rows, remove, identity = row => row.id) => {
    const map = new Map(old.filter(row => !remove(row)).map(row => [identity(row), row]));
    rows.forEach(row => map.set(identity(row), row));
    return [...map.values()];
  };
  const { replaceEventIds, replaceReportEventIds, replaceReportIds } = incoming.delta;
  const result = { ...previous, ...incoming,
    events: merge(previous.events || [], incoming.events || [], row => replaceEventIds.includes(row.id)),
    instances: merge(previous.instances || [], incoming.instances || [], row => replaceEventIds.includes(row.id), row => `${row.id}:${row._origDate || row.start}`),
    reports: merge(previous.reports || [], incoming.reports || [], row => replaceReportEventIds.includes(row.eventId) || replaceReportIds.includes(row.id)),
  };
  delete result.delta;
  if (incoming.sharedWidget?.replaceEventIds) {
    const shared = incoming.sharedWidget;
    if (!previous.sharedWidget) throw Error('Widget delta has no complete local snapshot');
    result.sharedWidget = { ...shared,
      events: [...previous.sharedWidget.events.filter(row => !shared.replaceEventIds.includes(row.id)), ...shared.events],
      calendars: merge(previous.sharedWidget.calendars, shared.calendars, () => false),
    };
    delete result.sharedWidget.replaceEventIds;
  }
  return result;
}
