# 구글 캘린더 실시간(push) 동기화 — 설계 · 배포 · 검증 런북

> 상태: **코드 완료, 배포 전.** 기본값은 꺼짐이라 배포만 해서는 아무 동작도 바뀌지 않습니다.
> 기존 ICS 구독 자동 동기화(6시간 주기)는 그대로 남아 있고, 스위치를 끄면 즉시 그쪽으로 돌아갑니다.

---

## 1. 무엇이 바뀌나

| | 기존(ICS 폴링) | 새 경로(push) |
|---|---|---|
| 방식 | 6시간마다 비공개 iCal 주소 전체 다운로드 | Google이 변경 즉시 webhook 호출 → 바뀐 것만 조회(syncToken) |
| 반영 속도 | 최대 6시간 | 보통 수 초~1분 (Google 알림 지연에 좌우) |
| 반복 일정 | RRULE 무시(첫 회차만) | 회차별로 펼쳐서 저장(1년 앞까지) |
| 인증 | 비공개 주소(URL 자체가 비밀) | OAuth (읽기 전용 권한 `calendar.events.readonly`) |

### 구성 요소 (모두 `functions/`)

| 함수 | 종류 | 역할 |
|---|---|---|
| `gcalWebhook` | HTTPS | Google 알림 수신. 채널 ID·토큰·리소스 ID 검증 후 증분 동기화 |
| `gcalAdmin` | HTTPS | 운영자 관리 페이지. 구글 계정 연결(OAuth), 켜기/끄기, 상태 확인. 패스프레이즈 보호 |
| `gcalMaintenance` | 스케줄(매시 15분, KST) | 채널 만료 전 자동 교체 + 알림 누락 대비 증분 동기화 + 하루 1회 전체 재동기화 |
| `icsSubscriptionAutoSync` / `syncIcsSubscriptionNow` | 기존 | **그대로 동작.** 단, push가 켜진 팀만 건너뜀 |

코드: `functions/lib/gcal/*.js`, 테스트: `functions/test/*.test.js`

### 데이터 (Firestore)

서버 전용 컬렉션(클라이언트 접근 금지 — 4장 보안 규칙 참고):

| 경로 | 내용 |
|---|---|
| `gcalConfig/global` | `{ pushEnabled: bool }` — **전역 스위치** (없으면 꺼짐) |
| `gcalCalendars/{회사ID}__{팀ID}` | 팀 캘린더 ↔ 구글 캘린더 연결, **팀별 스위치 `enabled`**, `syncToken`, 채널 정보, `lastSuccessAt`/`lastSyncAt`/`lastError`/`lastErrorAt`/`consecutiveErrors`/`needsReauth`, 잠금 필드 |
| `gcalCredentials/{회사ID}__{팀ID}` | refresh token (**AES-256-GCM 암호화**, 키는 Secret Manager의 `GCAL_TOKEN_KEY`) |
| `gcalChannels/{채널ID}` | watch 채널(토큰은 SHA-256 해시만), 상태, 만료, 마지막 알림 번호 |
| `gcalOAuthStates/{state}` | OAuth 진행 중 1회용 state + PKCE verifier (10분 만료) |

기존 컬렉션에 추가되는 필드:

- `companies/{c}/cals/{calId}.gcalPushStatus` — 앱 화면 표시용 상태 복사본(진짜 기준은 `gcalCalendars`).
- `companies/{c}/events/{id}.gcalSync` — `{ eventId, iCalUID, recurringEventId, updated, calendarId, syncedAt }`.

일정 문서는 기존 ICS 구독과 **같은 규칙**으로 씁니다: `source: "ics_import"`, 같은 문서 ID(UID 기반), 같은 `icsRaw` 기준값(앱에서 사람이 고친 필드는 덮어쓰지 않음), 삭제는 소프트 삭제(`status: "deleted"`, `deletedBy: "gcal_push"`). 그래서 ICS ↔ push 전환 시 일정이 중복되지 않습니다. **기존 데이터를 지우거나 옮기는 마이그레이션은 없습니다.**

### 동기화 흐름

1. **켜기**: 채널 먼저 생성(`events.watch`) → 전체 동기화(syncToken 없이 목록 전체) → `nextSyncToken` 저장.
2. **알림 수신**: 헤더 검증 → `X-Goog-Resource-State`가 `sync`면 200만 응답, `exists`/`not_exists`면 증분 동기화(`syncToken`).
3. **증분 동기화**: 바뀐 일정만 받음. `status: "cancelled"` → 소프트 삭제. 반복 시리즈 원본이 취소되면 그 회차 문서도 정리.
4. **410 GONE**(syncToken 만료) → 토큰 버리고 전체 재동기화. 전체 재동기화에서는 구글 목록에 없는 기존 문서를 소프트 삭제.
5. **syncToken은 문서 쓰기가 전부 성공한 뒤에만 저장** → 중간 실패 시 다음 동기화가 같은 변경을 다시 받음.

### 중복·순서 역전 방지(멱등성)

- 알림에는 내용이 없고 "바뀌었다"는 신호뿐 → 몇 번 오든 항상 Google에서 최신 변경을 다시 받아 **문서 ID 기준으로 덮어쓰기**.
- 같은 캘린더 동기화는 **잠금(5분 lease, 트랜잭션)** 으로 한 번에 하나만. 잠금 중 들어온 알림은 `pendingResync` 표시 → 잠금 쥔 쪽이 끝나기 전에 한 번 더 돎.
- 일정마다 Google `updated` 시각 저장 → **더 오래된 버전이 나중에 와도 덮어쓰지 않음**.

### 복구(안전망)

- `gcalMaintenance` 매시간: 증분 동기화 1회(알림 누락 보정), 마지막 전체 동기화 후 24시간 지났으면 전체 재동기화(삭제 누락·반복 일정 1년 창 이동 보정), 만료 24시간 이내 채널 교체.
- webhook 안에서 동기화가 실패해도 200 응답 + 오류 기록 → 다음 정기 점검이 다시 시도.
- **대량 삭제 방지**: 전체 재동기화에서 20개 이상이면서 기존 일정의 절반 넘게 한꺼번에 사라지면 삭제만 보류하고 `lastError`에 기록. 관리 페이지의 "강제(대량삭제 허용)" 버튼으로만 진행.
- refresh token이 무효(`invalid_grant`)면 `needsReauth: true` 표시 + 그 팀은 정기 점검에서 건너뜀 → 관리 페이지에서 재연결.

### 켜고 끄는 법(롤백)

push는 **전역 스위치 AND 팀별 스위치**가 둘 다 켜진 팀에서만 동작합니다.

- **즉시 전체 롤백**: 관리 페이지 "전역 끄기" (또는 Firestore 콘솔에서 `gcalConfig/global.pushEnabled = false`). 재배포 불필요. 이후 webhook·정기 점검은 아무것도 쓰지 않고, ICS 자동 동기화가 다음 6시간 주기부터 다시 그 팀을 처리. 앱의 "저장하고 지금 동기화" 버튼으로 즉시 실행 가능.
- **팀 하나만 롤백**: 관리 페이지에서 그 팀 "끄기"(채널 중지 + 스위치 내림).
- 롤백해도 일정 데이터는 그대로입니다. push가 지운 일정은 ICS가 다시 가져올 때 되살아납니다.
  단, ICS 방식은 반복 일정을 첫 회차 1개로만 가져오므로(기존 한계) push가 만든 반복 회차 문서(`gcal_…`)는 ICS가 "피드에 없음"으로 소프트 삭제합니다. 다시 push를 켜면 되살아납니다.

---

## 2. 사전 준비 — 사람이 해야 하는 일 (Google Cloud 콘솔)

> 프로젝트: `clean-manager-60bc9` (Firebase 프로젝트와 같은 GCP 프로젝트)

### 2-1. Calendar API 켜기
1. https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=clean-manager-60bc9 열기
2. **사용(Enable)** 클릭
   (또는 터미널: `gcloud services enable calendar-json.googleapis.com --project clean-manager-60bc9`)

### 2-2. OAuth 동의 화면(Google Auth Platform)
1. https://console.cloud.google.com/auth/overview?project=clean-manager-60bc9 열기 (처음이면 "시작하기")
2. **브랜딩**: 앱 이름(예: `클린메니져 캘린더 동기화`), 사용자 지원 이메일 입력 → 저장
3. **대상(Audience)**: 사용자 유형 **외부(External)** 선택(개인 gmail 캘린더를 연결하려면 외부여야 함)
4. **데이터 액세스(Scopes)** → "범위 추가" → `https://www.googleapis.com/auth/calendar.events.readonly` 체크 → 저장
5. **대상 → 게시 상태**: **"앱 게시(Publish app)" → 프로덕션**으로 전환
   - ⚠️ "테스트" 상태로 두면 **refresh token이 7일 뒤 만료**되어 매주 재연결해야 합니다.
   - 이 범위는 '민감한 범위'라 미검증 앱은 연결 때 "Google에서 확인하지 않은 앱" 경고가 뜹니다. 운영자 본인 계정만 연결하므로 **고급 → (앱 이름)(으)로 이동(안전하지 않음)** 을 눌러 진행하면 됩니다(미검증 앱은 사용자 100명 제한 — 이 용도엔 충분).
   - 테스트 상태로 먼저 시험하려면 "테스트 사용자"에 연결할 구글 계정을 추가하세요.

### 2-3. OAuth 클라이언트 ID 만들기
1. https://console.cloud.google.com/auth/clients?project=clean-manager-60bc9 → **클라이언트 만들기**
2. 애플리케이션 유형: **웹 애플리케이션**, 이름: `gcal-push-sync`
3. **승인된 리디렉션 URI** 에 정확히 입력:
   `https://asia-northeast3-clean-manager-60bc9.cloudfunctions.net/gcalAdmin/oauth/callback`
4. 만들기 → 표시되는 **클라이언트 ID**와 **클라이언트 보안 비밀번호**를 바로 다음 단계 비밀값 입력에 사용(어디에도 저장·공유하지 말 것)

### 2-4. webhook 주소 / 도메인 확인
- webhook 주소: `https://asia-northeast3-clean-manager-60bc9.cloudfunctions.net/gcalWebhook`
- Google 요구사항은 **유효한 SSL 인증서가 있는 HTTPS 주소**입니다. `cloudfunctions.net`은 Google이 발급한 인증서라 충족합니다.
- 예전에는 Search Console 도메인 소유 확인이 필요했으나 현재 Calendar push 가이드에는 그 단계가 없습니다(이번 작업 환경에서 가이드 원문 접속이 막혀 검색 결과로만 확인 — **아래 5장 검증에서 watch 생성이 성공하면 확인 완료**). 만약 watch 생성 시 `push.webhookUrlUnauthorized` 같은 오류가 나면 Search Console에서 도메인 확인이 필요하다는 뜻입니다.
- 다른 주소를 쓰려면 `functions/.env`(커밋 금지)에 `GCAL_PUBLIC_BASE_URL=https://...` 를 넣으면 webhook·관리 페이지·리디렉션 주소가 모두 그 기준으로 바뀝니다(리디렉션 URI도 같이 바꿔 등록).

---

## 3. 비밀값 설정 (Secret Manager — 코드/깃/문서에 값 절대 기록 금지)

| 이름 | 내용 | 만드는 법 |
|---|---|---|
| `GCAL_OAUTH_CLIENT_ID` | 2-3의 클라이언트 ID | 콘솔에서 복사 |
| `GCAL_OAUTH_CLIENT_SECRET` | 2-3의 클라이언트 보안 비밀번호 | 콘솔에서 복사 |
| `GCAL_TOKEN_KEY` | refresh token 암호화 키(32바이트 base64) | `openssl rand -base64 32` |
| `GCAL_ADMIN_PASSPHRASE` | 관리 페이지 패스프레이즈 | 충분히 긴 임의 문자열 (`openssl rand -base64 24`) |

```bash
cd Clean-Manager
firebase use clean-manager-60bc9
firebase functions:secrets:set GCAL_OAUTH_CLIENT_ID       # 프롬프트에 붙여넣기
firebase functions:secrets:set GCAL_OAUTH_CLIENT_SECRET
openssl rand -base64 32 | firebase functions:secrets:set GCAL_TOKEN_KEY --data-file=-
firebase functions:secrets:set GCAL_ADMIN_PASSPHRASE     # 직접 정한 값 입력(따로 안전하게 보관)
firebase functions:secrets:access GCAL_TOKEN_KEY >/dev/null && echo OK   # 존재 확인(값을 화면에 띄우지 말 것)
```

⚠️ `GCAL_TOKEN_KEY`를 나중에 바꾸면 저장된 refresh token을 못 풀어서 **모든 팀을 재연결**해야 합니다.
⚠️ 이 4개 비밀값이 없으면 `firebase deploy --only functions`(전체)가 비밀값을 물어보며 멈춥니다 — **배포 전에 먼저 설정**하세요.

---

## 4. Firestore 보안 규칙 (2026-10-04 적용 완료)

이 저장소에는 `firestore.rules` 파일이 없습니다(`firebase.json`에 firestore 항목 없음) → 규칙은 **Firebase 콘솔/CLI로 직접 관리**합니다. 저장소에 규칙 파일을 넣고 `firebase.json`에 연결하면 다음 `firebase deploy` 때 규칙이 덮어써질 수 있으니 주의하세요.

### 왜 "gcal 컬렉션만 막는 규칙을 추가"하는 방식이 안 되나

이 앱은 Firebase 로그인을 쓰지 않고 자체 로그인을 써서, 원래 규칙이 **전체 허용 한 줄**이었습니다.

```
match /{document=**} { allow read, write: if true; }
```

Firestore 규칙은 "하나라도 허용하면 허용"이라서, 그 위에 `gcal*` 금지 규칙을 따로 추가해도 **무시됩니다**(실제로 비로그인 조회가 200으로 열려 있었음).

### 실제로 적용한 규칙

전체 허용 한 줄을 아래로 **교체**했습니다. `gcal`로 시작하지 않는 컬렉션은 예전과 똑같이 허용하고, `gcal*`만 서버 전용(Admin SDK)으로 막습니다.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{col}/{document=**} {
      allow read, write: if !col.matches('gcal.*');
    }
  }
}
```

- 서버 함수(Admin SDK)는 규칙을 우회하므로 동작에 영향이 없습니다.
- 앱·출퇴근 앱·안드로이드 위젯은 `collectionGroup` 조회를 쓰지 않고 `gcal*` 컬렉션을 읽지 않아 영향이 없음을 코드 검색으로 확인했습니다. 앱이 읽는 `companies/{c}/cals/{calId}.gcalPushStatus`(표시용)는 다른 경로입니다.
- 앱에서 `gcal`로 시작하는 이름의 컬렉션을 새로 쓰면 막히니 주의하세요.

### 적용 방법(참고)과 복원

- CLI로 적용: 임시 폴더에 `firestore.rules`(위 규칙)와 `firebase.json`(`{"firestore":{"rules":"firestore.rules"}}`)을 만들고 `npx firebase-tools deploy --only firestore:rules --project clean-manager-60bc9`. 먼저 `--dry-run`으로 컴파일 검사.
- 콘솔: https://console.firebase.google.com/project/clean-manager-60bc9/firestore/databases/-default-/security/rules 에서 직접 붙여넣기도 가능.
- **원복**(이상이 있을 때): 이전 전체 허용 규칙으로 되돌려 다시 게시. 콘솔 규칙 화면의 **버전 기록**에서 이전 버전을 선택해 복원할 수도 있습니다.

### 적용 후 확인 결과

| 확인 | 결과 |
|---|---|
| 비로그인으로 `gcalConfig`, `gcalCredentials`, `gcalCalendars`, `gcalChannels`, `gcalOAuthStates` 조회 | 403 (차단) |
| 비로그인으로 `companies/...`, `events`, `cals`, `users`, `staffs`, `attendance_*` 조회 | 200 (기존과 동일) |
| 앱에서 기존 일정 조회·일정 추가 | 정상 |
| 구글 일정 생성·삭제 → 앱 반영 | 정상 |

※ 앱 전체가 로그인 없이 열려 있는 근본 문제(그 외 컬렉션은 여전히 누구나 읽기·쓰기 가능)는 이번 범위가 아닙니다.

## 5. 배포 (감독 작업자 환경에서)

```bash
git fetch origin claude/calendar-push-sync && git checkout claude/calendar-push-sync
cd functions && npm ci && npm test        # 34개 통과 확인
cd ..
# 새 함수 3개 + ICS 건너뛰기가 들어간 기존 함수 2개만 배포(다른 함수는 건드리지 않음)
firebase deploy --only functions:gcalWebhook,functions:gcalAdmin,functions:gcalMaintenance,functions:icsSubscriptionAutoSync,functions:syncIcsSubscriptionNow
```

- 첫 배포 때 Cloud Scheduler API 사용 여부를 물으면 "예".
- 앱 화면 변경(상태 표시)은 `main`에 머지되면 GitHub Actions가 Hosting에 자동 배포합니다. 그 전에 보려면 `npm run build && firebase deploy --only hosting:main`.
- 배포 직후에는 **아무 동작도 바뀌지 않습니다**(스위치 꺼짐).
- HTTPS 함수는 기본적으로 공개(인증 없이 호출 가능)로 배포됩니다 — Google이 webhook을 호출하려면 공개여야 하고, 검증은 함수 안에서 합니다. 혹시 조직 정책으로 공개가 막혀 있으면 Cloud Run 콘솔에서 `gcalwebhook`/`gcaladmin` 서비스에 `allUsers` → `Cloud Run Invoker`를 부여해야 합니다.

---

## 6. 연결 · 켜기 (사람이 직접 — 구글 로그인/동의 필요)

1. 브라우저에서 관리 페이지 열기: `https://asia-northeast3-clean-manager-60bc9.cloudfunctions.net/gcalAdmin`
2. 3장에서 정한 **패스프레이즈** 입력 → 들어가기
3. "연결 후보" 표에서 연결할 팀의 **[구글 계정 연결]** 클릭
   (후보에 없으면 "직접 연결"에 회사 ID / 팀 캘린더 ID / 구글 캘린더 ID 입력. 구글 캘린더 ID는 구글 캘린더 → 설정 → 해당 캘린더 → "캘린더 통합" → **캘린더 ID**)
4. 구글 로그인 → (미검증 경고 시) **고급 → 이동** → 권한 화면에서 **"일정 보기" 허용**
5. "✅ 구글 계정 연결 완료" 화면 확인 → **관리 페이지로**
6. 아직 꺼짐 상태입니다. 맨 위 **[전역 켜기]** 클릭
7. 연결된 팀 행의 **[켜기]** 클릭 → 상단에 `켜기 완료 — 채널 …, 동기화 ok` 표시 확인

---

## 7. 실제 검증 절차 (체크리스트)

| # | 할 일 | 기대 결과 | 확인 위치 |
|---|---|---|---|
| 1 | 켜기 직후 | 관리 페이지에 성공 시각·채널 만료(약 7일 뒤) 표시, 오류 없음 | 관리 페이지 |
| 2 | 구글 캘린더에서 새 일정 만들기 | 1분 안에 클린메니져 해당 팀 캘린더에 나타남 | 앱 / Firestore `companies/{c}/events` |
| 3 | 그 일정 제목·시간 바꾸기 | 1분 안에 반영(시간은 KST) | 앱 |
| 4 | 그 일정 삭제 | 1분 안에 앱에서 사라짐(문서는 `status: deleted`, `deletedBy: gcal_push`) | 앱 / Firestore |
| 5 | 종일 일정(하루짜리) 만들기 | 시작일=종료일로 하루만 표시 | 앱 |
| 6 | 매주 반복 일정 만들기 | 회차마다 문서(`gcal_…`) 생성, 1년치까지 | Firestore |
| 7 | 앱에서 동기화된 일정의 장소를 직접 수정 → 구글에서 같은 일정 장소 수정 | 앱에서 고친 장소가 유지됨 | 앱 |
| 8 | 로그 확인 | `gcalWebhook` 200 응답, 오류 없음 | `firebase functions:log --only gcalWebhook` |
| 9 | 다음 정각 15분 지난 뒤 | `[gcalMaintenance] … 증분 ok` 로그 | `firebase functions:log --only gcalMaintenance` |
| 10 | 앱 "캘린더 가져오기" 화면 | "⚡ 구글 실시간 동기화 사용 중 · 마지막 성공 …" 표시, "저장하고 지금 동기화" 누르면 "ICS 동기화는 건너뛰었어요" | 앱 |
| 11 | 6시간 ICS 주기 지난 뒤 | `icsSubscriptionAutoSync` 로그에 `구글 실시간 동기화 사용 중 — ICS 건너뜀` | 로그 |
| 12 | 롤백 시험: [전역 끄기] → 앱에서 "저장하고 지금 동기화" | ICS 동기화가 다시 정상 동작(가져옴 N개) | 앱 |
| 13 | 다시 [전역 켜기] | 정상 복귀 — 다음 정기 점검(매시 15분)에서 전체 재동기화로 꺼진 동안의 차이를 바로잡음 | 관리 페이지 |

로그 보기:
```bash
firebase functions:log --only gcalWebhook
firebase functions:log --only gcalMaintenance
firebase functions:log --only icsSubscriptionAutoSync
```

---

## 8. 문제 해결

| 증상 | 원인 / 조치 |
|---|---|
| 연결 시 `redirect_uri_mismatch` | 2-3의 리디렉션 URI가 정확히 일치하는지 확인(끝 `/` 없음) |
| 연결 완료 후 "refresh token을 받지 못했습니다" | https://myaccount.google.com/connections 에서 이 앱 권한 삭제 후 다시 연결 |
| 관리 페이지에 "재연결 필요" | 권한 해제됐거나 OAuth 앱이 '테스트' 상태(7일 만료). 2-2의 5번(프로덕션 게시) 확인 후 [구글 계정 연결] 다시 |
| 켜기에서 watch 실패(4xx) | Calendar API 미사용(2-1), webhook 주소 문제(2-4), 캘린더 ID 오타 |
| "삭제를 보류했습니다" 오류 | 전체 재동기화에서 일정이 대량으로 사라짐. 구글 캘린더 연결이 맞는지 확인 후 [강제(대량삭제 허용)] |
| 알림이 안 오는 것 같음 | 정기 점검(매시간)이 증분 동기화로 보정함. `gcalChannels/{id}.lastNotificationAt` 확인 |
| 급하게 예전 방식으로 | [전역 끄기] — 1장 "켜고 끄는 법" 참고 |

---

## 9. 알려진 한계

- **Google 공식 가이드 원문(push/sync 가이드 페이지)은 이번 개발 환경에서 네트워크 차단으로 직접 열람하지 못했습니다.** 대신 공식 Calendar API v3 디스커버리 문서(rev. 20260925, `www.googleapis.com/discovery/v1/apis/calendar/v3/rest`)로 `events.list`/`events.watch`/`channels.stop`의 파라미터·스코프·syncToken 제약(`timeMin`/`timeMax`/`orderBy`/`q`/`updatedMin`/`iCalUID` 등과 함께 사용 불가, 만료 시 410)을 확인했고, 알림 헤더·sync 메시지·TTL 기본값(604800초)은 공식 문서 검색 결과로 확인했습니다. 5·7장의 실제 검증이 최종 확인입니다.
- 알림 응답 코드: 검증 실패 시 400/403/404(재시도 안 함이 목적), 정상·동기화 실패 모두 200(오류는 기록, 정기 점검이 복구). 예상 못 한 서버 오류만 500(구글이 재시도).
- 반복 일정은 `singleEvents=true`로 회차를 펼쳐 저장합니다. 끝 없는 반복은 1년 앞까지만 만들고, 매일 전체 재동기화가 창을 앞으로 옮깁니다. "이후 모든 일정" 수정처럼 시리즈가 쪼개지는 경우 증분 알림만으로 정리가 안 되는 회차는 다음 전체 재동기화(최대 24시간)에서 정리됩니다.
- 지난 30일보다 오래된 일정은 새로 만들지 않습니다(기존 ICS와 같은 기준). 이미 있는 문서는 계속 갱신합니다.
- 관리 페이지는 패스프레이즈 1개로만 보호합니다(이 앱이 Firebase Auth를 쓰지 않아 서버가 사용자 신원을 확인할 방법이 없음 — MCP 연결 승인 화면과 같은 방식). 실패 시 0.8초 지연 외 별도 잠금은 없습니다.
- 팀 캘린더 하나당 구글 캘린더 하나만 연결됩니다.
- 기존 ICS 경로의 종일 일정 종료일이 하루 길게 들어오던 문제(ICS의 DTEND는 다음날)는 push 경로에서는 바로잡혀 있습니다. ICS 경로 자체는 이번 작업 범위 밖이라 그대로 두었습니다.
