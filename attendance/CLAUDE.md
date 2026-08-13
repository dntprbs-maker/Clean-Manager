# attendance/ 프로젝트 안내

> 이 파일은 AI 코딩 도구가 이 폴더를 빠르게 이해하도록 돕는 안내서입니다.
> 작업하다 규칙이 생기면 한 줄씩 자유롭게 추가하세요.

## 이 프로젝트가 뭔가요

정기청소 외주 용역자 출퇴근·급여 정산 관리 툴입니다. 같은 레포 안에 있지만
**클린매니저 본체와는 화면 구조·데이터가 완전히 다른 별도 앱**입니다 —
클린매니저는 사장·직원용 일정 캘린더이고, 이 앱은 용역자 출퇴근 체크 + 정산
승인 흐름이라 성격 자체가 다른 부서(사업)의 도구입니다.

- 완전히 독립된 Vite 프로젝트(별도 `package.json`, `vite.config`, 별도 dev 포트 5176)
- 같은 Firebase 프로젝트(`clean-manager-60bc9`)를 공유하지만, Firestore 컬렉션은
  `attendance_` 접두사로 클린매니저 기존 컬렉션과 완전히 분리(`attendance_workers`,
  `attendance_workLogs`, `attendance_settlements`, `attendance_sites`, `attendance_accounts`)
- 로그인 체계도 클린매니저와 별개(자체 `attendance_accounts`)

**나중에 완전히 별개 사업으로 분리될 수도 있습니다.** 지금은 같은 레포 안에 폴더로만
구분해뒀지만, 이미 독립 폴더 구조라 나중에 이 폴더를 통째로 복사해서 새 레포로
떼어내는 것도 어렵지 않습니다. 반대로 클린매니저와 로그인·조직 데이터를 합칠 계획이
생기면 그때 통합 작업을 하면 됩니다 — 지금 구조가 어느 방향으로든 선택지를 막지 않습니다.

## 프로젝트 세부 정보

전체 맥락(사업 구조, 데이터 모델, 배포 방법 등)은 [`attendance/HANDOFF.md`](HANDOFF.md),
초기 기획 배경은 [`attendance/PLAN.md`](PLAN.md) 참고.

## 할 일

> 할 일 목록은 [`attendance/TODO.md`](TODO.md)에서 관리합니다 (클린매니저 본체 TODO와 분리).
