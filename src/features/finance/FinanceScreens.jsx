import { useState, useMemo, useEffect } from "react";
import { X, Plus, Trash2, TrendingUp, TrendingDown } from "lucide-react";
import { fmt } from "../../lib/dateTime";
import { computeFinanceSummary, groupByMonth, filterByPeriod } from "../../lib/finance";
import { useC } from "../../context/AppContext";

const won = n => `${Number(n || 0).toLocaleString()}원`;

// ── 통합 수입·지출 관리 (MVP) ───────────────────────────────────────────
// 클라이언트 측 reduce로 집계(settlement.js와 동일 방식). 세금/부가세/일반관리비 계산은
// 기준이 아직 미확정이라 넣지 않음 — 단순 수입-지출 합계·월별 집계만 보여준다.
// Notion "Clean-Manager V2 통합 설계 문서"(5원장 통합설계)의 축소 1단계.
export function FinanceScreen() {
  const { transactions, setCurrentScreen, setFinanceModal, deleteTransaction } = useC();
  const thisYm = fmt(new Date()).slice(0, 7);
  const [selectedYm, setSelectedYm] = useState(thisYm);

  const months = useMemo(() => groupByMonth(transactions), [transactions]);
  const currentMonthItems = useMemo(
    () => filterByPeriod(transactions, `${selectedYm}-01`, `${selectedYm}-31`),
    [transactions, selectedYm]
  );
  const summary = useMemo(() => computeFinanceSummary(currentMonthItems), [currentMonthItems]);
  const sortedItems = useMemo(
    () => [...currentMonthItems].sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [currentMonthItems]
  );

  const monthOptions = useMemo(() => {
    const set = new Set([thisYm, ...months.map(m => m.ym)]);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [months, thisYm]);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">수입·지출 관리</h2>
          <button onClick={() => setCurrentScreen("calendar")} className="p-2 rounded-full hover:bg-gray-100">
            <X size={22} className="text-gray-500"/>
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">세금·부가세는 집계에서 제외됩니다 (기준 미확정)</p>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4">
        {/* 월 선택 */}
        <select value={selectedYm} onChange={e => setSelectedYm(e.target.value)}
          className="w-full py-3 px-4 rounded-xl bg-white border border-gray-200 text-sm font-bold outline-none focus:border-blue-500">
          {monthOptions.map(ym => <option key={ym} value={ym}>{ym.replace("-", "년 ")}월</option>)}
        </select>

        {/* 요약 카드 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl p-4" style={{border:"1.5px solid #f3f4f6", boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
            <div className="flex items-center gap-1 text-emerald-600 mb-1"><TrendingUp size={14}/><span className="text-xs font-bold">수입</span></div>
            <p className="text-sm font-extrabold text-gray-900 break-all">{won(summary.incomeSum)}</p>
          </div>
          <div className="bg-white rounded-2xl p-4" style={{border:"1.5px solid #f3f4f6", boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
            <div className="flex items-center gap-1 text-rose-600 mb-1"><TrendingDown size={14}/><span className="text-xs font-bold">지출</span></div>
            <p className="text-sm font-extrabold text-gray-900 break-all">{won(summary.expenseSum)}</p>
          </div>
          <div className="bg-white rounded-2xl p-4" style={{border:"1.5px solid #f3f4f6", boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
            <p className="text-xs font-bold text-gray-400 mb-1">순이익</p>
            <p className="text-sm font-extrabold break-all" style={{color: summary.net >= 0 ? "#111827" : "#e11d48"}}>{won(summary.net)}</p>
          </div>
        </div>

        {/* 내역 리스트 */}
        <div className="flex flex-col gap-2">
          {sortedItems.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-5xl mb-4">💰</div>
              <p className="text-sm font-bold">이 달 등록된 내역이 없어요</p>
            </div>
          ) : sortedItems.map(t => (
            <div key={t.id} className="bg-white rounded-2xl p-4 flex items-center gap-3"
              style={{border:"1.5px solid #f3f4f6"}}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{background: t.type === "income" ? "#ecfdf5" : "#fff1f2"}}>
                {t.type === "income" ? <TrendingUp size={16} className="text-emerald-600"/> : <TrendingDown size={16} className="text-rose-600"/>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{t.category || "미분류"}</p>
                <p className="text-xs text-gray-400">{t.date}{t.memo ? ` · ${t.memo}` : ""}</p>
              </div>
              <p className="text-sm font-extrabold shrink-0" style={{color: t.type === "income" ? "#059669" : "#e11d48"}}>
                {t.type === "income" ? "+" : "-"}{won(t.amount)}
              </p>
              <button onClick={() => { if (window.confirm("이 내역을 삭제할까요?")) deleteTransaction(t.id); }}
                className="p-1 text-gray-300 hover:text-red-500 shrink-0">
                <Trash2 size={16}/>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 등록 버튼 */}
      <button onClick={() => setFinanceModal({ open: true, editId: null })}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full text-white flex items-center justify-center shadow-xl"
        style={{background: "linear-gradient(135deg,#1a56db,#2563eb)"}}>
        <Plus size={26}/>
      </button>
    </div>
  );
}

// ── 수입·지출 등록 모달 ───────────────────────────────────────────────
export function FinanceFormModal() {
  const { financeModal, setFinanceModal, addTransaction } = useC();
  const [type, setType] = useState("income");
  const [date, setDate] = useState(fmt(new Date()));
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [memo, setMemo] = useState("");

  useEffect(() => {
    if (financeModal.open) { setType("income"); setDate(fmt(new Date())); setAmount(""); setCategory(""); setMemo(""); }
  }, [financeModal.open]);

  if (!financeModal.open) return null;
  const close = () => setFinanceModal({ open: false, editId: null });
  const amountValid = Number(amount) > 0;
  const canSubmit = amountValid && !!date && category.trim();
  const submit = () => {
    if (!canSubmit) return;
    addTransaction({ type, date, amount: Number(amount), category: category.trim(), memo: memo.trim() });
    close();
  };

  return (
    <div className="absolute inset-0 z-[80] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative bg-white rounded-t-3xl p-5 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">수입·지출 등록</h2>
          <button onClick={close} className="p-2 -mr-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
            <X size={22}/>
          </button>
        </div>

        <div className="flex gap-2">
          {[["income", "수입"], ["expense", "지출"]].map(([v, label]) => (
            <button key={v} onClick={() => setType(v)}
              className="flex-1 py-3 rounded-xl text-sm font-bold transition-colors"
              style={{
                background: type === v ? (v === "income" ? "#ecfdf5" : "#fff1f2") : "#f3f4f6",
                color: type === v ? (v === "income" ? "#059669" : "#e11d48") : "#9ca3af",
                border: type === v ? `1.5px solid ${v === "income" ? "#a7f3d0" : "#fecdd3"}` : "1.5px solid transparent",
              }}>
              {label}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">날짜</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">금액</label>
          <input type="number" inputMode="numeric" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="예: 500000"
            className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">항목</label>
          <input value={category} onChange={e => setCategory(e.target.value)}
            placeholder="예: 입주청소 매출, 세제 구입 등"
            className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">메모 (선택)</label>
          <input value={memo} onChange={e => setMemo(e.target.value)}
            className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
        </div>

        <button onClick={submit} disabled={!canSubmit}
          className="w-full py-3 rounded-xl text-sm font-bold text-white mt-1 disabled:opacity-40"
          style={{background: "linear-gradient(135deg,#1a56db,#2563eb)"}}>
          등록
        </button>
      </div>
    </div>
  );
}
