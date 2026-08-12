// 양력 → 음력 변환. korean-lunar-calendar는 KASI(한국천문연구원) 기준 데이터를 쓰는
// 순수 JS 라이브러리(의존성 없음) — 직접 계산하는 대신 검증된 라이브러리를 씀.
import KoreanLunarCalendar from "korean-lunar-calendar";

// 라이브러리가 지원하는 범위(대략 1200~2200년) 밖이거나 계산이 실패하면 null을 돌려주고,
// 호출하는 쪽에서 표시를 생략하도록 한다.
export function toLunarLabel(date) {
  try {
    const cal = new KoreanLunarCalendar();
    cal.setSolarDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = cal.getLunarCalendar();
    if (!lunar || !lunar.month || !lunar.day) return null;
    const leap = lunar.intercalation ? "윤" : "";
    return `음력 ${leap}${lunar.month}. ${lunar.day}.`;
  } catch {
    return null;
  }
}
