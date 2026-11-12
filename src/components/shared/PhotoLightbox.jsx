import { useState, useRef, useEffect } from 'react';
import { useBackLayer } from '../../hooks/useBackLayer';
import { X, ChevronLeft, Plus, Minus, RotateCcw } from 'lucide-react';

let showPhotos = null;
export function openLightbox(urls, startIndex = 0) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(url => typeof url === 'string' && url);
  if (list.length && showPhotos) showPhotos({ list, index: Math.max(0, Math.min(list.length - 1, Math.trunc(Number(startIndex) || 0))) });
}
function ZoomablePhoto({ url, onSwipe, description }) {
  const viewport = useRef(null), image = useRef(null), pointers = useRef(new Map());
  const transform = useRef({ scale: 1, x: 0, y: 0 }), gesture = useRef(null), pinched = useRef(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const apply = next => {
    const bounds = viewport.current?.getBoundingClientRect();
    const scale = Math.max(1, Math.min(6, next.scale));
    const limitX = Math.max(0, ((image.current?.clientWidth || 0) * scale - (bounds?.width || 0)) / 2);
    const limitY = Math.max(0, ((image.current?.clientHeight || 0) * scale - (bounds?.height || 0)) / 2);
    const value = { scale, x: Math.max(-limitX, Math.min(limitX, next.x)), y: Math.max(-limitY, Math.min(limitY, next.y)) };
    transform.current = value; setView(value);
  };
  const pinch = () => {
    const [a, b] = [...pointers.current.values()], r = viewport.current.getBoundingClientRect();
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), middle: { x: (a.x + b.x) / 2 - r.x - r.width / 2, y: (a.y + b.y) / 2 - r.y - r.height / 2 } };
  };
  const startGesture = () => {
    if (pointers.current.size >= 2) {
      const { distance, middle } = pinch(), v = transform.current;
      pinched.current = true;
      gesture.current = { type: 'pinch', distance, scale: v.scale, anchorX: (middle.x - v.x) / v.scale, anchorY: (middle.y - v.y) / v.scale };
    } else if (pointers.current.size === 1) {
      gesture.current = { type: 'drag', ...[...pointers.current.values()][0], originalX: transform.current.x, originalY: transform.current.y };
    }
  };
  const down = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!pointers.current.size) pinched.current = false;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId); startGesture();
  };
  const move = event => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (pointers.current.size >= 2 && g?.type === 'pinch') {
      const { distance, middle } = pinch(), scale = Math.max(1, Math.min(6, g.scale * distance / Math.max(g.distance, 1)));
      apply({ scale, x: middle.x - g.anchorX * scale, y: middle.y - g.anchorY * scale });
    } else if (g?.type === 'drag' && transform.current.scale > 1) {
      apply({ ...transform.current, x: g.originalX + event.clientX - g.x, y: g.originalY + event.clientY - g.y });
    }
  };
  const end = event => {
    if (!pointers.current.has(event.pointerId)) return;
    const g = gesture.current;
    if (event.type === 'pointerup' && pointers.current.size === 1 && !pinched.current && g?.type === 'drag' && transform.current.scale === 1) {
      const dx = event.clientX - g.x, dy = event.clientY - g.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) onSwipe(dx < 0 ? 1 : -1);
    }
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointers.current.size) startGesture(); else gesture.current = null;
  };
  const zoom = factor => apply({ ...transform.current, scale: transform.current.scale * factor });
  return <>
    <div ref={viewport} className="absolute inset-0 flex items-center justify-center p-4 select-none overflow-hidden"
      data-allow-pinch data-photo-zoom={view.scale.toFixed(3)} style={{ touchAction: 'none' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onDoubleClick={() => apply({ scale: transform.current.scale > 1 ? 1 : 2.5, x: 0, y: 0 })}>
      <img ref={image} src={url} alt={description} draggable={false} className="object-contain pointer-events-none"
        style={{ maxWidth: '100%', maxHeight: '100%', transform: 'translate3d('+view.x+'px,'+view.y+'px,0) scale('+view.scale+')', transformOrigin: 'center' }}/>
    </div>
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 rounded-full bg-black/60 px-3 py-2 text-white">
      <button type="button" aria-label="사진 축소" onClick={() => zoom(1 / 1.5)} disabled={view.scale <= 1} className="p-2 disabled:opacity-40"><Minus size={20}/></button>
      <button type="button" aria-label="사진 크기 초기화" onClick={() => apply({ scale: 1, x: 0, y: 0 })} className="flex items-center gap-1 px-1 text-xs"><RotateCcw size={15}/>{Math.round(view.scale * 100)}%</button>
      <button type="button" aria-label="사진 확대" onClick={() => zoom(1.5)} disabled={view.scale >= 6} className="p-2 disabled:opacity-40"><Plus size={20}/></button>
    </div>
  </>;
}
export function PhotoLightbox() {
  const [state, setState] = useState(null);
  useBackLayer(!!state, () => setState(null), 300);
  useEffect(() => { showPhotos = setState; return () => { showPhotos = null; }; }, []);
  useEffect(() => {
    if (!state) return;
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const key = event => {
      if (event.key === 'Escape') setState(null);
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') setState(s => s && ({ ...s, index: (s.index + (event.key === 'ArrowRight' ? 1 : -1) + s.list.length) % s.list.length }));
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', key); };
  }, [state]);
  if (!state) return null;
  const { list, index } = state;
  const go = delta => setState(s => ({ ...s, index: (s.index + delta + s.list.length) % s.list.length }));
  return <div role="dialog" aria-modal="true" aria-label="사진 크게 보기" className="fixed inset-0 z-[9999] bg-black/95">
    <ZoomablePhoto key={index+':'+list[index]} url={list[index]} onSwipe={go} description={'첨부 사진 '+(index+1)}/>
    <button type="button" aria-label="사진 닫기" onClick={() => setState(null)} className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={22}/></button>
    {list.length > 1 && <>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-full bg-black/60 px-3 py-1 text-white text-xs">{index + 1} / {list.length}</div>
      <button type="button" aria-label="이전 사진" onClick={() => go(-1)} className="absolute left-2 top-1/2 z-10 rounded-full bg-black/60 text-white p-2"><ChevronLeft size={22}/></button>
      <button type="button" aria-label="다음 사진" onClick={() => go(1)} className="absolute right-2 top-1/2 z-10 rounded-full bg-black/60 text-white p-2"><ChevronLeft size={22} className="rotate-180"/></button>
    </>}
  </div>;
}
