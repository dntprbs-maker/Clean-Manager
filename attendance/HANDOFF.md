# 정기청소 근무관리 — 작업 인수인계 문서 (2026-07-18 기준)

새 대화방에서 이어받을 때 이 문서 하나로 전체 맥락을 파악할 수 있도록 세부적으로 기록함.

## 1. 프로젝트 개요

- **레포**: `C:\Users\user\Documents\Clean-Manager` (클린매니저 GitHub 레포) 안의 `attendance/` 서브폴더 — 클린매니저 루트 앱과 완전히 독립된 Vite 프로젝트(별도 package.json/vite.config).
- **목적**: 정기청소 외주 용역자들의 출퇴근 체크 + 급여 정산. 나중에 클린매니저 본체에 통합 예정(현재는 독립 운영).
- **기술 스택**: Vite + React 19 + Tailwind v4. 상태관리는 React state만 사용(Redux 등 없음), Firestore `onSnapshot`으로 실시간 구독.
- **백엔드**: 클린매니저와 **같은 Firebase 프로젝트** `clean-manager-60bc9` 공유. Firestore 컬렉션은 `attendance_` 접두사로 클린매니저 기존 컬렉션과 분리(`attendance_workers`, `attendance_workLogs`, `attendance_settlements`, `attendance_sites`, `attendance_accounts`).
- **로컬 개발**: `attendance/` 폴더에서 `npm run dev` → 포트 **5176** (클린매니저 5173, clean-member 5174, 다인이벤트 5175와 안 겹치게). `.claude/launch.json`(클린매니저 프로젝트용, 그리고 `C:\Users\user\.claude\.claude\launch.json`) 둘 다에 `attendance-dev` 설정 등록됨.
- **⚠️ 보안 미해결**: Firestore 보안규칙이 잠겨있지 않음 — 로그인 없이도 API로 데이터 접근 가능한 상태. 실사용(진짜 급여 데이터) 전 반드시 규칙을 잠가야 함. 지금까지는 "테스트 단계니 나중에"로 보류 중.

## 2. 배포

- **배포 주소**: https://clean-manager-attendance.web.app
- Firebase Hosting 멀티사이트로 클린매니저와 분리 배포. 루트 `firebase.json`의 `hosting`이 배열로 바뀌어 `main`(클린매니저, `dist`)과 `attendance`(`attendance/dist`) 두 타겟으로 나뉨. `.firebaserc`에 타겟 매핑 저장됨.
- 배포 명령: `cd attendance && npm run build` 후 레포 루트에서 `npx firebase-tools deploy --only hosting:attendance --project clean-manager-60bc9`
- **자동배포(GitHub Actions)는 아직 미설정** — 수동 배포만 해온 상태. 필요하면 클린매니저/다인이벤트처럼 `firebase init hosting:github`로 추가 가능.

## 3. 사업 구조 (반드시 지켜야 할 전제)

- 작업자는 **비정규직 근로자가 아니라 외주 용역자** — 근로계약서 아닌 외주 용역 계약서.
- **4대보험 미적용**, **사업소득 3.3% 원천징수만** 적용.
- **연차, 주52시간 근무제 등 근로기준법 개념은 시스템에서 아예 다루지 않음.**
- 정산 흐름: 매니저가 근무시간 확정 → 대표가 승인 → 지급(원래는 익월 10~15일 지급 기준으로 논의됐으나 UI에 날짜 강제는 안 걸어둠).

## 4. 데이터 모델 (Firestore 컬렉션)

### `attendance_workers` — 직원(용역자) 프로필 겸 로그인 계정
```
name: string
phone: string (숫자만, 로그인 아이디로 사용)
payType: 'hourly' | 'daily' | 'weekly' | 'monthly' (기본 'hourly')
payRate: number
note: string (여러 줄 가능, textarea)
active: boolean
pw: string (최초 로그인 시 본인이 설정, 빈 문자열이면 "첫 로그인" 상태)
createdAt: serverTimestamp
```
- **호환 주의**: `payType`/`payRate` 도입 이전 만들어진 예전 직원 데이터는 `hourlyRate` 필드만 있음. `db.js`의 `payInfoOf(worker)` 함수가 `payRate ?? hourlyRate`로 자동 호환 처리. 수정 화면에서 저장하면 새 필드로 전환됨.

### `attendance_sites` — 현장
```
name: string
address: string
note: string (여러 줄, textarea)
workerIds: string[] (배치된 직원의 attendance_workers 문서 id 배열)
active: boolean
createdAt: serverTimestamp
```

### `attendance_workLogs` — 근무기록(출퇴근)
```
workerId, workerName: string
siteId, siteName: string | null (출근 시 선택한 현장)
date: "YYYY-MM-DD" (근무일 — 아래 "근무일 규칙" 참고)
yearMonth: "YYYY-MM" (date.slice(0,7))
clockIn: Timestamp | null
clockOut: Timestamp | null
hours: number | null (clockOut 시점에 자동 계산, 소수점 2자리 반올림)
status: 'working' | 'done'
deleted: boolean (소프트 삭제 — true면 모든 조회에서 제외)
createdAt: serverTimestamp
```
- **근무일 9시 컷오프 규칙** (`lib/format.js`의 `currentWorkDay()`): **오전 9시 이전 출근은 전날 근무일로 귀속**. 자정 넘기는 야간 근무를 하루로 묶기 위함. 다른 곳에서 `todayDate()`나 `new Date()`로 임의 계산해서 근무기록에 쓰면 안 됨 — `currentWorkDay()`가 유일한 기준.
- 하루(근무일)당 로그 1건만 존재(`subscribeTodayLog`가 workerId+date로 조회). 한 직원이 하루에 두 현장 근무는 지원 안 함(현재 구조상 불가).

### `attendance_settlements` — 정산 (문서 id: `${yearMonth}_${workerId}_${siteId}`)
```
yearMonth, workerId, workerName: string
siteId, siteName: string ('현장 미지정' 가능 — siteId 없는 근무기록은 'unassigned'로 묶임)
payType, payRate: (직원 기준 스냅샷)
totalHours: number
workDays: number (그 달 그 현장에서 근무한 날짜 수)
workWeeks: number (월~일 기준으로 근무한 주 수)
grossAmount, withholdingTax(3.3%), netAmount: number
status: 'draft' | 'managerConfirmed' | 'adminApproved' | 'paid'
managerConfirmedAt / adminApprovedAt / paidAt: serverTimestamp
deleted: boolean
updatedAt: serverTimestamp
```
- **"용역자 × 현장" 단위로 정산이 나뉨** — 한 직원이 이번달 두 현장에서 일했으면 정산 건이 2개, 각각 독립적으로 매니저확정→대표승인→지급완료 흐름을 거침.
- 급여 계산(`generateSettlements` in `db.js`):
  - hourly: `totalHours × payRate`
  - daily: `workDays × payRate`
  - weekly: `workWeeks × payRate` (월요일 기준 주차 카운트)
  - monthly: 그 달 그 현장에 근무기록이 하나라도 있으면 `payRate` 고정 지급, 없으면 0
- **⚠️ 알려진 한계**: 시급/일급은 현장별 실측이라 정확하지만, **주급/월급 직원이 같은 달에 두 현장을 오가며 일하면 각 현장에서 "일한 주/달"로 각각 카운트되어 사실상 중복 지급처럼 계산될 수 있음.** 드문 케이스라 지금은 보류, 실제 발생하면 근무일수 비율 배분 로직 추가 필요.
- 정산 재집계(`generateSettlements` 재호출) 시 이미 `draft`를 벗어난 건(확정/승인/지급된 건)은 덮어쓰지 않음 — 안전장치.

### `attendance_accounts` — 매니저/최고관리자 로그인 (직원과 별도 체계)
```
id: string (로그인 아이디, 전화번호 형태 아님)
pw: string
name: string
role: '매니저' | '최고관리자'
active: boolean
```
- 계정 문서 자체에 `id`라는 필드가 있어서, Firestore 문서 id는 코드에서 `uid`로 별도 취급(`accounts.js`의 `subscribeAccounts`가 `{...d.data(), uid: d.id}` 순서로 스프레드 — 순서 바꾸면 버그 남).

## 5. 로그인 체계 (`lib/auth.js`, `LoginScreen.jsx`, `SetupScreen.jsx`)

**두 개의 완전히 분리된 로그인 경로:**
1. **직원(용역자)**: `attendance_workers.phone`이 로그인 아이디. 최초엔 `pw` 필드가 비어있고, 처음 로그인 시 본인이 비밀번호를 설정하며 그대로 로그인 처리됨(클린매니저 staffs 로그인 패턴과 유사하되, 클린매니저 계정과는 완전 무관 — 처음엔 클린매니저 계정 재사용을 시도했다가 "같은 번호로 두 앱 로그인하면 헷갈린다"는 피드백으로 별도 체계로 전환한 이력 있음).
2. **매니저/최고관리자**: `attendance_accounts`. 계정이 하나도 없으면 `SetupScreen`(최초 대표 계정 셀프 생성)이 뜨고, 이후엔 항상 `LoginScreen`.

**LoginScreen.jsx 동작 (`mode` 상태: `'id' | 'login' | 'setup'`)**:
- 입력란 1개: placeholder "전화번호" (매니저 아이디도 여기 입력 가능, 문구만 전화번호로 단순화됨). 숫자/하이픈만 입력하면 `liveFmtPhone()`으로 타이핑 중에도 실시간 하이픈 포맷(010-1234-5678).
- **전화번호가 완성되면(11자리) blur 없이 자동으로 확인** — `useEffect`가 `checkLoginId()` 호출:
  - 미등록 전화번호 → 에러
  - 등록됨 + 비밀번호 있음 → `mode='login'`, 비밀번호 입력란 노출
  - 등록됨 + 비밀번호 없음(첫 로그인) → `mode='setup'`, "OO님, 첫 로그인이시네요" + 새 비밀번호/확인 입력란 2개 노출
- **전화번호 형태가 아닌 텍스트**(매니저 아이디)는 `onBlur`(포커스 벗어날 때)에 `mode='login'`으로 전환 — 완성 시점을 알 수 없어서 blur로 판단.
- 로그인 버튼은 **항상 보이되**, `mode==='id'`(아직 미확인)일 때만 비활성화(흐릿하게). 비밀번호 비어있어도 버튼은 활성화되고 눌러보면 자연스럽게 에러 표시.
- 타이틀: "정기청소 근무관리"

## 6. 권한 체계 (`lib/membership.js`)

```js
isSuperAdmin(u)        // u.role === '최고관리자'
isWorker(u)             // u.role === '용역자'
canConfirmAsManager(u)  // role === '매니저' || 최고관리자
canApproveAsAdmin(u)    // 최고관리자만
```

## 7. 화면 구성 (전체 목록 + 폼 필드까지)

### 공통 레이아웃
- **모바일 전용 고정 프레임** (`App.jsx`의 `frame()` 함수): PC에서 열어도 `max-w-[420px]` 좁은 폭으로 가운데 정렬, 양옆은 회색(`bg-gray-200`) 여백.
- **Header.jsx**: 왼쪽부터 삼선메뉴 아이콘 → 이름 → `(전화번호, 하이픈 포맷)`. 삼선 클릭 시 팝업형 드롭다운 메뉴(카드형, 왼쪽 하단에 뜸) — 배경 딤 처리, 딤 영역 클릭 시 닫힘.
- 헤더 바로 아래: 오늘 날짜 한 줄 ("2026년 7월 18일 금" 형식, `formatDateLong(todayDate())`).
- **Modal.jsx = 이 프로젝트의 표준 팝업 스타일 (전체 프로젝트 공통 규칙으로 메모리에 등록됨)**: 배경 딤(클릭 시 닫힘) + 화면 가장자리에서 여백(좌우 16px, 상단 헤더 아래로, 하단 여백) + 카드(rounded-2xl, shadow-xl) + 우상단 X 닫기 버튼.

### 매니저/최고관리자 메뉴 (`STAFF_TABS`, 실제 탭 전환)
1. **대시보드** (`DashboardTab.jsx`) — 카드 4개: 활동중인 용역자 수, 대표 승인 대기 건수, 지급 예정액, 이번달 지급완료액.
2. **직원 관리** (`WorkersTab.jsx` + `WorkerFormModal.jsx`) — "직원 추가" 버튼(팝업 폼: 이름 / 전화번호(하이픈 실시간표시) / 급여유형 선택(시급·일급·주급·월급)+금액 / 메모(textarea)). 목록에 수정/비활성화·활성화/삭제(확인창) 버튼. 로그인 설정 여부 표시("로그인 설정됨" / "아직 로그인 안 함(첫 로그인 대기)").
3. **현장 관리** (`SitesTab.jsx` + `SiteFormModal.jsx`) — "현장 추가" 버튼(팝업 폼: 현장 이름 / 주소 / 메모(textarea) / 배치할 직원 — 검색창+체크박스 다중선택 리스트, 스크롤 가능). 목록에 배치 인원 명단, 수정/비활성화/삭제.
4. **근무기록** (`WorkLogsTab.jsx` + `WorkLogFormModal.jsx`) — "근무기록 추가" 버튼(팝업 폼: 직원 검색창+용역자 선택 드롭다운 / 현장 선택 드롭다운(선택사항) / 근무일 date input / 출근시각 time input(필수) / 퇴근시각 time input(선택, 비우면 근무중 상태로 생성)). 퇴근시각이 출근시각보다 이르면 자동으로 다음날로 계산(자정 넘김 대응). 목록엔 "근무일 YYYY-MM-DD · 직원명 · 현장명"(크게, text-base font-semibold) / 출퇴근 시각(작게, text-xs 회색) / 수정·삭제 버튼.
5. **정산** (`SettlementsTab.jsx`) — 월 선택 + "근무기록으로 정산 집계/갱신" 버튼. 카드마다 "직원명 · 현장명" + 상태뱃지 + 계산근거("8시간 × 12,000원 = 96,000원" 형식, `payBasisLabel()`) + "원천징수 3.3% -X원 → 지급액 Y원" + 다음 액션 버튼(권한 있을 때만: 매니저확정/대표승인/지급완료처리) + 삭제(최고관리자만).
6. **계정 관리** (`AccountsTab.jsx`, 최고관리자만 접근 — 메뉴에도 최고관리자한테만 보임) — 매니저/대표 계정만 여기서 생성(역할 선택 + 이름 + 아이디 + 비밀번호). 직원 계정은 여기서 안 만듦(직원 관리에서 전화번호 등록하면 자동).

### 용역자(직원) 메뉴
- **실제 탭은 "출퇴근" 하나뿐** (`ClockScreen.jsx`).
- **"내 근무내역"**, **"정산내역"**은 탭이 아니라 **팝업(Modal)으로 뜸** — 삼선메뉴에서 누르면 전체화면 팝업, X로 닫으면 출퇴근 화면으로 복귀.

#### ClockScreen.jsx (출퇴근 홈)
- 상태뱃지 (진하게 채색, 버튼 크기만큼 큼): 근무전=회색500, 근무중=파랑500, 근무완료=초록600, 흰 글씨.
- **근무전 상태일 때만** 현장 선택 드롭다운 노출(본인이 배치된 현장 중, 활성 현장만). 배치 현장이 1곳뿐이면 자동 선택. 근무중/근무완료 상태에선 선택된 현장명을 텍스트로만 표시.
- 출근/퇴근 버튼: 흰색 카드(border+shadow) 안에 세로로 2줄, 각 버튼 `w-1/2`(절반 폭, 가운데 정렬) × `h-[72px]`(고정 높이 — 시각 표시돼도 안 흔들림), 버튼 사이 간격 `gap-4`. 버튼 안에 "출근 기록" + 날짜·시각("7월 18일 오후 2:30" 형식, `formatDateTime()`) 두 줄.
- 각 버튼 옆(오른쪽)에 고정폭(`w-14`) 슬롯 — 취소 가능한 상태일 때만 "취소" 버튼 노출(자리는 항상 차지해서 정렬 안 틀어짐): 근무중일 때 출근 취소(기록 자체 삭제, 근무전으로 복귀) / 근무완료일 때 퇴근 취소(퇴근기록만 지우고 근무중으로 복귀).
- 근무완료 시 하단에 "오늘 근무시간: N시간" 표시.

#### MyWorkHistoryTab.jsx (내 근무내역 팝업)
- 월 선택 + 목록: "근무일 YYYY-MM-DD · 현장명"(크게) / 출퇴근 시각(작게, 회색) / N시간.

#### MySettlementHistoryTab.jsx (정산내역 팝업)
- 월 선택 + **현장별로 여러 카드**(한 직원이 여러 현장 근무 시 카드 여러 개): 현장명 + 상태뱃지 + 계산근거 + 원천징수/지급액.

## 8. 작업 진행 방식 (메모리에 등록된 규칙 — 반드시 따를 것)

- **[[feedback_build_first_iterate]]**: 세부 기획 대화보다 먼저 구현 → 결과 보고 → 수정하는 방식 선호. 이미 정해진 방향이면 세부사항까지 매번 확인받지 말고 합리적으로 판단해서 구현.
- **[[feedback_skip_browser_verification]]** (2026-07-21 확장판): "초기 단계"인 동안 **요청받은 작업만** 하고, **작업 범위도 검증도 사용자가 직접**. 코드 수정 후 `preview_logs`로 컴파일 에러 정도만 가볍게 확인, 실제 브라우저 클릭/로그인 등 기능 검증은 "검증해줘"라고 명시적으로 요청할 때만. 옆에서 개선점이 보여도 먼저 제안만 하고 승인 없이 범위 넓히지 말 것.
- **[[feedback_popup_style]]**: 팝업은 항상 `Modal.jsx` 스타일(딤+여백카드+우상단X) — 전 프로젝트 공통 규칙.
- **[[feedback_git_branch]]**: `pc-claude` 브랜치에서 작업, 커밋/머지/푸시는 명시적으로 요청할 때만.
- 배포도 "지금 바로 배포"처럼 명시적 요청이 있을 때 진행(첫 배포 전엔 Firestore 규칙 미비를 먼저 고지하고 진행 여부 확인했음).

## 9. 이 세션에서 있었던 주요 설계 번복 (다음 세션에서 예전 설계를 전제하지 말 것)

1. 로그인: **클린매니저 staffs 계정 재사용 시도 → 사용자가 "헷갈린다"고 거부 → attendance 전용 `attendance_accounts`로 전환**.
2. 직원 로그인: attendance_accounts에 `role='용역자'` 계정을 따로 만드는 방식으로 갔다가 → **다시 클린매니저 스타일(직원 등록=전화번호가 곧 아이디, 첫 로그인 시 비번 설정)로 회귀**. 지금은 이 방식이 최종.
3. 근무기록: "숫자로 시간 직접 입력" 방식 → **출퇴근 버튼(clockIn/clockOut 타임스탬프) 방식으로 완전 대체**.
4. UI 전체: 관리자용 가로탭 UI → **모바일 전용 고정폭 + 삼선메뉴 구조로 전면 개편**(용역자·관리자 화면 둘 다).
5. 급여: 시급 하나만 있던 것 → **시급/일급/주급/월급 선택 방식으로 확장**.
6. 정산 단위: 직원별 단일 정산 → **직원×현장별로 분리된 정산(사용자가 "B안" 명시적으로 선택)**.

## 10. 미해결 / 보류 중인 사항

- **Firestore 보안규칙 미설정** (위 1번 항목, 가장 중요).
- **주급/월급 + 다현장 근무 시 중복계산 가능성** (섹션 4 참고) — 실제로 그런 직원 생기면 프로레이션 로직 추가 필요.
- **자동배포(GitHub Actions) 미설정**.
- **근무기록 일괄(엑셀식/여러 명 한번에) 입력 — 논의만 하고 미결정.** 사용자가 "엑셀처럼 입력하면 복잡해지나?" 질문 → 완전 스프레드시트 방식은 복잡도 높다고 답변, 절충안으로 "날짜 하나+직원 여러명 체크+공통 시간 한번에 입력"하는 벌크 추가 방식을 제안해둔 상태. **어느 쪽으로 갈지 사용자 응답 대기 중** — 정확한 필요 시나리오(예: 한달치 스케줄 미리 입력)를 먼저 물어봐야 함.
- **테스트 계정 잔여물**: `attendance_accounts`에 `testadmin`/`testmgr`(비활성화 상태로 남아있음), `attendance_workers`에 `테스트작업자`(비활성 상태). 실사용 전 정리 고려.
- 클린매니저 본체와의 최종 통합(레포 합치기, UI 이식 등)은 아직 시작 안 함 — 지금은 완전히 별개 앱으로 병행 운영 중.

## 11. 관련 메모리 파일 (이 시스템의 memory 폴더)

- `project_clean_manager_attendance_tool.md` — 이 프로젝트의 전체 진행 기록(이 문서보다 시간순 상세 로그 위주).
- `project_attendance_business_rules.md` — 사업 구조(외주 용역자, 3.3%, 4대보험 미적용 등).
- `feedback_build_first_iterate.md`, `feedback_skip_browser_verification.md`, `feedback_popup_style.md`, `feedback_git_branch.md`, `feedback_clean_manager_name_spelling.md`(표기: 반드시 "클린매니저") — 작업 방식 규칙.
- `project_deployment_map.md` — 전체 프로젝트 배포 현황(이 프로젝트도 등록됨).
