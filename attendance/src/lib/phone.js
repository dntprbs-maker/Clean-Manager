// 클린매니저 src/lib/phone.js와 동일한 정규화 규칙 (같은 staffs 데이터를 조회하기 위함).
export const onlyDigits = (s) => (s || '').replace(/\D/g, '');
export const fmtPhone = (s) => {
  const d = onlyDigits(s);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return s || '';
};

// 입력 중에도 하이픈이 보이도록 자릿수에 맞춰 즉시 포맷(휴대폰 3-4-4 기준).
export const liveFmtPhone = (s) => {
  const d = onlyDigits(s).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
};
