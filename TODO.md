# 📋 작업해야 할 항목 (Backlog)

---

## 🔥 1순위 — Firebase 연동 완성

- [ ] **Firebase 프로젝트 연동 확인 (Antigravity 작업분)**
  - `npm run dev` 로 로컬에서 Firestore 실시간 동기화 확인
  - 일정/공지/링크 데이터가 실제로 Firestore에 저장되는지 테스트
  - feature/smartphone-claude → main merge

- [ ] **Firebase Auth 실제 연결**
  - Google 로그인 → 실제 Firebase Auth 연동
  - 직원 로그인 → Firebase Auth 이메일/비밀번호 방식
  - 로그인 상태 유지 (앱 재시작해도 로그인 유지)

---

## 🏢 2순위 — SaaS 멀티테넌시 구조 설계

- [ ] **회원가입 플로우 구현**
  - Google 로그인 후 DB에 없는 계정 → 회원가입 화면으로 이동
  - 회사명 입력 필수
  - 회사 로고 업로드 (선택)
  - 가입 완료 → 앱 진입

- [ ] **Firestore 멀티테넌시 구조 변경**
  ```
  companies/
    └─ {companyId}/
         ├─ name: "크린드림"
         ├─ logo: "로고 URL"
         ├─ ownerId: "사장님 Gmail"
         └─ users/ events/ notices/ links/ ...
  ```
  - 각 업체가 자기 회사 데이터만 볼 수 있도록 분리
  - companyId 기반으로 모든 데이터 격리

- [ ] **앱 내 회사 브랜딩**
  - 상단 헤더에 회사 로고 표시
  - 회사명 표시 (예: 크린드림)
  - 직원 이름 + 역할 표시

---

## 📌 3순위 — 기능 완성

- [ ] **현장 완료 보고 실제 기능 연결**
  - 청소 전/후 사진 → Cloudflare R2 실제 업로드
  - 완료 보고 데이터 → Firestore 저장
  - 사장님 대시보드에 완료 현장 카드 표시

- [ ] **실시간 전 직원 동기화**
  - 일정 등록/수정/삭제 → 전 직원 기기 즉시 반영

- [ ] **푸시 알림 (FCM)**
  - 일정 등록/수정 시 해당 팀원 스마트폰 알림

- [ ] **사진 스토리지**
  - Cloudflare R2 연동 ($0.015/GB, 다운로드 무료)
  - 목표 용량: 1TB

---

## 🎨 목업 완성 → 실제 연결 필요한 화면

- [ ] 현장 완료 보고 — 사진 업로드, 데이터 저장
- [ ] 대시보드 — 완료 현장 카드, 실제 매출 집계
- [ ] 공지사항 — Firestore 저장/조회
- [ ] 최근 변경 로그 — Firestore 저장
- [ ] 외부 링크 — Firestore 저장 (앱 껐다 켜도 유지)
- [ ] 직원 관리 — Firestore 저장
- [ ] 로그인 — Firebase Auth 실제 연결
