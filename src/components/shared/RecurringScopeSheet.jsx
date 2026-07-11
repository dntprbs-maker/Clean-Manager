import { useState, useEffect } from "react";

// ── 반복일정 수정/삭제 범위 선택 시트 ────────────────────────────
// askRecurringScope(ev, "edit"|"delete") → Promise<"instance"|"following"|"all"|null(취소)>
let _setScopeAskState = null;
export const askRecurringScope = (ev, action) => new Promise(resolve => {
  if (!ev?._recurring) { resolve("all"); return; }
  if (_setScopeAskState) _setScopeAskState({ ev, action, resolve });
  else resolve("all");
});

export function RecurringScopeSheet() {
  const [state, setState] = useState(null);
  useEffect(() => { _setScopeAskState = setState; return () => { _setScopeAskState = null; }; }, []);
  if (!state) return null;
  const { ev, action, resolve } = state;
  const finish = (v) => { setState(null); resolve(v); };
  const verb = action === "delete" ? "삭제" : "수정";
  const OPTS = [
    { v: "instance",  l: `이 일정만 ${verb}`,        d: `${ev.start} 회차만` },
    { v: "following", l: `이후 모든 일정 ${verb}`,    d: `${ev.start}부터 이후 전체` },
    { v: "all",       l: `전체 반복일정 ${verb}`,      d: "시리즈 전체" },
  ];
  return (
    <div className="fixed inset-0 z-[9999] bg-black/40 flex items-end" onClick={()=>finish(null)}>
      <div className="w-full max-w-sm mx-auto bg-white rounded-t-3xl overflow-hidden" onClick={e=>e.stopPropagation()}
        style={{ animation: "modalSlideUp 0.3s cubic-bezier(0.32,0.72,0,1) both" }}>
        <div className="px-5 pt-5 pb-2">
          <p className="text-sm font-bold text-gray-800">반복일정 {verb}</p>
          <p className="text-xs text-gray-400 mt-0.5 truncate">'{ev.title}'</p>
        </div>
        <div className="flex flex-col">
          {OPTS.map(o=>(
            <button key={o.v} onClick={()=>finish(o.v)}
              className="flex flex-col items-start px-5 py-3.5 border-t border-gray-100 active:bg-gray-50 text-left">
              <span className={`text-sm font-semibold ${action==="delete"&&o.v!=="instance"?"text-red-500":"text-gray-800"}`}>{o.l}</span>
              <span className="text-xs text-gray-400 mt-0.5">{o.d}</span>
            </button>
          ))}
        </div>
        <button onClick={()=>finish(null)}
          className="w-full py-3.5 border-t border-gray-100 text-sm font-bold text-gray-400">취소</button>
        <div className="h-2"/>
      </div>
    </div>
  );
}
