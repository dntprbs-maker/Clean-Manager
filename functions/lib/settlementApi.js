import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyLiveAppSession } from './appAuth.js';
import { isAdminStaff } from './membership.js';
import { computeSettlement } from './settlement.js';

export const settlementBreakdown = calc => Object.fromEntries(['workDays','dailySum','weeklySum','monthlySum','allowanceSum','extraSum','refTotal'].map(k=>[k,calc[k]]));
export async function confirmSettlementTransaction(db, companyId, input) {
  const { employeeId, yearMonth, finalAmount, breakdown, expectedConfirmedAt } = input || {};
  if (typeof employeeId !== 'string' || !employeeId || employeeId.includes('/') || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth) || typeof finalAmount !== 'number' || !Number.isFinite(finalAmount)) throw new HttpsError('invalid-argument','확정할 직원·월·금액을 확인해주세요.');
  const root = db.doc(`companies/${companyId}`);
  const ref = root.collection("monthlySettlements").doc(`${employeeId}_${yearMonth}`);
  return db.runTransaction(async tx => {
    const employee = await tx.get(root.collection("users").doc(employeeId));
    const existing = await tx.get(ref);
    if (!employee.exists) throw new HttpsError('not-found','직원 정보를 확인해주세요.');
    if ((existing.data()?.confirmedAt || null) !== (expectedConfirmedAt || null)) throw new HttpsError('failed-precondition','다른 사람이 정산을 확정했습니다. 새로 확인해주세요.');
    const queries = ['assignments','attendance','extraPayments'].map(c=>root.collection(c).where('employeeId','==',employeeId));
    const [assignments,attendance,extraPayments] = await Promise.all(queries.map(q=>tx.get(q)));
    const rows = snap=>snap.docs.map(d=>({...d.data(),id:d.id}));
    const calc = computeSettlement({ employee:{...employee.data(),id:employeeId},ym:yearMonth,assignments:rows(assignments),attendance:rows(attendance),extraPayments:rows(extraPayments),allowance:employee.data().dailyAllowance });
    const actual = settlementBreakdown(calc);
    if (!breakdown || Object.keys(actual).some(k=>actual[k]!==breakdown[k])) throw new HttpsError('failed-precondition','출근·배정·보조금 또는 추가지급이 변경됐습니다. 최신 계산을 확인한 뒤 다시 확정해주세요.');
    const value = {employeeId,yearMonth,finalAmount,breakdown:actual,confirmedAt:new Date().toISOString()};
    tx.set(ref,value,{merge:true});
    return {ok:true,settlement:value};
  });
}
export const confirmMonthlySettlement = onCall({region:'asia-northeast3'},async request=>{
  const principal=await verifyLiveAppSession(request);
  if(principal.kind!=='admin' && !isAdminStaff(principal.user)) throw new HttpsError('permission-denied','정산 확정 권한이 없습니다.');
  return confirmSettlementTransaction(getFirestore(),principal.user.companyId,request.data);
});
