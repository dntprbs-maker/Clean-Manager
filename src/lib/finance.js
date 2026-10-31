// ── 통합 수입·지출 집계 — 순수 함수 (MVP) ─────────────────────────
// 세금/부가세/일반관리비 계산 기준은 아직 미확정이라 이 집계에는 포함하지 않음.
// 단순 수입-지출 합계 · 기간별(월별) 집계만 제공. settlement.js의 reduce 패턴과 동일한 방식.
// 데이터가 늘어나면 추후 Cloud Function 집계로 전환 검토 (Notion "통합 수입·지출 관리 기능 설계" 참고).

export function filterByPeriod(transactions, from, to) {
  return transactions.filter(t => (!from || t.date >= from) && (!to || t.date <= to));
}

export function computeFinanceSummary(transactions) {
  const income  = transactions.filter(t => t.type === "income");
  const expense = transactions.filter(t => t.type === "expense");
  const incomeSum  = income.reduce((s, t) => s + Number(t.amount || 0), 0);
  const expenseSum = expense.reduce((s, t) => s + Number(t.amount || 0), 0);
  return {
    incomeSum, expenseSum, net: incomeSum - expenseSum,
    incomeCount: income.length, expenseCount: expense.length,
  };
}

// 월별(YYYY-MM) 그룹핑 — 최신 달이 먼저 오도록 정렬
export function groupByMonth(transactions) {
  const map = new Map();
  for (const t of transactions) {
    const ym = (t.date || "").slice(0, 7);
    if (!map.has(ym)) map.set(ym, []);
    map.get(ym).push(t);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ym, items]) => ({ ym, items, ...computeFinanceSummary(items) }));
}

// 카테고리별 집계 (수입/지출 각각) — 금액 큰 순
export function groupByCategory(transactions) {
  const map = new Map();
  for (const t of transactions) {
    const key = `${t.type}__${t.category || "미분류"}`;
    if (!map.has(key)) map.set(key, { type: t.type, category: t.category || "미분류", sum: 0, count: 0 });
    const g = map.get(key);
    g.sum += Number(t.amount || 0);
    g.count += 1;
  }
  return [...map.values()].sort((a, b) => b.sum - a.sum);
}
