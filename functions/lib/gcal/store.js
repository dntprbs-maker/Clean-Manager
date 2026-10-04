// gcal 서버 전용 문서 읽기/쓰기 + access token 관리.
import { COL, calKey } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { GoogleApiError } from "./googleApi.js";

export async function isGlobalPushEnabled(db) {
  const snap = await db.collection(COL.config).doc("global").get();
  return snap.exists && snap.data()?.pushEnabled === true;
}

// 이 팀 캘린더가 지금 push 경로로 관리되는지 — 기존 ICS 자동 동기화가 이 값을 보고 건너뛴다.
// 읽기에 실패하면(권한·네트워크) false → 기존 ICS 경로가 그대로 동작(안전한 쪽).
export async function isPushActive(db, companyId, calId) {
  try {
    if (!(await isGlobalPushEnabled(db))) return false;
    const snap = await db.collection(COL.calendars).doc(calKey(companyId, calId)).get();
    return snap.exists && snap.data()?.enabled === true;
  } catch (e) {
    console.warn("[gcal] isPushActive 확인 실패 — ICS 경로 유지:", e?.message || e);
    return false;
  }
}

export const calRef = (db, key) => db.collection(COL.calendars).doc(key);

// 앱 화면에 보여줄 상태를 팀 캘린더 문서(companies/{c}/cals/{calId})에도 복사해 둔다.
// 이 값은 표시용일 뿐이고(클라이언트가 cal 문서를 통째로 덮어쓸 수 있음) 실제 기준은 gcalCalendars.
export async function mirrorStatus(db, state) {
  if (!state?.companyId || !state?.calId) return;
  const s = {
    enabled: state.enabled === true,
    lastSyncAt: state.lastSyncAt || null,
    lastSuccessAt: state.lastSuccessAt || null,
    lastError: state.lastError || null,
    lastErrorAt: state.lastErrorAt || null,
    needsReauth: state.needsReauth === true,
    channelExpiresAt: state.channelExpiresAt || null,
  };
  await db.doc(`companies/${state.companyId}/cals/${state.calId}`).update({ gcalPushStatus: s })
    .catch((e) => console.warn(`[gcal] 상태 표시 복사 실패 ${state.companyId}/${state.calId}:`, e?.message || e));
}

// 상태 문서 갱신 + 표시용 복사
export async function patchState(db, key, patch) {
  const ref = calRef(db, key);
  await ref.set(patch, { merge: true });
  const snap = await ref.get();
  await mirrorStatus(db, snap.data());
  return snap.data();
}

// ── access token: 메모리 캐시 + refresh token으로 갱신 ─────────────────────
const tokenCache = new Map(); // key → { token, exp }
export const _clearTokenCache = () => tokenCache.clear();
export const forgetAccessToken = (key) => tokenCache.delete(key);

export async function getAccessToken({ db, google, tokenKey, key, now = Date.now }) {
  const cached = tokenCache.get(key);
  if (cached && cached.exp - 60_000 > now()) return cached.token;

  const credRef = db.collection(COL.credentials).doc(key);
  const credSnap = await credRef.get();
  if (!credSnap.exists || !credSnap.data()?.refreshToken) {
    throw new GoogleApiError("구글 계정이 연결되어 있지 않습니다(관리 페이지에서 연결 필요).", { reason: "not_connected" });
  }
  const refreshToken = decryptSecret(credSnap.data().refreshToken, tokenKey);
  let res;
  try {
    res = await google.refreshAccessToken(refreshToken);
  } catch (e) {
    if (e?.reason === "invalid_grant") {
      // 사용자가 권한을 해제했거나, OAuth 앱이 '테스트' 상태라 7일 만에 만료된 경우 — 재연결 필요
      await calRef(db, key).set({ needsReauth: true }, { merge: true });
    }
    throw e;
  }
  if (res.refresh_token) {
    await credRef.set({ refreshToken: encryptSecret(res.refresh_token, tokenKey), rotatedAt: new Date(now()).toISOString() }, { merge: true });
  }
  tokenCache.set(key, { token: res.access_token, exp: now() + (Number(res.expires_in) || 3600) * 1000 });
  return res.access_token;
}
