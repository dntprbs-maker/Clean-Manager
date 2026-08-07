import { useState } from "react";

// 네이버지도·카카오맵은 웹 지도 페이지가 있어 새 탭(https)으로 열면 되지만,
// 티맵은 검색용 웹페이지가 없어 앱 스킴(tmap://)으로만 연결된다.
// ⚠️ 앱 스킴을 window.open(url,"_blank")으로 열면 브라우저가 빈 탭을 하나 만든 뒤
//    그 탭에서 스킴을 처리하지 못해 아무 일도 일어나지 않는다(빈 탭만 남음).
//    그래서 웹 주소와 앱 스킴을 kind로 구분해 여는 방식을 다르게 처리한다.
const MAP_SERVICES = [
  { label: "네이버지도", kind: "web", url: (q) => `https://map.naver.com/v5/search/${encodeURIComponent(q)}` },
  { label: "카카오맵",   kind: "web", url: (q) => `https://map.kakao.com/link/search/${encodeURIComponent(q)}` },
  { label: "티맵",       kind: "app", url: (q) => `tmap://search?name=${encodeURIComponent(q)}` },
];

// 티맵 미설치 시 이동시킬 스토어 주소. 패키지명/앱ID를 직접 박으면 값이 바뀌었을 때
// 엉뚱한 곳으로 보내게 되므로 검색 결과 페이지를 쓴다.
const TMAP_STORE = "https://play.google.com/store/search?q=티맵&c=apps";

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent);
const isAndroid = () => /android/i.test(ua());
const isIOS     = () => /iphone|ipad|ipod/i.test(ua());

export function MapLinkButton({ place, className, children }) {
  const [open, setOpen] = useState(false);
  if (!place) return null;

  const openService = (svc) => {
    setOpen(false);
    const url = svc.url(place);

    // 웹 지도 — 기존대로 새 탭
    if (svc.kind === "web") {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    // 앱 스킴 — PC에는 앱이 없어 눌러도 반응이 없으므로 이유를 알려준다
    if (!isAndroid() && !isIOS()) {
      alert("티맵은 모바일 앱으로만 열 수 있어요.\nPC에서는 네이버지도나 카카오맵을 이용해주세요.");
      return;
    }

    if (isAndroid()) {
      // 안드로이드에서 location.href로 tmap://을 직접 던지면 앱이 없을 때
      // ERR_UNKNOWN_URL_SCHEME 오류 페이지로 넘어가면서 앱 화면을 벗어나버린다.
      // intent:// 형식은 앱이 없으면 browser_fallback_url로 대신 이동해 그 사고를 막아준다.
      const path = url.replace(/^tmap:\/\//, "");
      window.location.href =
        `intent://${path}#Intent;scheme=tmap;S.browser_fallback_url=${encodeURIComponent(TMAP_STORE)};end`;
      return;
    }

    // iOS — 앱이 없으면 사파리가 "주소를 열 수 없습니다" 안내를 대신 띄운다
    window.location.href = url;
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
              // 명시적으로 처리한다(팀 관리 메뉴 등 다른 드롭다운과 동일 패턴).
              <button key={s.label} type="button" onClick={() => openService(s)}
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
