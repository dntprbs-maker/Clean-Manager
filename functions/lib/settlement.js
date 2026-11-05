// ── 정기청소 월별 급여(정산) 계산 — 순수 함수 ─────────────────────────
// SettlementCard(관리자 월별 정산)와 "내 급여" 명세가 같은 규칙을 쓰도록 분리.
//
// 급여 규칙 (2026-07-14 사용자 확정):
// - 일급: 확정된 출근확인 1일마다 해당 배정의 wageAmount 합산 (레거시 dailyWage 호환,
//         wageType 없는 레거시 배정은 일급 취급)
// - 주급: 그 현장에 출근확인이 있는 "주(일~토)" 수 × 주급 (한 주에 몇 번 갔든 1회)
// - 월급: 그 달에 그 현장 출근확인이 1일이라도 있으면 전액, 없으면 0
//         (중도 합류/퇴사 등 예외는 관리자가 최종금액에서 직접 조정)

const isDaily = a => (a.wageType || "daily") === "daily";
const amountOf = a => Number(a.wageAmount ?? a.dailyWage ?? 0);

// YYYY-MM-DD → 그 날짜가 속한 주의 일요일 날짜 문자열 (주 단위 그룹핑 키)
function weekKey(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - dt.getDay());
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function computeSettlement({ employee, ym, assignments, attendance, extraPayments, allowance }) {
  const myAssignments = assignments.filter(a => a.employeeId === employee.id);
  const monthAtt = attendance.filter(a => a.employeeId === employee.id && a.confirmed && (a.date || "").startsWith(ym));
  const workDays = new Set(monthAtt.map(a => a.date)).size;

  // 일급 — 출근일마다 매칭 배정의 금액 합산 (기존 SettlementCard 로직 그대로)
  const dailySum = monthAtt.reduce((sum, att) => {
    const asg = myAssignments.find(x => x.siteId === att.siteId);
    if (!asg || !isDaily(asg)) return sum;
    return sum + amountOf(asg);
  }, 0);

  // 주급 — 그 현장에 출근확인이 있는 고유 주(일~토) 수 × 주급
  const weeklyLines = myAssignments
    .filter(a => a.wageType === "weekly")
    .map(a => {
      const weeks = new Set(monthAtt.filter(att => att.siteId === a.siteId).map(att => weekKey(att.date))).size;
      return { siteId: a.siteId, wageAmount: amountOf(a), weeks, sum: weeks * amountOf(a) };
    });
  const weeklySum = weeklyLines.reduce((s, l) => s + l.sum, 0);

  // 월급 — 그 달에 그 현장 출근이 1일이라도 있으면 전액
  const monthlyLines = myAssignments
    .filter(a => a.wageType === "monthly")
    .map(a => {
      const counted = monthAtt.some(att => att.siteId === a.siteId);
      return { siteId: a.siteId, wageAmount: amountOf(a), counted, sum: counted ? amountOf(a) : 0 };
    });
  const monthlySum = monthlyLines.reduce((s, l) => s + l.sum, 0);

  const myExtras = extraPayments.filter(p => p.employeeId === employee.id && (p.date || "").startsWith(ym));
  const extraSum = myExtras.reduce((s, p) => s + Number(p.amount || 0), 0);
  const allowanceSum = (Number(allowance) || 0) * workDays;
  const refTotal = dailySum + weeklySum + monthlySum + allowanceSum + extraSum;

  return { workDays, dailySum, weeklySum, monthlySum, weeklyLines, monthlyLines, myExtras, extraSum, allowanceSum, refTotal };
}
