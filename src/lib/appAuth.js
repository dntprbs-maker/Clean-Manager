import { signInWithCustomToken, signOut, onIdTokenChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { auth, functions } from '../firebase';

const request = httpsCallable(functions, 'appAuth');
const WidgetSession = registerPlugin('WidgetSession');
const store = user => { localStorage.setItem('loginUser', JSON.stringify(user)); return user; };
// Sharing is optional: a missing native callback must never block the calendar.
export async function optionalWidgetOperation(operation, milliseconds = 2500) {
  let timer;
  try { return await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),milliseconds);})]); }
  catch { return null; }
  finally { clearTimeout(timer); }
}
export async function supportsWidgetSharing() {
  if (!Capacitor.isNativePlatform()) return false;
  try { return (await optionalWidgetOperation(WidgetSession.capabilities()))?.supported === true; }
  catch { return false; }
}
export async function beginWidgetRead(companyId, knownRevision) {
  if (!Capacitor.isNativePlatform() || !auth.currentUser) return null;
  try {
    const lease = await optionalWidgetOperation(WidgetSession.beginSharedRead({ companyId, userId: auth.currentUser.uid,
      ...(Number.isSafeInteger(knownRevision)&&knownRevision>=0?{knownRevision}:{}) }));
    return lease?.ticket && lease.from && lease.to ? lease : null;
  } catch { return null; }
}
export async function commitWidgetRead(lease, snapshot) {
  if (!lease?.ticket || !snapshot) return false;
  try { return (await optionalWidgetOperation(WidgetSession.commitSharedRead({ ticket: lease.ticket, snapshot }),5000))?.accepted === true; }
  catch { return false; }
}
export async function cancelWidgetRead(lease) {
  if (!lease?.ticket) return;
  try { await optionalWidgetOperation(WidgetSession.cancelSharedRead({ ticket: lease.ticket })); }
  catch { /* Native expiry retains the independent widget fallback. */ }
}
export async function authenticate(input) {
  const { data } = await request(input);
  if (data.token) {
    await signInWithCustomToken(auth, data.token);
    store(data.user);
    await syncWidgetSession(data.user);
  }
  return data;
}
export async function restoreSession() {
  await auth.authStateReady();
  if (!auth.currentUser) { localStorage.removeItem('loginUser'); return null; }
  const { data } = await request({ action: 'restore' });
  store(data.user);
  await syncWidgetSession(data.user);
  return data;
}
export async function syncWidgetSession(user) {
  if (!Capacitor.isNativePlatform() || !auth.currentUser || !user) return;
  try {
    await WidgetSession.setSession({ idToken: await auth.currentUser.getIdToken(), refreshToken: auth.currentUser.refreshToken, companyId: user.companyId, userId: auth.currentUser.uid });
  } catch {
    console.warn('[WidgetSession] 위젯 인증을 위해 최신 앱 업데이트가 필요합니다.');
  }
}
export function watchWidgetSession() {
  return onIdTokenChanged(auth, async current => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      if (!current) await WidgetSession.clearSession();
      else {
        const claims = (await current.getIdTokenResult()).claims;
        await syncWidgetSession({ companyId: claims.cmCompany, uid: claims.cmid });
      }
    } catch { /* Old APKs without plugin cannot block web authentication. */ }
  });
}
export async function endSession() {
  localStorage.removeItem('loginUser');
  if (Capacitor.isNativePlatform()) {
    try { await WidgetSession.clearSession(); } catch { /* legacy APK */ }
  }
  await signOut(auth);
}

// Only successful business writes invalidate the native cache; opening/closing
// the app and refreshing the same authentication token must not force DB reads.
export async function invalidateWidgetData() {
  if (!Capacitor.isNativePlatform() || !auth.currentUser) return;
  try { await optionalWidgetOperation(WidgetSession.invalidateData()); }
  catch { /* Legacy APKs continue to rely on push/manual refresh. */ }
}
