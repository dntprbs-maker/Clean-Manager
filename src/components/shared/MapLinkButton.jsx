import { useState } from "react";

// 티맵은 지도 검색용 웹페이지가 따로 없어 앱 스킴(tmap://)으로 연결한다.
// 앱이 설치된 모바일에서만 열리고, 데스크톱/앱 미설치 시에는 반응하지 않을 수 있음.
const MAP_SERVICES = [
  { label: "네이버지도", url: (q) => `https://map.naver.com/v5/search/${encodeURIComponent(q)}` },
  { label: "카카오맵", url: (q) => `https://map.kakao.com/link/search/${encodeURIComponent(q)}` },
  { label: "티맵", url: (q) => `tmap://search?name=${encodeURIComponent(q)}` },
];

export function MapLinkButton({ place, className, children }) {
  const [open, setOpen] = useState(false);
  if (!place) return null;

  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen(o => !o)} className={className}>
        {children}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 min-w-[110px] py-1 overflow-hidden">
            {MAP_SERVICES.map(s => (
              <a key={s.label} href={s.url(place)} target="_blank" rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-gray-700 text-left hover:bg-gray-50 whitespace-nowrap">
                {s.label}
              </a>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
