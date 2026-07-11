import { useState, useRef, useEffect } from "react";
import { X, ChevronLeft } from "lucide-react";

// ── 사진 확대 보기(라이트박스) — 핀치 줌 + 좌우 스와이프로 연속 보기 ──────
let _setLightboxState = null;
// urls: 문자열 배열(url/data), startIndex: 처음 열 사진 인덱스
export const openLightbox = (urls, startIndex = 0) => {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (list.length && _setLightboxState) _setLightboxState({ list, index: startIndex });
};

export function PhotoLightbox() {
  const [state, setState] = useState(null);
  const touchX = useRef(null);
  useEffect(() => { _setLightboxState = setState; return () => { _setLightboxState = null; }; }, []);
  if (!state) return null;
  const { list, index } = state;
  const close = () => setState(null);
  const go = (delta) => setState(s => ({ ...s, index: (s.index + delta + s.list.length) % s.list.length }));
  const onTouchStart = e => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = e => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) > 50 && list.length > 1) go(dx < 0 ? 1 : -1);
  };
  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex" onClick={close}>
      <button onClick={close}
        className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-white/20 text-white flex items-center justify-center text-xl">
        <X size={20}/>
      </button>
      {list.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-white/20 text-white text-xs font-bold">
          {index + 1} / {list.length}
        </div>
      )}
      {list.length > 1 && (
        <>
          <button onClick={e => { e.stopPropagation(); go(-1); }}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/20 text-white flex items-center justify-center">
            <ChevronLeft size={22}/>
          </button>
          <button onClick={e => { e.stopPropagation(); go(1); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/20 text-white flex items-center justify-center">
            <ChevronLeft size={22} style={{ transform: "rotate(180deg)" }}/>
          </button>
        </>
      )}
      <div className="w-full h-full overflow-auto" style={{ touchAction: "pinch-zoom" }}
        onClick={e => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="min-w-full min-h-full flex items-center justify-center p-4">
          <img src={list[index]} alt="" style={{ touchAction: "pinch-zoom", maxWidth: "100%", maxHeight: "100dvh" }} className="object-contain"/>
        </div>
      </div>
    </div>
  );
}
