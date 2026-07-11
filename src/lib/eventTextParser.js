// ── 제목 규칙 기본값 ──────────────────────────────────────────────
export const DEFAULT_TITLE_RULE = ["time", "district", "area"];
export const DEFAULT_TYPE_KEYWORDS = ["입주청소", "정기청소", "에어컨청소", "특수청소", "줄눈청소"];
export const TITLE_TOKEN_LABELS = {
  time:         { label:"시간대",    desc:"오전/오후/종일" },
  district:     { label:"지역",      desc:"구·동·로·길" },
  area:         { label:"평수/방",   desc:"15평, 원룸 등" },
  type:         { label:"청소종류",  desc:"입주청소 등 키워드" },
  contact_name: { label:"담당자명",  desc:"고객 이름" },
  phone_last4:  { label:"번호4자리", desc:"전화번호 끝 4자리" },
};

// ── 텍스트 자동 파싱 엔진 (정규식 기반) ─────────────────────────
export function parseEventText(text, titleRule = DEFAULT_TITLE_RULE, typeKeywords = DEFAULT_TYPE_KEYWORDS) {
  const result = {
    title:"", start:"", end:"", allDay:false,
    startTime:"09:00", endTime:"10:00",
    place:"", description:text.trim(), url:"", calId:"", repeat:"none",
  };
  const yr = new Date().getFullYear();

  // 날짜: "26.07.10" / "2026.07.10" / "26-07-10" / "6월 15일" / "6/15"
  const d0 = text.match(/(\d{2,4})[.\-]\s*(\d{1,2})[.\-]\s*(\d{1,2})(?!\d)/);
  const d1 = text.match(/(\d{1,2})월\s*(\d{1,2})일/);
  const d2 = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (d0) {
    const fullYear = d0[1].length <= 2 ? "20" + d0[1] : d0[1];
    const mo = String(d0[2]).padStart(2,"0");
    const dy = String(d0[3]).padStart(2,"0");
    result.start = fullYear + "-" + mo + "-" + dy;
    result.end   = fullYear + "-" + mo + "-" + dy;
  } else {
    const dm = d1 || d2;
    if (dm) {
      const mo = String(dm[1]).padStart(2,"0");
      const dy = String(dm[2]).padStart(2,"0");
      result.start = yr + "-" + mo + "-" + dy;
      result.end   = yr + "-" + mo + "-" + dy;
    }
  }

  // 시간: "오전 9시" / "오후 2시30분" / "오전" / "오후" / "종일" / "14시"
  let hasAM = text.includes("오전");
  let hasPM = text.includes("오후");
  const hasAllDay = text.includes("종일");

  let tm = text.match(/(오전|오후)\s*(\d{1,2})시?(?:\s*(\d{2})분?)?/);
  if (!tm) {
    const tm2 = text.match(/(\d{1,2})시(?:\s*(\d{2})분?)?/);
    if (tm2) {
      let h = parseInt(tm2[1]);
      if (h < 12) hasAM = true;
      else hasPM = true;
      let ap = h < 12 ? "오전" : "오후";
      let displayH = h > 12 ? h - 12 : (h === 0 ? 12 : h);
      tm = [tm2[0], ap, displayH, tm2[2]];
    }
  }
  if (tm) {
    const ap = tm[1]; let h = parseInt(tm[2]); const mi = tm[3]?parseInt(tm[3]):0;
    if (ap==="오후" && h<12) h+=12;
    if (ap==="오전" && h===12) h=0;
    result.startTime = String(h).padStart(2,"0")+":"+String(mi).padStart(2,"0");
    result.endTime   = String(h+1).padStart(2,"0")+":"+String(mi).padStart(2,"0");
    result.allDay = false;
  } else if (hasAM) {
    result.startTime="09:00"; result.endTime="11:00"; result.allDay=false;
  } else if (hasPM) {
    result.startTime="14:00"; result.endTime="16:00"; result.allDay=false;
  } else if (hasAllDay) {
    result.allDay=true;
  } else {
    result.allDay=false;
  }

  // 장소: 주소 패턴 줄 (설명글이 섞이지 않도록 첫 번째 주소만 정확히 캐치)
  const lines = text.split("\n");
  const pl = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    const isAddr =
      /(서울|부산|인천|대구|대전|광주|울산|세종|제주|경기|강원|충북|충남|전북|전남|경북|경남)/.test(l) ||
      /[가-힣]+(로|길|동|구|읍|면)\s*\d/.test(l);

    if (isAddr) {
      // 주소로 보이는 첫 번째 줄 추가
      pl.push(l);
      // 바로 다음 줄이 짧은 상세 주소(예: "2층 201호")일 경우 같이 붙여줌
      const next = lines[i+1]?.trim();
      if (next && next.length < 20 && (/\d+층/.test(next) || /\d+호/.test(next))) {
        pl.push(next);
      }
      break; // 주소 덩어리를 찾았으면 즉시 중단 (긴 설명글 방지)
    }
  }
  result.place = pl.join(" ");

  // 전화번호 + 이름
  const phones = [];
  const phoneRe = /([가-힣]{2,4})\s+(010[-\s]?\d{3,4}[-\s]?\d{4})/g;
  let pm;
  while ((pm = phoneRe.exec(text)) !== null) {
    phones.push({ name:pm[1].trim(), phone:pm[2].trim() });
  }
  if (phones.length === 0) {
    const op = text.match(/010[-\s]?\d{3,4}[-\s]?\d{4}/);
    if (op) phones.push({ name:"", phone:op[0] });
  }

  // 비밀번호
  const pw = text.match(/(비밀번호|비번)\s*[:：]?\s*([0-9*#!@]+)/);
  const password = pw ? pw[2] : "";

  // 제목 자동 생성 — titleRule 토큰 순서대로 조합
  const roomMatch = text.match(/([가-힣]*방\s*\d+개|원룸|투룸|쓰리룸|포룸|\d+평)/);
  const districtMatch = result.place ? result.place.match(/([가-힣]+(구|동|로|길))/) : null;
  const typeMatch = typeKeywords.map(k => text.includes(k) ? k : null).find(Boolean);

  const tokenValues = {
    time:         hasAllDay ? "종일" : hasAM ? "오전" : hasPM ? "오후" : "",
    district:     districtMatch ? districtMatch[1] : "",
    area:         roomMatch ? roomMatch[1] : "",
    type:         typeMatch || "",
    contact_name: phones.length > 0 && phones[0].name ? phones[0].name : "",
    phone_last4:  phones.length > 0 ? phones[0].phone.replace(/[^0-9]/g,"").slice(-4) : "",
  };

  result.title = (titleRule || DEFAULT_TITLE_RULE)
    .map(token => tokenValues[token] || "")
    .filter(Boolean)
    .join(" ");

  // 연락처 필드 별도 저장
  result.contact = phones.map(function(p){ return (p.name?p.name+" ":"")+p.phone; }).join(", ");

  // 내용: 원본 전체 + 비밀번호
  let desc = text.trim();
  if (password) desc += "\n\n🔐 비밀번호: " + password;
  result.description = desc;

  return result;
}
