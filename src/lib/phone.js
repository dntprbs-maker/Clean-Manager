// ── 전화번호 정규화/표시 ───────────────────────────────────────────
// 저장은 숫자만(canonical), 화면 표시는 하이픈 포맷으로.
export const onlyDigits = s => (s || "").replace(/\D/g, "");
export const fmtPhone = s => {
  const d = onlyDigits(s);
  if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return s || "";
};
