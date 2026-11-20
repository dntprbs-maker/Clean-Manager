import { AsyncLocalStorage } from 'node:async_hooks';

const active = new AsyncLocalStorage();
const proxies = new WeakMap();
const originals = new WeakMap();
const unwrap = value => originals.get(value) || value;

// Only identity obtained from the server's successful account verification is trusted.
export function identifyReadUsage(principal) {
  const context = active.getStore();
  if (!context || !principal?.user?.uid) return;
  context.accountId = principal.user.uid;
  context.companyId = principal.user.companyId || null;
  context.accountKind = principal.kind || null;
}

function countSnapshot(snapshot) {
  const context = active.getStore();
  if (!context) return;
  context.readCalls++;
  if (Array.isArray(snapshot)) {
    context.documentReads += snapshot.length;
  } else if (Array.isArray(snapshot?.docs)) {
    context.documentReads += Math.max(1, snapshot.docs.length);
  } else if (typeof snapshot?.exists === 'boolean') {
    context.documentReads++;
  } else {
    context.unmeasuredReadCalls++;
  }
}

// Preserve native SDK receivers and reference arguments. No prototype/global patching.
export function trackedFirestore(target) {
  if (!target || typeof target !== 'object') return target;
  if (originals.has(target)) return target;
  if (proxies.has(target)) return proxies.get(target);
  const proxy = new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const rawArgs = args.map(unwrap);
        if (property === 'runTransaction') {
          const callback = rawArgs[0];
          rawArgs[0] = transaction => callback(trackedFirestore(transaction));
        }
        const result = value.apply(object, rawArgs);
        if (property === 'get' || property === 'getAll') {
          return Promise.resolve(result).then(snapshot => { countSnapshot(snapshot); return snapshot; });
        }
        // Fluent SDK query/reference/transaction objects only; snapshots remain native.
        if (['collection','collectionGroup','doc','where','orderBy','limit','limitToLast',
          'offset','select','startAt','startAfter','endAt','endBefore','withConverter',
          'set','update','delete','create'].includes(property) && result && typeof result === 'object'
          && typeof result.then !== 'function') return trackedFirestore(result);
        return result;
      };
    },
  });
  proxies.set(target, proxy);
  originals.set(proxy, target);
  return proxy;
}

export function withReadUsage(source, handler, emit = row => console.info(JSON.stringify(row))) {
  return async function (...args) {
    const start = new Date();
    const context = { accountId: null, companyId: null, accountKind: null,
      documentReads: 0, readCalls: 0, unmeasuredReadCalls: 0 };
    return active.run(context, async () => {
      let status = 'ok';
      try {
        const result = await handler(...args);
        const response = args[1];
        if (response?.statusCode >= 400) status = 'error';
        return result;
      } catch (error) {
        status = 'error';
        throw error;
      } finally {
        // Log failures must never break the business operation. No tokens, bodies or document paths.
        try { emit({ event: 'clean_manager_read_usage', schemaVersion: 1, source,
          startedAt: start.toISOString(), endedAt: new Date().toISOString(),
          ...context, status, measurement: 'observed_document_reads_not_billing_total' }); } catch {}
      }
    });
  };
}
