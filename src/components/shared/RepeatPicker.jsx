import { useState, useRef, useEffect } from "react";
import { RotateCcw, ChevronRight } from "lucide-react";
import { pd, WD } from "../../lib/dateTime";
import { REPEAT_OPTS, REPEAT_ORD_OPTS } from "../../lib/repeat";

// ── 드럼롤(휠) 피커 — 날짜/시간/반복종료일 등에서 공용으로 씀 ──────
export function WheelPicker({ items, value, onChange, renderItem, loop=false }) {
  const ITEM_H = 44;
  const L = items.length;
  const REPEAT = loop ? 9 : 1;          // 순환용 복제 횟수 (홀수)
  const CENTER = Math.floor(REPEAT / 2); // 가운데 블록 인덱스
  const centerOffset = loop ? CENTER * L : 0;
  const ref = useRef(null);
  const timer = useRef(null);
  const scrolling = useRef(false);
  const dragY = useRef(null);
  const display = renderItem || (v => String(v));

  // 순환 모드면 items를 REPEAT번 복제
  const rendered = loop
    ? Array.from({ length: REPEAT * L }, (_, i) => items[i % L])
    : items;

  const idxOf = () => { const i = items.indexOf(value); return i >= 0 ? i : 0; };
  const posFor = vIdx => (centerOffset + vIdx) * ITEM_H;

  // 가운데(선택)에 위치한 렌더 행 인덱스 — 굵게 표시용
  const [centerRow, setCenterRow] = useState(centerOffset + idxOf());
  // 마지막으로 확정한 렌더 행 (delta 계산용)
  const lastRow = useRef(centerOffset + idxOf());

  const onMouseDown = e => {
    dragY.current = e.clientY;
    const onMove = ev => {
      if (dragY.current === null) return;
      const dy = dragY.current - ev.clientY;
      dragY.current = ev.clientY;
      if (ref.current) ref.current.scrollTop += dy;
    };
    const onUp = () => {
      dragY.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // items 변경 시 위치 초기화 (가운데 블록)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = posFor(idxOf());
    setCenterRow(centerOffset + idxOf());
    lastRow.current = centerOffset + idxOf();
  }, [items]);

  // 외부 value 변경 시 위치 동기화 (스크롤 중이 아닐 때만)
  useEffect(() => {
    if (scrolling.current) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = posFor(idxOf());
    setCenterRow(centerOffset + idxOf());
    lastRow.current = centerOffset + idxOf();
  }, [value]);

  const handleScroll = () => {
    scrolling.current = true;
    // 실시간으로 가운데 행 추적 (굵게 표시)
    const el = ref.current;
    if (el) {
      const ci = Math.round(el.scrollTop / ITEM_H);
      if (ci !== centerRow) setCenterRow(ci);
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el2 = ref.current;
      if (!el2) { scrolling.current = false; return; }
      const rawIdx = Math.round(el2.scrollTop / ITEM_H);
      const vIdx = loop ? ((rawIdx % L) + L) % L : Math.max(0, Math.min(L - 1, rawIdx));
      const newVal = items[vIdx];
      const delta = rawIdx - lastRow.current; // 움직인 칸 수 (부호 포함)
      // 가운데 블록으로 재중앙화 (같은 값이 보이므로 시각적 점프 없음)
      el2.scrollTop = posFor(vIdx);
      setCenterRow(centerOffset + vIdx);
      lastRow.current = centerOffset + vIdx;
      scrolling.current = false;
      if (delta !== 0) onChange(newVal, delta);
    }, 120);
  };

  return (
    <div className="relative flex-1 overflow-hidden select-none" style={{ height: ITEM_H * 5 }}>
      {/* 선택 영역 하이라이트 — 텍스트 뒤에 */}
      <div className="absolute left-1 right-1 rounded-xl bg-gray-100 pointer-events-none"
        style={{ top: ITEM_H * 2, height: ITEM_H, zIndex: 1 }} />
      {/* 스크롤 내용 */}
      <div ref={ref} onScroll={handleScroll}
        onWheel={e => { e.preventDefault(); if(ref.current) ref.current.scrollTop += e.deltaY; }}
        onMouseDown={onMouseDown}
        className="h-full overflow-y-scroll cursor-grab active:cursor-grabbing"
        style={{ scrollSnapType: "y mandatory", scrollbarWidth: "none", position: "relative", zIndex: 2 }}>
        <div style={{ height: ITEM_H * 2 }} />
        {rendered.map((item, i) => {
          const sel = i === centerRow;
          return (
            <div key={i} style={{ height: ITEM_H, scrollSnapAlign: "center",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: sel ? 17 : 15, fontWeight: sel ? 700 : 400,
              color: sel ? "#111827" : "#9ca3af", whiteSpace: "nowrap" }}>
              {display(item)}
            </div>
          );
        })}
        <div style={{ height: ITEM_H * 2 }} />
      </div>
      {/* 상하 페이드 */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(to bottom,white 0%,transparent 30%,transparent 70%,white 100%)", zIndex: 3 }} />
    </div>
  );
}

// ── 반복 버튼(라벨) — 종일 토글과 절반씩 나눠 쓰는 트리거 ────────────
export function RepeatToggleButton({ form, open, setOpen }) {
  const label = () => {
    switch (form.repeat) {
      case "daily":   return `${form.repeatInterval||1}일마다`;
      case "weekly":  return `${form.repeatInterval||1}주마다`;
      case "monthly": return `${form.repeatInterval||1}개월마다`;
      case "yearly":  return "매년";
      default:        return "반복 안함";
    }
  };
  return (
    <button onClick={()=>setOpen(o=>!o)} className="w-full flex items-center gap-2">
      <RotateCcw size={18} className={`shrink-0 ${form.repeat!=="none"?"text-blue-500":"text-gray-400"}`}/>
      <span className={`text-sm ${form.repeat!=="none"?"text-blue-600 font-semibold":"text-gray-700"}`}>{label()}</span>
      <ChevronRight size={14} className={`text-gray-300 ml-auto transition-transform ${open?"rotate-90":""}`}/>
    </button>
  );
}

// ── 반복 설정 패널 — 없음/매일/매주/매월/매년 + 세부 옵션 ────────────
// excludeNone: true면 "반복 없음" 버튼을 숨김(정기청소 배정처럼 항상 반복이 있어야 하는 곳에서 사용)
export function RepeatPanel({ form, set, excludeNone=false }) {
  const stepper = (value, onChange, min=1, max=99) => (
    <div className="flex items-center gap-1.5 bg-white rounded-full px-1 border border-gray-200 shrink-0">
      <button onClick={()=>onChange(Math.max(min, (value||1)-1))} className="w-7 h-7 rounded-full text-gray-600 font-bold">−</button>
      <span className="w-6 text-center text-sm font-bold text-gray-800">{value||1}</span>
      <button onClick={()=>onChange(Math.min(max, (value||1)+1))} className="w-7 h-7 rounded-full text-gray-600 font-bold">+</button>
    </div>
  );

  const applyDefaults = (type) => {
    const d = pd(form.start) || new Date();
    if (type === "weekly" && !(form.repeatWeekdays||[]).length) set("repeatWeekdays", [d.getDay()]);
    if (type === "monthly") {
      if (!form.repeatMonthlyDay) set("repeatMonthlyDay", d.getDate());
      if (form.repeatMonthlyWeekday == null) set("repeatMonthlyWeekday", d.getDay());
      if (!form.repeatMonthlyOrdinal) set("repeatMonthlyOrdinal", Math.min(5, Math.ceil(d.getDate()/7)));
    }
    if (type === "yearly") {
      if (!form.repeatYearlyMonth) set("repeatYearlyMonth", d.getMonth()+1);
      if (!form.repeatYearlyDay)   set("repeatYearlyDay", d.getDate());
      if (form.repeatYearlyWeekday == null) set("repeatYearlyWeekday", d.getDay());
      if (!form.repeatYearlyOrdinal) set("repeatYearlyOrdinal", Math.min(5, Math.ceil(d.getDate()/7)));
    }
  };
  const selectType = (v) => { set("repeat", v); if (v !== "none") applyDefaults(v); };

  const daysInMonth = Array.from({length:31},(_,i)=>i+1);
  const monthsOfYear = Array.from({length:12},(_,i)=>i+1);

  return (
    <div className="px-4 pb-4">
      <div className="flex flex-wrap gap-2 mb-3">
        {REPEAT_OPTS.filter(opt=>!excludeNone || opt.value!=="none").map(opt=>(
          <button key={opt.value} onClick={()=>selectType(opt.value)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition
              ${form.repeat===opt.value?"bg-blue-500 border-blue-400 text-white":"bg-white border-gray-200 text-gray-600"}`}>
            {opt.label}
          </button>
        ))}
      </div>

      {form.repeat === "daily" && (
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-3">
          {stepper(form.repeatInterval, v=>set("repeatInterval",v))}
          <span className="text-xs text-gray-500">일마다</span>
        </div>
      )}

      {form.repeat === "weekly" && (
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {stepper(form.repeatInterval, v=>set("repeatInterval",v))}
            <span className="text-xs text-gray-500">주마다</span>
          </div>
          <div className="flex gap-1.5">
            {WD.map((w,i)=>{
              const sel = (form.repeatWeekdays||[]).includes(i);
              return (
                <button key={i} onClick={()=>{
                  const cur = form.repeatWeekdays||[];
                  const next = sel ? cur.filter(x=>x!==i) : [...cur,i];
                  set("repeatWeekdays", next.sort((a,b)=>a-b));
                }}
                  className={`w-8 h-8 rounded-full text-xs font-bold shrink-0 ${sel?"bg-blue-500 text-white":"bg-white text-gray-500 border border-gray-200"}`}>
                  {w}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {form.repeat === "monthly" && (
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {stepper(form.repeatInterval, v=>set("repeatInterval",v))}
            <span className="text-xs text-gray-500">개월마다</span>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input type="radio" checked={form.repeatMonthlyType!=="weekday"} onChange={()=>set("repeatMonthlyType","day")}/>
            매월
            <select value={form.repeatMonthlyDay||1} onChange={e=>{set("repeatMonthlyType","day");set("repeatMonthlyDay",Number(e.target.value));}}
              className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs bg-white">
              {daysInMonth.map(d=><option key={d} value={d}>{d}일</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input type="radio" checked={form.repeatMonthlyType==="weekday"} onChange={()=>set("repeatMonthlyType","weekday")}/>
            매월
            <select value={form.repeatMonthlyOrdinal||1} onChange={e=>{set("repeatMonthlyType","weekday");set("repeatMonthlyOrdinal",Number(e.target.value));}}
              className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs bg-white">
              {REPEAT_ORD_OPTS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <select value={form.repeatMonthlyWeekday??0} onChange={e=>{set("repeatMonthlyType","weekday");set("repeatMonthlyWeekday",Number(e.target.value));}}
              className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs bg-white">
              {WD.map((w,i)=><option key={i} value={i}>{w}요일</option>)}
            </select>
          </label>
        </div>
      )}

      {form.repeat === "yearly" && (
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-700 flex-wrap">
            <input type="radio" checked={form.repeatYearlyType!=="weekday"} onChange={()=>set("repeatYearlyType","date")}/>
            <select value={form.repeatYearlyMonth||1} onChange={e=>{set("repeatYearlyType","date");set("repeatYearlyMonth",Number(e.target.value));}}
              className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs bg-white">
              {monthsOfYear.map(m=><option key={m} value={m}>{m}월</option>)}
            </select>
            <select value={form.repeatYearlyDay||1} onChange={e=>{set("repeatYearlyType","date");set("repeatYearlyDay",Number(e.target.value));}}
              className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs bg-white">
              {daysInMonth.map(d=><option key={d} value={d}>{d}일</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700 flex-wrap">
            <input type="radio" checked={form.repeatYearlyType==="weekday"} onChange={()=>set("repeatYearlyType","weekday")}/>
            <select value={form.repeatYearlyOrdinal||1} onChange={e=>{set("repeatYearlyType","weekday");set("repeatYearlyOrdinal",Number(e.target.value));}}
              className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs bg-white">
              {REPEAT_ORD_OPTS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <select value={form.repeatYearlyWeekday??0} onChange={e=>{set("repeatYearlyType","weekday");set("repeatYearlyWeekday",Number(e.target.value));}}
              className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs bg-white">
              {WD.map((w,i)=><option key={i} value={i}>{w}요일</option>)}
            </select>
          </label>
        </div>
      )}

      {form.repeat !== "none" && (
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-gray-500 shrink-0">종료일</span>
          <RepeatUntilPicker form={form} set={set}/>
        </div>
      )}
    </div>
  );
}

// ── 반복 종료일 피커 (드럼롤) ──────────────────────────────────────
export function RepeatUntilPicker({ form, set }) {
  const [open, setOpen] = useState(false);
  const WD = ["일","월","화","수","목","금","토"];

  const oneYearFromNow = () => { const n = new Date(); return new Date(n.getFullYear()+1, n.getMonth(), n.getDate()); };
  const parseRepeat = () => {
    const d = form.repeatUntil ? pd(form.repeatUntil) : oneYearFromNow();
    return { year: d.getFullYear(), month: d.getMonth()+1, day: d.getDate() };
  };
  const init = parseRepeat();
  const [pYear, setPYear]   = useState(init.year);
  const [pMonth, setPMonth] = useState(init.month);
  const [pDay, setPDay]     = useState(init.day);
  const ps = useRef(init);

  const applyDate = (y, mo, d) => {
    const safeDay = Math.min(d, new Date(y, mo, 0).getDate());
    set("repeatUntil", `${y}-${String(mo).padStart(2,"0")}-${String(safeDay).padStart(2,"0")}`);
  };
  const chYear  = v => { ps.current.year=v;  setPYear(v);  applyDate(v, ps.current.month, ps.current.day); };
  const chMonth = v => { ps.current.month=v; setPMonth(v); applyDate(ps.current.year, v, ps.current.day); };
  const chDay   = v => { ps.current.day=v;   setPDay(v);   applyDate(ps.current.year, ps.current.month, v); };

  const daysInMonth = new Date(pYear, pMonth, 0).getDate();
  const years  = Array.from({length:8},(_,i)=>2023+i);
  const months = Array.from({length:12},(_,i)=>i+1);
  const days   = Array.from({length:daysInMonth},(_,i)=>i+1);

  const dispDate = s => {
    const d = s ? pd(s) : oneYearFromNow();
    if (!d) return "--";
    const text = `${String(d.getFullYear()).slice(2)}. ${d.getMonth()+1}. ${d.getDate()}.(${WD[d.getDay()]})`;
    return s ? text : `${text} · 기본값`;
  };

  return (
    <>
      <button onClick={()=>setOpen(o=>!o)}
        className="text-sm font-semibold py-1.5 px-3 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
        {dispDate(form.repeatUntil)}
      </button>
      {open && (
        <div className="border-t border-gray-100 mt-1">
          <div className="flex px-1" style={{height:220}}>
            <WheelPicker key="ry" items={years}  value={pYear}  onChange={chYear}  renderItem={v=>String(v)}/>
            <WheelPicker key="rm" items={months} value={pMonth} onChange={chMonth} renderItem={v=>`${v}월`}/>
            <WheelPicker key={`${pYear}-${pMonth}-rd`} items={days} value={pDay} onChange={chDay}
              renderItem={v=>`${v}일`}/>
          </div>
        </div>
      )}
    </>
  );
}
