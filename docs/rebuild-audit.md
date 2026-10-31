# 클린매니저 리빌딩 1단계 — 현행 기능·화면·데이터 의존성 전수조사

> 작성: 2026-10-31, 클라우드 세션(읽기 전용 조사). 코드 수정·삭제 없음.
> 조사 대상: 저장소 `Clean-Manager` 전체(본체 `src/`·`functions/`·`android/`). `attendance/` 폴더는
> `CLAUDE.md`/`attendance/CLAUDE.md`에 명시된 대로 **화면·데이터가 완전히 다른 별개 프로젝트**라서
> 이 조사의 "유지/재설계/제외" 판단 대상에서 제외하고 1절에서 존재만 짧게 언급한다.
> 이 시점에 같은 저장소에서 "수입지출 MVP 구현" 작업이 별도 세션으로 진행 중이어서, 이 조사는
> 코드를 전혀 바꾸지 않고 `Read`/`Grep`/`Glob`/읽기 전용 `git`·`find` 명령만 사용했다.

## 0. 조사 범위와 확인하지 못한 부분

**확인한 것**: `src/` 전체 소스, `functions/index.js`와 `functions/lib/**`(gcal push 동기화, 허브 변경분
동기화, 위젯 푸시, ICS), `functions/mcp/**`(공용 MCP 서버·도구 정의), `android/` 중 위젯 리소스 구조,
`docs/*.md`(런북 3종), `TODO.md`/`CHANGELOG.md`, `firebase.json`/`firestore.rules`/`firestore.indexes.json`,
`package.json`/`vite.config.js`.

**확인하지 못한 것 / 한계**:
- **실제 운영 상태**는 코드·문서상의 "배포 전/시험 완료" 표기에 의존했다 — Firebase 콘솔·Cloud
  Scheduler·Secret Manager에 직접 접근하지 않았으므로 `gcalWebhook`/`gcalAdmin`/`gcalMaintenance`,
  공용 MCP(`functions/mcp`), 허브 동기화(`hubEventChanged` 등)가 **실제로 몇 개 회사·팀에서 켜져
  있는지는 TODO.md와 docs 런북의 서술만 근거로 했다** (TODO.md 기준: 공용 MCP와 캘린더 push
  동기화 모두 "코드·테스트 완료, 실배포·실검증 전"으로 표기돼 있음).
- **네이티브 안드로이드 앱(Capacitor)의 빌드·배포 상태**는 `android/` 리소스 파일(XML, 레이아웃)만
  확인했고, 실제 APK 빌드·플레이스토어 배포 여부, 위젯이 실제 기기에서 정상 동작하는지는 코드
  읽기로 알 수 없다.
- **Vercel 프로젝트 쪽 설정**(TODO.md에 "도메인 컷오버 후 Vercel 프로젝트 정리" 항목 있음)은 이
  저장소에 설정 파일이 없어 조사 범위 밖이다.
- **SuperAdmin(`#superadmin`) 화면**은 코드 구조만 훑었고 실사용 빈도·위험도는 판단하지 않았다.
- **`attendance/`**(출퇴근·정산 별도 앱)는 범위 밖이라 코드를 열어보지 않았고, `attendance/CLAUDE.md`
  요약만 참고했다. 클린매니저 본체 안에도 "정기청소 근무관리"라는 유사 기능이 있어 TODO.md에 둘의
  역할이 겹친다는 미해결 항목이 등록돼 있다(5절에서 다룸).
- **진행 중인 "수입지출 MVP" 작업**과의 코드 중복 영역은 의도적으로 깊이 보지 않았다(동시 작업
  세션과의 충돌 방지).
- 통합 허브(n8n/SQLite, `docs/hub-delta-sync-20261025.md`)의 실제 운영 전환 여부는 문서상 "n8n 전환
  대기 중"으로만 확인했고, 그 허브 자체(별도 로컬 저장소)는 이 저장소 밖이라 조사하지 않았다.

---

## 1. 화면/라우트

### 1-1. 로그인 분기 (`src/main.jsx`)
- URL 해시가 `#superadmin`이면 `SuperAdmin.jsx`(마스터 관리자 전용, 전체 회사 테이블 조회·소프트
  삭제/복원), 아니면 `App.jsx`(본체 앱)를 렌더링.
- `App.jsx`는 `#demo` 또는 `?demo=true`면 `DemoProvider`로 로그인 없이 데모 데이터를 보여준다.

### 1-2. 로그인/온보딩
- `LoginScreen`(`src/features/auth/AuthScreens.jsx`) — 전화번호/아이디+비밀번호, Firebase Auth를
  쓰지 않고 Firestore 직접 조회로 로그인. 최초 비밀번호 설정, 회사 신규 등록(`SetupCompanyModal`)
  포함.
- `IphoneInstallGuide` — iOS Safari에서 홈 화면 추가(PWA) 안내 배너.

### 1-3. 메인 화면들 (`App.jsx`의 `currentScreen` 분기)
| 화면 키 | 컴포넌트 | 기능 |
|---|---|---|
| `calendar` | `CalendarView`(캘린더 기본 화면) | 월/주/일 3단계 스와이프 보기(네이버 캘린더 스타일), 일정 상세(`DetailSheet`), 등록/수정(`EventModal`), 검색(`SearchModal`), 외부 캘린더 필터(`ExtraCalFilterModal`) |
| `employees` | `EmployeeListScreen` | 직원 목록·등록·수정(`EmployeeFormModal`), 팀 다중 배정 |
| `team_schedule` | `TeamScheduleScreen` | 팀별 일정 보기 |
| `dashboard` | `DashboardScreen` | 운영 대시보드(통계 요약으로 추정, 코드상 `src/features/misc/MiscScreens.jsx:211`) |
| `notice` | `NoticeScreen` | 공지사항 등록/조회 |
| `activity_log` | `ActivityLogScreen` | 활동 로그(`companies/{c}/activityLogs`) |
| `links` | `ExternalLinksScreen` | 외부 링크 모음 |
| `report_history` | `ReportHistoryScreen` | 현장 완료 보고 이력 |
| `faq` | `FaqScreen` | 사용설명서(현재 TODO.md상 "내용 채우기 전까지 숨김") |
| `import_calendar` | `ImportCalendarScreen` | 외부 캘린더(.ics) 가져오기/구독 관리 |
| `reg_hub` | `RegularCleaningHubScreen` | "정기청소" 근무관리 허브 진입점 |
| `reg_sites` | `SitesScreen` | 정기청소 현장(거래처) 목록 |
| `reg_site_detail` | `SiteDetailScreen` | 현장 상세(배정 인력, 일정) |
| `reg_today` | `TodayStatusScreen` | 오늘 출근확인 현황 |
| `reg_my` | `MyRegularCleaningScreen` | 직원 본인의 정기청소 근무/급여 보기 |
| `reg_settlement` | `MonthlySettlementScreen` | 월별 정산(급여) 계산·확인 |

그 외 상시 오버레이: `SideDrawer`(메뉴), `FieldReportScreen`(현장 완료 보고, `fieldReportEv` 상태로
게이트), `CompanySettingsModal`, `SiteFormModal`, `AssignmentFormModal`, `ExtraPaymentModal`,
`PhotoLightbox`, `RecurringScopeSheet`(반복 일정 범위 선택).

### 1-4. 일정 등록 입력 방식 (4가지, `EventModal` 안에서 탭 전환)
메모(정규식 파싱, `src/lib/eventTextParser.js`) / 대화(AI, `analyzeConsultation`) / 사진(AI,
`extractFromImage`) / 직접입력(폼). 세 가지 중 메모만 서버 호출 없이 클라이언트 정규식으로 처리.

### 1-5. SuperAdmin (`src/SuperAdmin.jsx`, `#superadmin`)
전체 회사/직원/관리자/일정/공지/활동로그/캘린더를 테이블로 조회, 소프트 삭제·복원, 회사별
`aiTextExtraction`/`aiImageExtraction` 요금제 플래그 토글. Firestore 컬렉션에 직접 CRUD(경로를
`parts[0..5]`로 조립해서 범용 처리).

### 1-6. 네이티브 앱 셸
`capacitor.config.json` + `android/` — 웹앱을 그대로 감싼 Android WebView 앱. 로그인 화면·캘린더 등
별도 네이티브 화면은 없고, 지도 연동(`MapLinkButton`)에서만 WebView 브리지(Capacitor) 분기가 있다.

---

## 2. 데이터 의존성

### 2-1. Firestore 컬렉션 구조 (본체, `attendance_*` 제외)

**최상위**
| 컬렉션 | 용도 |
|---|---|
| `companies/{companyId}` | 회사 문서. 하위에 `events`, `users`, `notices`, `cals`, `reports`, `sites`, `assignments`, `attendance`, `links`, `activityLogs`, `extraPayments`, `monthlySettlements`, `meta/config` 서브컬렉션 |
| `staffs/{uid}` | 직원 로그인/식별용 전역 컬렉션(회사와 무관하게 `phone`으로 조회) — `companies/{c}/users`와 **데이터를 이중 기록**(동일 내용을 두 곳에 씀, 코드 전반에서 세트로 호출됨) |
| `admins/{uid}` | 회사 최고관리자(사장) 로그인/식별용 전역 컬렉션 |
| `widgetPush/{companyId}` | 위젯 변경 알림 발송용 큐·락(1분 묶음 처리) |
| `gcalConfig`, `gcalCalendars`, `gcalCredentials`, `gcalChannels`, `gcalOAuthStates` | 구글 캘린더 push 동기화 서버 전용(클라이언트 접근 Firestore 규칙으로 차단) |
| `mcpOAuthTokens`, `mcpOAuthClients`, `mcpOAuthCodes`, `mcpAgents`, `mcpHubStreams`(추정, 허브용) | 공용 MCP 서버 전용(클라이언트 접근 차단) |

**`companies/{c}` 하위 서브컬렉션**
| 서브컬렉션 | 읽고 쓰는 곳 |
|---|---|
| `events` | 일정 본체. `AppContext.jsx`(실시간 구독), `CalendarCore.jsx`(등록/수정), `ImportCalendarScreen.jsx`(ICS 가져오기), Cloud Functions(`sendEventNotification` 등, gcal push, MCP `events.js`) |
| `users` | 직원(회사 범위), `EmployeeTeamScreens.jsx`, `fcm.js` |
| `notices` | 공지사항, `AppContext.jsx`, `NoticeScreen` |
| `cals` | 팀/개인 캘린더(색상·구독설정), `AuthScreens.jsx`(최초 생성), `gcalPushStatus` 필드 추가 위치 |
| `reports` | 현장 완료 보고, `AppContext.jsx`, `FieldReportScreen` |
| `sites` | 정기청소 현장(거래처), `RegularCleaningScreens.jsx` |
| `assignments` | 현장-직원 배정(반복 규칙 포함), `RegularCleaningScreens.jsx` |
| `attendance` | 정기청소 출근확인(본체 내 기능 — `attendance/` 별도 앱과는 다른 컬렉션) |
| `links` | 외부 링크 |
| `activityLogs` | 활동 로그 |
| `extraPayments` | 추가 수당 |
| `monthlySettlements` | 월별 정산 결과 캐시 |
| `meta/config` | 회사 설정(제목 규칙 `titleRule`, `typeKeywords` 등 AI 추출 프롬프트에 쓰이는 값 포함) |

구독(`onSnapshot`)은 전부 `AppContext.jsx`에 모여 있고, 각 화면은 컨텍스트에서 상태만 소비한다.

### 2-2. Cloud Functions 전체 목록 (`functions/index.js` + `functions/lib/**`)

| 함수 | 트리거 | 역할 |
|---|---|---|
| `syncAdminPushToken` | onCall | `admins` 컬렉션 FCM 토큰 등록/해제(클라이언트가 `admins`를 직접 못 쓰므로 Admin SDK 경유) |
| `sendEventNotification` | Firestore onCreate(`events`) | 일정 신규 등록 시 담당 팀 푸시 |
| `sendEventUpdateNotification` | Firestore onUpdate(`events`) | 담당 팀이 바뀐 경우에만 알림(일반 수정은 알림 없음, 2026-09-10 정책) |
| `sendEventDeleteNotification` | Firestore onDelete(`events`) | 삭제 시 담당 팀 알림 |
| `dailyScheduleDigest` | 스케줄(매일 08:00 KST) | 사장에게 그날 전체 일정 요약 푸시(시험 운영) |
| `analyzeConsultation` | onCall(+Secret `OPENROUTER_API_KEY`) | 대화(텍스트) → 일정 정보 AI 추출 |
| `extractFromImage` | onCall(+Secret) | 사진(base64) → 일정 정보 AI 추출 |
| `calendarFeed` | onRequest | 팀별 `.ics` 피드 발행(네이버 등 "URL로 구독"용) |
| `syncIcsSubscriptionNow` | onCall | 저장한 구독 URL 즉시 1회 동기화 |
| `icsSubscriptionAutoSync` | 스케줄(6시간) | 구독 URL 자동 재동기화(지난 1개월 이전 컷오프). push 켜진 팀은 건너뜀 |
| `gcalWebhook` | onRequest | 구글 캘린더 변경 push 알림 수신 → 증분 동기화 |
| `gcalAdmin` | onRequest | 구글 캘린더 연결 관리 페이지(OAuth, 패스프레이즈 보호) |
| `gcalMaintenance` | 스케줄(매시 15분) | 채널 재생성, 알림 누락 보정, 1일 1회 전체 재동기화 |
| `widgetEventChanged` / `widgetCalChanged` | Firestore onWrite | 위젯에 보이는 필드 변경 시 1분 묶음으로 FCM 토픽(`widget_{companyId}`) 발송 |
| `hubEventChanged` / `hubCalendarChanged` / `hubReportChanged` | Firestore onWrite | 외부 통합 허브(n8n/SQLite, 이 저장소 밖)로 보낼 변경분을 회사별 순번 문서로 기록 |
| `mcp` | onRequest(Streamable HTTP) | 공용 MCP 서버(아래 2-4) |

### 2-3. 외부 API 연동
- **OpenRouter(LLM API)** — `analyzeConsultation`/`extractFromImage`가 `OPENROUTER_API_KEY` 시크릿으로
  호출(`functions/index.js:340` 부근 `callOpenRouter`). 구체적으로 어느 모델인지는 요청 바디에
  있을 텐데, 이번 조사 범위에서 모델명 문자열까지는 확인하지 않음 — 필요하면 `functions/index.js`의
  `callOpenRouter` 호출부를 추가로 확인 권장.
- **Google Calendar API** — `functions/lib/gcal/*`에서 OAuth 2.0(읽기 전용 `calendar.events.readonly`)
  으로 연결, push 알림(webhook) + REST(`events.list`/`events.watch`) 사용. 자세한 설계는
  `docs/calendar-push-sync.md`.
- **FCM(Firebase Cloud Messaging)** — 일정 알림, 위젯 변경 알림, 일일 요약, 공지(코드상 알림은
  일정/위젯/일일요약만 확인됨; "공지 등록 시 전 직원 알림"은 TODO.md에 **미구현 검토 항목**으로
  남아있음).
- **지도 앱 연동** — 네이버지도/카카오맵(웹 URL)·티맵(앱 스킴)만, 외부 지도 API 호출은 없음(단순
  URL 생성 후 브라우저/OS에 위임).
- **공용 MCP(Model Context Protocol)** — 외부 AI 에이전트(ChatGPT/Hermes/Claude/Codex)가 OAuth로
  연결해 일정/직원/팀을 조회·등록·수정하는 자체 서버(`functions/mcp/**`). 상태는 "코드·시험 완료,
  운영 배포 전"(`docs/shared-mcp.md`).
- **통합 허브 동기화** — 클린매니저 → 외부 SQLite 허브(n8n 경유, 이 저장소 밖)로 일정·팀·보고
  변경분을 내보내는 경량 트리거(`hubChangeTriggers.js`). "코드 완료, n8n 운영 전환 대기"
  (`docs/hub-delta-sync-20261025.md`).

### 2-4. 공용 MCP 도구 목록 (`functions/mcp/tools/*.js`)
- **events.js**: `list_events`, `search_events`, `get_event`, `create_event`(사진 첨부·정산 정보
  지원), `update_event`(부분 수정), `request_event_deletion`(삭제는 요청만, 관리자 승인 필요),
  `export_hub_changes`(읽기 전용, 허브 전용)
- **employees.js**: 직원 목록 조회·등록·수정·소프트삭제(owner 권한)
- **teams.js**: 팀 목록 조회·생성·이름변경·삭제, 팀원 배정/제외/역할변경(owner 권한)
- AI별로 `agentId`(chorong/harry/ari/dexd/owner)마다 접속키를 따로 발급해 누가 무엇을 했는지
  `mcpCreatedBy`/`mcpUpdatedBy`로 기록. `test: true`로 등록한 시험 일정은 직원 푸시를 보내지 않음.

---

## 3. 네이티브 앱/위젯 연동 구조

- **앱 셸**: Capacitor(`@capacitor/android`)로 웹앱(Vite 빌드)을 그대로 WebView에 담는 방식. 별도
  네이티브 화면 코드는 없음(`capacitor.config.json` 1곳만 설정).
- **지도 연동 WebView 브리지 분기**(`MapLinkButton.jsx`): Capacitor 네이티브 앱 안에서는 Capacitor
  브리지가 URL 이동을 가로채 `ACTION_VIEW` 인텐트로 바꾸는데, `intent://` 래핑 문법은 이해하지 못해
  순수 스킴(`tmap://`)을 직접 던지고, 일반 모바일 브라우저에서는 앱 미설치 대비용 `intent://` 래핑을
  쓰는 식으로 두 경로를 분기해 처리.
- **홈 화면 위젯**(안드로이드 전용, `android/app/src/main/res/{xml,layout,drawable}/widget_*`):
  7칸형(`twoweek`)·2종(`twoweek2`)·주간형(`weekly`)·월간형(`monthly`) 4종의 위젯 레이아웃/메타데이터
  파일만 확인됨 — 위젯을 그리는 실제 네이티브 코드(Kotlin/Java AppWidgetProvider 등)는 이번 조사에서
  디렉터리 목록까지만 훑었고 내부 로직까지는 열어보지 않았다(2절 범위상 서버 쪽 `widgetPush.js`만
  상세 확인).
- **위젯 ↔ 서버 연동**: Cloud Functions `widgetEventChanged`/`widgetCalChanged`가 일정의 "위젯에
  보이는 필드"(`title`/`start`/`end`/`startTime`/`endTime`/`allDay`/`place`/`calId`/`status`)만 걸러
  변경 감지 → 1분 단위로 묶어 FCM 토픽(`widget_{companyId}`)으로 "바뀐 id 목록"만 보냄(위젯이 그
  시점에 Firestore를 다시 읽어 그림). 읽기 비용 절감을 위한 설계(TODO.md 2026-10-30 항목과 일치).

---

## 4. 지도·알림 등 외부 연동 상세

### 4-1. 지도
`src/components/shared/MapLinkButton.jsx` — 네이버지도/카카오맵(웹, 새 탭)·티맵(앱 스킴, 모바일
전용) 3종 선택 드롭다운. PC에서 티맵을 누르면 안내 alert만 띄움. 외부 지도 SDK/API 키 사용 없음
(순수 URL 조립).

### 4-2. 알림/푸시 (FCM)
- 클라이언트: `src/fcm.js` — 권한 요청 → 토큰 발급 → "이 기기 = 마지막 로그인 사용자만 알림" 정책으로
  동일 토큰을 다른 사람 문서에서 제거 후 현재 사용자 문서(`companies/{c}/users/{uid}`와
  `staffs/{uid}` 양쪽)에 등록. 사장(`admins`)은 서버 콜러블(`syncAdminPushToken`)로만 처리(클라이언트
  직접 쓰기가 Firestore 규칙으로 막혀 있음).
- 서버: 일정 생성/삭제/담당팀 변경 시 알림(`sendEventNotification` 등), 위젯 변경 알림, 매일 아침
  08:00 KST 사장 요약 알림(시험 운영 — 팀 전체 발송은 TODO.md 검토 항목).
- **공지사항 알림은 코드상 구현되어 있지 않음**(TODO.md에 "검토" 항목으로만 존재) — 5절에서 다룸.

### 4-3. 외부 캘린더 가져오기/구독
- **ICS 가져오기/구독**(`ImportCalendarScreen.jsx`, `calendarFeed` 함수): 네이버 등에서 비공개 iCal
  URL을 등록하면 6시간마다 자동 재동기화(`icsSubscriptionAutoSync`), 역방향으로 클린매니저 자체
  팀 캘린더를 `.ics`로 발행(`calendarFeed`)해 네이버 쪽에서 구독도 가능. 반복 일정은 첫 회차만
  가져오는 한계가 문서화돼 있음.
- **Google Calendar push 동기화**(`functions/lib/gcal/**`): OAuth 연결 후 webhook 실시간 반영(수초~1분),
  반복 일정 회차별 전개(1년치), 전역 스위치 AND 팀별 스위치 이중 on/off, 대량 삭제 방지 안전장치
  포함. **상태: 코드·테스트 완료, 실배포 전**(TODO.md, `docs/calendar-push-sync.md` 1장 상단 명시).

### 4-4. 공용 MCP(외부 AI 에이전트 연동)
OAuth 2.1 + PKCE 또는 고정 Bearer 토큰으로 ChatGPT/Hermes(Claude)/Codex 등 외부 AI가 일정·직원·팀을
조회·등록·수정할 수 있는 자체 MCP 서버. **상태: 코드·자동 테스트 완료, 운영 배포 전**(`docs/shared-mcp.md`).
배포 전 필수로 식별된 보안 이슈: 관련 Firestore 컬렉션(`mcpOAuthTokens` 등)이 비인증 읽기·쓰기에
열려 있어 누구나 owner 권한 토큰을 자체 발급할 수 있는 상태였음(문서 기준 2026-10-16 실측) — 규칙
변경안은 작성돼 있으나 "승인 필요" 상태로 TODO.md에 남아 있다.

### 4-5. 통합 허브(변경분 동기화)
클린매니저 → 외부 n8n/SQLite 허브로 일정/팀/보고 변경만 내보내는 경량 트리거 3개
(`hubEventChanged` 등) + MCP 안의 읽기 전용 `export_hub_changes`. Firestore 읽기 비용을 기존
평소 811회/주기에서 2회로 줄이는 것이 목적(`docs/hub-delta-sync-20261025.md` 비용 분석 표 참고).
**상태: "운영 반영 완료"라고 되어 있으나 n8n 쪽 최종 전환은 기존 실행 4건 때문에 대기 중**이라고
문서에 명시돼 있어, 실제 트리거가 상시 활성 상태인지는 이 조사만으로 단정하기 어렵다.

---

## 5. 유지 / 재설계 / 제외 후보 (판단은 제시만 — 최종 결정은 하지 않음)

> 아래는 조사 결과를 바탕으로 한 **후보 분류 제안**이다. 실제 결정(유지할지, 다시 설계할지, 걷어낼지)은
> 사람이 내려야 하며, 특히 "제외 후보"로 분류한 항목도 데이터가 남아있어 당장 지워도 되는지는 별도
> 확인이 필요하다.

### 5-1. 유지 후보 (현재 운영 중이고 핵심 가치를 내는 것)
- 캘린더 본체(월/주/일 보기, 일정 CRUD, 반복 일정) — 앱의 중심 기능, 실사용 중.
- 직원/팀 관리, 다대다 멤버십 구조 — 안정적으로 쓰이고 있고 최근까지도 계속 다듬어짐(TODO.md 완료
  로그 다수).
- FCM 알림(일정 생성/담당팀 변경/위젯 변경) — 읽기 비용까지 고려해 설계돼 운영 중.
- 지도 연동(`MapLinkButton`) — 작고 독립적이며 최근 버그(앱 전환 실패)도 수정 완료.
- ICS 가져오기/구독 — 네이버 등 외부 캘린더 호환을 위한 핵심 경로이며 실사용 확인됨(완료 로그
  2026-08-12).
- 정기청소 "현장(sites)/배정(assignments)/월별 정산" 흐름 — 급여 계산 규칙이 명확히 문서화돼 있고
  (`src/lib/settlement.js`) 월별 정산 화면까지 완결된 기능.

### 5-2. 재설계 후보 (가치는 있으나 구조·검증이 미흡해 리빌딩 시 손봐야 할 것)
- **AI 일정 추출(대화·사진)** — OpenRouter 호출 기반, 제목 규칙 일치 문제를 겪었고(완료 로그
  2026-08-15) TODO.md에 "실사용 확인 필요"가 아직 남아 있음. 메모(정규식) 모드와 결과 일관성이
  구조적으로 깨지기 쉬운 지점(두 경로가 서로 다른 로직으로 같은 결과를 내야 함).
- **Google Calendar push 동기화** — 설계는 탄탄하지만 *코드만 있고 실배포·실검증 전* 상태가 꽤
  오래 유지되고 있음. 리빌딩 시점에 ICS 폴링과 push 두 경로를 유지할지, push만 남길지 결정 필요.
- **공용 MCP(외부 AI 연동)** — 기능은 완성됐지만 배포 전 필수인 Firestore 보안 규칙 변경이 "승인
  대기" 상태로 막혀 있음. 이 앱 전반이 Firebase Auth를 쓰지 않고 자체 로그인을 쓰는 구조라서
  생기는 문제(전체 컬렉션이 기본적으로 비로그인 읽기/쓰기 허용)가 `gcal*`/`mcp*`에만 부분 대응돼
  있고, **나머지 전체(`companies`, `staffs`, `admins` 등)는 여전히 비로그인 접근이 열려 있음** —
  이번 조사에서 발견한 가장 큰 구조적 리스크. 리빌딩 범위에 반드시 포함해 검토할 필요.
- **통합 허브 변경분 동기화** — 비용 절감 설계는 끝났지만 n8n 운영 전환이 막혀 있어, 이 저장소
  코드만으로는 "허브로 내보내는 트리거가 상시 켜진 상태"인지 확신할 수 없음. 리빌딩 시 이 트리거를
  그대로 가져갈지, 허브 자체를 다른 방식으로 재구성할지 함께 판단 필요.
- **SuperAdmin 화면(`#superadmin`)** — Firestore 경로를 배열 인덱스로 조립해 범용 CRUD를 하는 구조라
  (`parts[0]~parts[5]`) 유지보수성이 낮고, 접근 제어가 URL 해시 하나뿐이라 보안 설계를 다시 볼
  필요가 있음.
- **본체 안의 "정기청소" 영역과 `attendance/` 앱의 역할 중복** — TODO.md에 등록된 미해결 항목
  그대로: 본체의 `reg_*` 화면(현장/배정/정산)과 별도 앱 `attendance/`(외주 용역자 출퇴근·정산)가
  이름·역할이 겹쳐 리빌딩 시 혼란의 소지가 있음. 어느 쪽이 "정기청소 근무관리"의 정본인지, 둘 다
  유지할지 하나로 합칠지는 리빌딩 설계 단계에서 명확히 정해야 할 것으로 보임(TODO.md 자체도
  "지금은 천천히, 급하게 진행하지 말 것"이라고 적어둠).

### 5-3. 제외 후보 (현재 더 이상 쓰이지 않거나 임시 산출물로 보이는 것)
- 저장소 루트의 `webdesigner-*.html`/`.png`/`.jpeg` 다수 파일과 `call-webdesigner.mjs`,
  `generate-webdesigner-code.mjs`, `generate-webdesigner-image.mjs` — 디자인 시안 생성 스크립트와
  그 산출물 보관용으로 보이며(완료 로그 2026-08-07 "webdesigner 디자인 시안 생성 스크립트 + 산출물
  보관"), 운영 코드 경로(`src/`, `functions/`)에서 참조되는지는 확인되지 않음. 리빌딩 시 저장소에
  그대로 남길지, 별도 아카이브로 옮길지 검토 후보.
- `webdesigner-clockscreen-3options.md` — 디자인 검토용 메모로 보이며 운영 코드와 무관.
- **일일 요약 알림(`dailyScheduleDigest`)** — 코드 주석에 "시험 운영"이라고 명시돼 있고, 팀 전체
  발송 여부 등 정책이 아직 TODO.md "검토" 단계. 정식 기능으로 승격할지, 걷어낼지 결정 필요한
  과도기 상태.
- `TODO.md`의 "공용 MCP(AI 4종) 배포·연결 검증", "구글 캘린더 push 동기화 배포·실검증" 두 항목은
  리빌딩이 진행되는 동안 **배포하지 않고 보류**하는 것도 선택지로 보임 — 코드는 있지만 운영 반영
  전이라 리빌딩 설계가 바뀌면 그대로 폐기될 수도 있는 영역이기 때문.

---

## 부록: 참고한 기존 문서
- `docs/calendar-push-sync.md` — 구글 캘린더 push 동기화 런북
- `docs/shared-mcp.md` — 공용 MCP 배포·연결 런북
- `docs/hub-delta-sync-20261025.md` — 통합 허브 변경분 동기화 기록
- `TODO.md` / `CHANGELOG.md` — 미해결/완료 작업 로그
- `attendance/CLAUDE.md` — 별개 프로젝트(`attendance/`) 요약 (내용은 깊이 조사하지 않음)
