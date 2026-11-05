import { authHost, firestoreHost, functionsOrigin } from './emulatorConfig.mjs';
// Explicit local emulator-only regression. Never accepts a production project.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const project = 'demo-clean-manager';
const firestore = `http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents`;
async function login(identifier) {
  const authCall = await fetch(`${functionsOrigin}/${project}/asia-northeast3/appAuth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { identifier, password: 'qa-local-only' } }),
  });
  const body = await authCall.json();
  assert.equal(authCall.status, 200, 'local auth function must succeed');
  const exchange = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=local-emulator-only`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: body.result.token, returnSecureToken: true }),
  });
  const session = await exchange.json();
  assert.equal(exchange.status, 200, 'local custom token exchange must succeed');
  return session.idToken;
}
async function operation(token, path, { method = 'GET', fields, mask } = {}) {
  const response = await fetch(`${firestore}/${path}${mask ? '?updateMask.fieldPaths=' + mask : ''}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(fields ? { body: JSON.stringify({ fields }) } : {}),
  });
  const detail = await response.text();
  if (response.status >= 500) console.error('Local emulator error:', detail.slice(0, 500));
  return response.status;
}
const staff = await login('01000001234');
const owner = await login('qaowner');
const company = 'companies/qa_pagination';
assert.equal(await operation(staff, `${company}/cals/qa_rule_personal`, { method: 'PATCH', fields: {
  personal: { booleanValue: true }, ownerId: { stringValue: 'qa_staff' }, label: { stringValue: '본인 테스트' }, checked: { booleanValue: true },
} }), 200, 'staff can create own personal calendar without expression overflow');
assert.equal(await operation(staff, `${company}/cals/qa_rule_personal`, { method: 'PATCH', mask: 'checked', fields: { checked: { booleanValue: false } } }), 200, 'staff can toggle checked state');
assert.equal(await operation(staff, `${company}/cals/qa_rule_foreign`, { method: 'PATCH', fields: { personal: { booleanValue: true }, ownerId: { stringValue: 'qa_other' } } }), 403, 'staff cannot create another person personal calendar');
assert.equal(await operation(staff, `${company}/cals/qa_rule_shared`, { method: 'PATCH', fields: { label: { stringValue: '공유 생성 금지' } } }), 403, 'ordinary staff cannot create shared calendar');
assert.equal(await operation(owner, `${company}/cals/qa_rule_owner_shared`, { method: 'PATCH', fields: { label: { stringValue: '관리자 공유 생성' } } }), 200, 'owner can create shared calendar');
assert.equal(await operation(staff, `${company}/events/event_000`), 403, 'staff raw event read remains denied');
assert.equal(await operation(staff, `${company}/profiles/qa_other`), 200, 'staff may read sanitized directory');
assert.equal(await operation(staff, 'companies/another_company/cals/x'), 403, 'cross-company read denied');
const ownAttendance = {
  date: { stringValue: '2026-11-05' }, employeeId: { stringValue: 'qa_staff' },
  siteId: { stringValue: 'qa_rule_site' }, confirmed: { booleanValue: true }, confirmedBy: { stringValue: '검증 직원' },
};
assert.equal(await operation(staff, `${company}/attendance/2026-11-05_qa_staff_qa_rule_site`, { method: 'PATCH', fields: ownAttendance }), 200, 'staff can confirm own attendance');
assert.equal(await operation(staff, `${company}/attendance/2026-11-05_qa_other_qa_rule_site`, { method: 'PATCH', fields: { ...ownAttendance, employeeId: { stringValue: 'qa_other' } } }), 403, 'staff cannot confirm another employee attendance');
assert.equal(await operation(staff, `${company}/attendance/2026-11-05_qa_staff_qa_rule_site`, { method: 'PATCH', mask: 'confirmed', fields: { confirmed: { booleanValue: false } } }), 200, 'staff can update own attendance');
assert.equal(await operation(staff, `${company}/attendance/2026-11-05_qa_staff_qa_rule_site`, { method: 'PATCH', mask: 'confirmed', fields: { confirmed: { stringValue: 'true' } } }), 403, 'attendance confirmed must remain boolean');
assert.equal(await operation(owner, `${company}/monthlySettlements/qa_staff_2026-11`, { method: 'PATCH', fields: { employeeId: { stringValue: 'qa_staff' }, yearMonth: { stringValue: '2026-11' }, finalAmount: { integerValue: '1' } } }), 403, 'even master cannot bypass server settlement confirmation');
// Additional fictional accounts live only in this fixed demo emulator project.


const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore(initializeApp({ projectId: project }, 'rules-regression'));
for (const [id, phone, team] of [['qa_manager', '01000002345', '관리팀'], ['qa_sales', '01000002346', '영업팀']]) {
  const data = { name: '권한 회귀용 가상직원', phone, team, role: '팀원', memberships: [{ team, role: '팀원' }], pw: 'qa-local-only', companyId: 'qa_pagination' };
  await db.doc(`staffs/${id}`).set(data);
  await db.doc(`${company}/users/${id}`).set(data);
}
await db.doc('companies/qa_foreign').set({ name: '다른 회사 회귀' });
await db.doc('staffs/qa_foreign').set({ name: '다른회사 직원', companyId: 'qa_foreign', pw: 'qa-local-only' });
const management = await login('01000002345');
const sales = await login('01000002346');
const field = value => typeof value === 'string' ? { stringValue: value } : typeof value === 'number' ? { integerValue: String(value) }
  : typeof value === 'boolean' ? { booleanValue: value } : Array.isArray(value) ? { arrayValue: { values: value.map(field) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, field(v)])) } };
const fields = value => Object.fromEntries(Object.entries(value).map(([k, v]) => [k, field(v)]));
const managedId = 'qa_managed_' + Date.now();
const managed = { name: '관리팀 CRUD 검증', phone: '01000003456', role: '팀원', memberships: [{ team: '입주청소팀', role: '팀원' }], pw: '', companyId: 'qa_pagination' };
assert.equal(await operation(management, `${company}/users/${managedId}`, { method: 'PATCH', fields: fields(managed) }), 200, 'management can create company employee profile');
assert.equal(await operation(management, `staffs/${managedId}`, { method: 'PATCH', fields: fields(managed) }), 200, 'management can create matching private employee account');
assert.equal(await operation(management, `${company}/users/${managedId}`), 200, 'management can read employee edit source');
assert.equal(await operation(management, `staffs/${managedId}`), 200, 'management can read own-company private employee account');
assert.equal(await operation(management, `${company}/users/${managedId}`, { method: 'PATCH', mask: 'order', fields: fields({ order: 4 }) }), 200, 'management can update employee order');
assert.equal(await operation(management, `staffs/${managedId}`, { method: 'PATCH', mask: 'memberships', fields: fields({ memberships: [{ team: '입주청소팀', role: '팀장' }, { team: '정기청소', role: '팀원' }] }) }), 200, 'management can update multiple team memberships');
const reset = await fetch(`${functionsOrigin}/${project}/asia-northeast3/appAccount`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${management}` }, body: JSON.stringify({ data: { action: 'setEmployeePassword', employeeId: managedId, newPassword: 'qa-reset-only' } }) });
await reset.text();
assert.equal(reset.status, 200, 'management can set employee password through server');
assert.equal(await operation(management, 'staffs/qa_foreign'), 403, 'management cannot read another company employee');
assert.equal(await operation(management, 'staffs/qa_foreign', { method: 'PATCH', mask: 'name', fields: fields({ name: '금지' }) }), 403, 'management cannot modify another company employee');
assert.equal(await operation(management, `${company}/users/qa_manager`, { method: 'PATCH', mask: 'role', fields: fields({ role: '최고관리자' }) }), 403, 'management cannot forge highest administrator role');
assert.equal(await operation(sales, `${company}/users/qa_sales_created`, { method: 'PATCH', fields: fields(managed) }), 403, 'sales membership alone does not grant employee management');
assert.equal(await operation(management, `${company}/cals/qa_manager_shared`, { method: 'PATCH', fields: fields({ label: '관리팀 공유', checked: true }) }), 200, 'management can create shared calendar');
assert.equal(await operation(management, `${company}/cals/qa_manager_shared`, { method: 'PATCH', mask: 'label', fields: fields({ label: '관리팀 공유 수정' }) }), 200, 'management can edit shared calendar');
assert.equal(await operation(management, `${company}/cals/private`, { method: 'PATCH', mask: 'ownerId', fields: fields({ ownerId: 'qa_manager' }) }), 403, 'management cannot take ownership of another personal calendar');
assert.equal(await operation(management, `${company}/cals/private`, { method: 'PATCH', mask: 'personal', fields: fields({ personal: false }) }), 403, 'management cannot convert another personal calendar to shared');
assert.equal(await operation(management, `${company}/cals/private`, { method: 'PATCH', mask: 'label', fields: fields({ label: '금지된 수정' }) }), 403, 'management cannot modify another personal calendar content');
assert.equal(await operation(management, `${company}/cals/private`, { method: 'DELETE' }), 403, 'management cannot delete another personal calendar');
assert.equal(await operation(management, `${company}/users/${managedId}`, { method: 'PATCH', mask: 'status', fields: fields({ status: 'deleted' }) }), 200, 'management retains existing soft-delete employee action');
assert.equal(await operation(staff, `${company}/cals/private`), 403, 'staff cannot read raw calendar bearer credentials');
assert.equal(await operation(management, `${company}/cals/private`), 403, 'management must also use calendar projection');
await db.doc(`${company}/cals/team1`).set({ feedToken: 'qa-team-feed', icsSubscriptionUrl: 'qa-team-external', arbitrarySecret: 'qa-omit' }, { merge: true });
await db.doc(`${company}/cals/private`).set({ feedToken: 'qa-other-private-feed', icsSubscriptionUrl: 'qa-other-external' }, { merge: true });
await db.doc(`${company}/cals/regular_cleaning`).set({ feedToken: 'qa-regular-feed' }, { merge: true });
const projection = await fetch(`${functionsOrigin}/${project}/asia-northeast3/appReadData`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staff}` }, body: JSON.stringify({ data: { from: '2026-11-05', to: '2026-11-05' } }) });
const projected = await projection.json();
assert.equal(projection.status, 200, 'authenticated calendar projection succeeds');
assert.equal(projected.result.cals.some(c => c.id === 'private'), false, 'other personal calendar omitted from projection');
assert.equal(projected.result.cals.find(c => c.id === 'team1').feedToken, 'qa-team-feed', 'staff own team subscription remains available');
assert.equal(projected.result.cals.find(c => c.id === 'team1').icsSubscriptionUrl, undefined, 'ordinary staff cannot read upstream subscription URL');
assert.equal(projected.result.cals.find(c => c.id === 'team1').arbitrarySecret, undefined, 'unlisted calendar fields are never mirrored');
assert.equal(projected.result.cals.find(c => c.id === 'regular_cleaning').feedToken, undefined, 'own assignment does not grant whole regular calendar bearer feed');
await db.terminate();
console.log('Emulator auth Rules: 39 checks passed; no token printed.');
