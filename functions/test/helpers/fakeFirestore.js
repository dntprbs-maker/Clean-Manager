// 테스트용 아주 작은 메모리 Firestore — 이 기능이 쓰는 API만 흉내 낸다.
// (collection/doc/get/set(merge)/update/delete/where(==,<)/runTransaction/batch)
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function createFakeDb() {
  const store = new Map(); // fullPath → data
  let failNextBatch = 0;

  const docRef = (path) => ({
    id: path.split("/").pop(),
    path,
    async get() { return snap(path); },
    async set(data, opts) { write(path, data, opts?.merge); },
    async update(data) {
      if (!store.has(path)) throw new Error(`NOT_FOUND: ${path}`);
      write(path, data, true);
    },
    async delete() { store.delete(path); },
  });
  const snap = (path) => {
    const data = store.get(path);
    return { id: path.split("/").pop(), exists: data !== undefined, data: () => clone(data), ref: docRef(path) };
  };
  const write = (path, data, merge) => {
    const prev = merge ? store.get(path) || {} : {};
    store.set(path, { ...clone(prev), ...clone(data) });
  };

  const query = (colPath, filters = []) => ({
    where(field, op, value) { return query(colPath, [...filters, { field, op, value }]); },
    async get() {
      const docs = [];
      for (const [p, d] of store) {
        const parent = p.slice(0, p.lastIndexOf("/"));
        if (parent !== colPath) continue;
        const ok = filters.every(({ field, op, value }) => {
          const v = field.split(".").reduce((o, k) => o?.[k], d);
          if (op === "==") return v === value;
          if (op === "<") return v !== undefined && v < value;
          throw new Error(`unsupported op ${op}`);
        });
        if (ok) docs.push(snap(p));
      }
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });

  const db = {
    _store: store,
    failNextBatchCommit(n = 1) { failNextBatch = n; },
    collection(path) {
      return { ...query(path), doc: (id) => docRef(`${path}/${id}`) };
    },
    doc: (path) => docRef(path),
    async runTransaction(fn) {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => write(ref.path, data, opts?.merge),
        delete: (ref) => store.delete(ref.path),
      };
      return fn(tx);
    },
    batch() {
      const ops = [];
      return {
        set: (ref, data, opts) => ops.push(() => write(ref.path, data, opts?.merge)),
        async commit() {
          if (failNextBatch > 0) { failNextBatch--; throw new Error("batch commit failed (테스트용)"); }
          ops.forEach((op) => op());
        },
      };
    },
  };
  return db;
}
