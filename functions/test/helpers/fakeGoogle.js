// 테스트용 가짜 Google Calendar — 이벤트 저장소 + syncToken 발급/만료 + watch/stop 기록.
import { GoogleApiError } from "../../lib/gcal/googleApi.js";

export function createFakeGoogle() {
  let version = 0;
  const events = new Map(); // id → { ev, ver }
  const tokens = new Map(); // syncToken → version
  const g = {
    calls: { list: 0, watch: [], stop: [], refresh: 0 },
    expireTokens: false,
    failRefresh: null, // "invalid_grant" 등
    failList: null,    // { status }
    pageSize: 2,

    // 테스트 조작용
    upsert(ev) { version++; events.set(ev.id, { ev: { status: "confirmed", updated: new Date(1700000000000 + version * 1000).toISOString(), ...ev }, ver: version }); },
    cancel(id) {
      version++;
      const cur = events.get(id);
      events.set(id, { ev: { ...(cur?.ev || { id }), id, status: "cancelled", updated: new Date(1700000000000 + version * 1000).toISOString() }, ver: version });
    },

    async refreshAccessToken() {
      g.calls.refresh++;
      if (g.failRefresh) throw new GoogleApiError("refresh 실패", { status: 400, reason: g.failRefresh });
      return { access_token: `at-${g.calls.refresh}`, expires_in: 3600 };
    },
    async exchangeCode({ code }) {
      if (code !== "good-code") throw new GoogleApiError("bad code", { status: 400, reason: "invalid_grant" });
      return { access_token: "at-x", refresh_token: "rt-secret-value", expires_in: 3600, scope: "calendar.events.readonly" };
    },
    async listEvents(_at, calendarId, { syncToken, pageToken, maxResults } = {}) {
      g.calls.list++;
      if (g.failList) throw new GoogleApiError("list 실패", g.failList);
      if (syncToken && (g.expireTokens || !tokens.has(syncToken))) throw new GoogleApiError("Sync token is no longer valid", { status: 410, reason: "fullSyncRequired" });
      const since = syncToken ? tokens.get(syncToken) : 0;
      const all = [...events.values()]
        .filter((x) => x.ver > since)
        .filter((x) => syncToken || x.ev.status !== "cancelled") // 전체 동기화엔 삭제된 일정이 안 나옴
        .map((x) => x.ev);
      const size = maxResults && maxResults < g.pageSize ? maxResults : g.pageSize;
      const start = pageToken ? Number(pageToken) : 0;
      const items = all.slice(start, start + size);
      const more = start + size < all.length;
      const res = { items, calendarId };
      if (more) res.nextPageToken = String(start + size);
      else { const t = `st-${version}-${Math.random().toString(36).slice(2)}`; tokens.set(t, version); res.nextSyncToken = t; }
      return res;
    },
    async watchEvents(_at, calendarId, ch) {
      g.calls.watch.push({ calendarId, ...ch });
      return { kind: "api#channel", id: ch.id, resourceId: `res-${calendarId}`, expiration: String(Date.now() + ch.ttlSeconds * 1000) };
    },
    async stopChannel(_at, ch) { g.calls.stop.push(ch); return null; },
  };
  return g;
}
