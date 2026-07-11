// ── 팀 캘린더 구독(iCal) 링크 ────────────────────────────────────
export const genFeedToken = () => {
  if (window.crypto?.randomUUID) return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
  return Array.from({ length: 48 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
};
export const feedUrl = (companyId, calId, token) =>
  `https://asia-northeast3-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net/calendarFeed/${companyId}/${calId}/${token}.ics`;
