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

  const openService = (url) => {
    setOpen(false);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <span className={`relative inline-block ${className || ""}`}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full text-left">
        {children}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 min-w-[110px] py-1 overflow-hidden">
            {MAP_SERVICES.map(s => (
              // 모바일에서 target="_blank" 앵커는 터치 제스처(길게 누르기 등)에 브라우저가 자체
              // 반응해 의도치 않게 즉시 이동하는 경우가 있어, 실제 이동은 버튼 클릭 핸들러에서
              // window.open으로 명시적으로 처리한다(팀 관리 메뉴 등 다른 드롭다운과 동일 패턴).
              <button key={s.label} type="button" onClick={() => openService(s.url(place))}
                className="block w-full px-3 py-2 text-sm text-gray-700 text-left hover:bg-gray-50 whitespace-nowrap">
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
