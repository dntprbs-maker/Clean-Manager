# 📋 작업 현황 (정기청소 출퇴근 관리 — attendance/)

> 클린매니저 본체 할 일은 레포 루트 `TODO.md` 참고.
> 프로젝트 전체 맥락은 `attendance/HANDOFF.md`, 초기 기획은 `attendance/PLAN.md` 참고.

---

## 🔴 미해결

- [ ] **UI 전면 리디자인 실기기 검증 안 됨** — 커밋은 됐지만(790a406) 동작 검증을 거치지 않은 상태. 특히 하단 탭바 전환·devMode 빠른 로그인은 실제로 눌러보고 확인 필요 (등록: 2026-08-07)
- [ ] **Firestore 보안규칙 잠그기 (보류 중)** — 현재 규칙이 열려있어 주소를 아는 사람은 로그인 없이 데이터 접근 가능. Cloud Function 로그인 검증 + 커스텀 토큰 방식으로 설계까지 완료했으나, **사용자 검증이 끝날 때까지 보류하기로 결정(2026-07-21)**. 재개 시 주의: 클린매니저 본체 규칙(콘솔에서만 관리됨)을 먼저 확보해서 합쳐 배포해야 함 — attendance만 담긴 규칙 파일 단독 배포 시 본체 서비스 먹통 위험. **실사용(진짜 급여 데이터) 전 반드시 처리할 것.**
- [ ] **월 선택 UI 변경 (논의 대기)** — 내 작업내역/정산내역 등에서 쓰는 브라우저 기본 `<input type="month">`가 브라우저마다 UI가 달라 보임(크롬은 달력그리드). "◀ 2026년 7월 ▶" 화살표 전/후 전환 UI로 교체 검토 중 — 나중에 다시 논의 후 진행. (2026-07-28)
- [ ] **근무기록 일괄 입력 방식 미결정 (사용자 응답 대기)** — "엑셀처럼 여러 명 한번에 입력" 논의 중. 완전 스프레드시트 방식은 복잡도가 높다고 답변했고, 절충안으로 "날짜 하나 + 직원 여러명 체크 + 공통 시간 한번에 입력"하는 벌크 추가 방식을 제안해둔 상태. 진행 전 정확한 필요 시나리오(예: 한달치 스케줄 미리 입력)를 먼저 확인할 것.
- [ ] **주급/월급 + 다현장 근무 시 중복계산 가능성** — 정산이 "용역자 × 현장" 단위라, 주급/월급 직원이 같은 달에 두 현장을 오가면 각 현장에서 "일한 주/달"로 각각 카운트돼 사실상 중복 지급처럼 계산될 수 있음. 드문 케이스라 보류, 실제 발생하면 근무일수 비율 배분(프로레이션) 로직 추가 필요.
- [ ] **자동배포(GitHub Actions) 미설정** — 계속 수동 배포 중. 필요하면 클린매니저/다인이벤트처럼 `firebase init hosting:github`로 추가 가능.
- [ ] **테스트 계정 잔여물 정리** — `attendance_accounts`에 `testadmin`/`testmgr`(비활성), `attendance_workers`에 `테스트작업자`(비활성) 남아있음. 실사용 전 정리 고려.
- [ ] **클린매니저 본체와의 최종 통합** — 아직 시작 안 함. 현재는 완전 별개 앱으로 병행 운영 중.

## ✅ 완료 로그

- [x] UI 전면 리디자인 — webdesigner 에이전트로 화면별 HTML 시안을 뽑아 실제 컴포넌트에 반영. 용역자 화면 "삼선메뉴+팝업" → **하단 탭바**(홈/내 작업내역/정산내역/로그아웃) 구조 전환, 관리자 6개 탭 화면 개편, 로직 훅 분리(`useWorkLog.js`, `useMyWorkHistory.js`), 개발용 빠른 로그인(`devMode.js` — `npm run dev`+`?dev=1`일 때만 동작, 운영 빌드 강제 비활성), `lucide-react` 추가. 변경 규모 20파일 +885/-344 — 완료: 2026-08-07(작업은 07-27~28), 커밋 790a406
- [x] 출퇴근 툴 커밋 + main 머지 — 그동안 미커밋으로 쌓여있던 전체를 커밋. firebase.json 멀티사이트(main/attendance) 전환 여파로 GitHub Actions 자동배포가 실패하는 문제 발견 → 워크플로에 `target: main` 지정으로 수정 — 완료: 2026-07-20, 커밋 a8cd510/c871aed

---

## 📌 참고 (자주 쓰는 정보)

- **로컬 개발**: `attendance/` 폴더에서 `npm run dev` → 포트 **5176** (클린매니저 5173, clean-member 5174, 다인이벤트 5175와 분리). `.claude/launch.json`에 `attendance-dev`로 등록됨.
- **배포 주소**: https://clean-manager-attendance.web.app
- **배포 명령** (수동):
  ```
  cd attendance && npm run build
  npx firebase-tools deploy --only hosting:attendance --project clean-manager-60bc9
  ```
  (deploy는 레포 루트에서 실행)
- **Firestore 컬렉션**: `attendance_workers`, `attendance_sites`, `attendance_workLogs`, `attendance_settlements`, `attendance_accounts` (클린매니저와 같은 Firebase 프로젝트 `clean-manager-60bc9` 공유, 접두사로 분리)
- **작업 브랜치**: `pc-claude` (커밋/머지/푸시는 명시적 요청 시에만)
