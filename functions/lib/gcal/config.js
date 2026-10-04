// ── 구글 캘린더 실시간(push) 동기화 — 공통 상수 ──────────────────────────
// 기존 ICS 구독 자동 동기화(index.js의 syncIcsForCal)를 대체할 새 경로.
// 기본값은 "꺼짐" — 전역 스위치(gcalConfig/global.pushEnabled)와 팀 캘린더별 스위치
// (gcalCalendars/{key}.enabled)가 둘 다 켜져야만 동작하고, 그 전까지는 기존 ICS 경로가 그대로 돈다.
// 자세한 설계·배포 절차는 docs/calendar-push-sync.md 참고.

// 서버 전용 컬렉션 — 클라이언트 보안 규칙으로 읽기/쓰기를 전부 막아야 한다(문서 참고).
export const COL = {
  config:      "gcalConfig",       // global 문서 1개: { pushEnabled }
  calendars:   "gcalCalendars",    // 팀 캘린더별 연결·동기화 상태 (토큰 없음)
  credentials: "gcalCredentials",  // 암호화된 refresh token만 따로 보관
  channels:    "gcalChannels",     // watch 채널 (문서 ID = 채널 ID)
  oauthStates: "gcalOAuthStates",  // OAuth 진행 중 state (10분짜리 1회용)
};

// 일정 읽기 전용 권한만 요청 — events.list / events.watch / channels.stop 모두 이 범위로 충분
// (Calendar API v3 discovery 문서 rev.20260925의 각 메서드 scopes 목록에서 확인).
export const OAUTH_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

// 기존 ICS 동기화와 같은 기준: 지난 30일보다 오래된 일정은 새로 만들지 않는다.
export const PAST_CUTOFF_DAYS = 30;
// 반복 일정 회차는 앞으로 1년치까지만 만든다(무한 반복 방지). 매일 1회 전체 재동기화가 창을 앞으로 민다.
export const RECURRING_HORIZON_DAYS = 365;

// watch 채널 수명 요청값(초). Google 기본값도 604800초(7일). 실제 만료는 응답의 expiration을 따른다.
export const CHANNEL_TTL_SECONDS = 7 * 24 * 3600;
// 만료까지 이 시간보다 적게 남으면 정기 점검에서 새 채널로 교체.
export const CHANNEL_RENEW_BEFORE_MS = 24 * 3600 * 1000;
// 안전망: 마지막 전체 재동기화 후 이 시간이 지나면 정기 점검이 전체 재동기화를 한 번 더 돌린다.
export const FULL_RESYNC_EVERY_MS = 24 * 3600 * 1000;
// 같은 캘린더 동기화가 겹치지 않게 거는 잠금의 최대 유지 시간(함수가 죽어도 이 시간 뒤 자동 해제).
export const SYNC_LOCK_MS = 5 * 60 * 1000;
// 전체 재동기화에서 한 번에 이만큼 넘게, 그리고 기존 일정의 절반 넘게 사라지면 오류로 보고 삭제를 보류.
export const MASS_DELETE_GUARD = { minCount: 20, ratio: 0.5 };
// 한 번 동기화에서 읽을 최대 페이지 수(페이지당 최대 2500건) — 비정상적인 무한 루프 방지.
export const MAX_PAGES = 40;

// 클린메니져 일정 문서에서 이 경로가 관리하는 일정 표시.
// 기존 ICS 구독과 같은 source 값을 그대로 쓴다 — 같은 문서 ID 규칙(UID 기반)을 공유하므로
// ICS ↔ push 를 켜고 끌 때 일정이 중복되지 않고 같은 문서가 이어서 갱신된다.
export const EVENT_SOURCE = "ics_import";
export const DELETED_BY = "gcal_push";
// 이 값들로 소프트 삭제된 문서는 구글에 다시 나타나면 되살린다(사람이 지운 건 건드리지 않음).
// (ics_sync = 앱의 .ics 파일 재업로드가 "파일에 없음"으로 정리한 것)
export const REVIVABLE_DELETED_BY = ["gcal_push", "ics_subscription", "ics_sync"];

export const calKey = (companyId, calId) => `${companyId}__${calId}`;
