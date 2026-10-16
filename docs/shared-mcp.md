# 클린매니저 공용 MCP — AI 연결 · 배포 · 검증 런북

> 상태: **코드·자동 테스트 완료, 운영 배포 전.** (브랜치 `claude/shared-mcp-agents`)
> 서버는 하나(`/mcp`), AI마다 **접속키**를 따로 발급해 누가 무엇을 했는지 구분합니다.
> 구글 캘린더 동기화 코드는 손대지 않았습니다(구글 → 앱 읽기 전용 그대로).

## 1. 주소

| 항목 | 값 |
|---|---|
| MCP 주소 (Streamable HTTP) | `https://clean-manager-60bc9.web.app/mcp` |
| OAuth 메타데이터 | `https://clean-manager-60bc9.web.app/.well-known/oauth-authorization-server` |
| 인증 방식 | ① OAuth 2.1 + PKCE (로그인 화면에 접속키 입력) ② `Authorization: Bearer <접속키>` 고정 헤더 |

## 2. AI별 권한

| AI | agentId | 연결 방식 | 기본 권한 |
|---|---|---|---|
| 초롱이 (ChatGPT) | `chorong` | OAuth (커넥터) | 조회·검색·등록·수정·삭제요청 |
| 해리 (Hermes) | `harry` | OAuth(`auth: oauth`) 또는 `headers` | 〃 |
| 아리 (Claude) | `ari` | OAuth (claude.ai 커넥터) | 〃 |
| 덱스D (Codex 데스크톱) | `dexd` | `bearer_token_env_var` 또는 `codex mcp login` | 〃 |
| 기존 패스프레이즈 연결 | `owner` | OAuth | 위 + 직원·팀 관리(admin) — **하위 호환용** |

- **삭제:** AI는 `request_event_deletion`(요청 등록)만 가능합니다. 일정은 그대로 남고, 관리자가 `node scripts/mcp-agent.mjs approve <요청ID>`를 직접 실행해야 실제 삭제됩니다. 기존 `delete_event` 도구는 없앴습니다.
- **시험 일정:** `create_event`에 `test: true` → 제목 앞에 `[MCP시험]`, `mcpTest: true` 저장, **직원 푸시 알림 안 보냄**. `search_events`의 `onlyTest: true`로 시험 일정만 찾을 수 있습니다.
- 등록·수정 시 `mcpCreatedBy` / `mcpUpdatedBy`(AI 이름·시각)를 일정 문서에 남깁니다.
- 권한 없는 도구는 그 AI의 도구 목록에 아예 안 보입니다. AI를 끄면(`disable`) 이미 발급된 토큰도 즉시 막힙니다.

도구: `list_events`, `search_events`, `get_event`, `create_event`, `update_event`, `request_event_deletion`, `list_teams` (+ owner 전용 직원·팀 관리 도구)

## 3. 배포 전 필수 — Firestore 규칙 (승인 필요)

### 실측 결과 (2026-10-16, 비인증 REST 집계 쿼리 — 읽기만, 문서 내용은 조회 안 함)
| 컬렉션 | 비인증 접근 |
|---|---|
| `mcpOAuthTokens` (10건) · `mcpOAuthClients` (9건) · `mcpOAuthCodes` (1건) · `mcpAgents` | **읽기 허용** |
| `gcalConfig` · `gcalCredentials` | 403 차단 (정상) |

쓰기는 시험하지 않았지만 같은 규칙 줄이 적용되므로 쓰기도 열려 있다고 봐야 합니다. 그러면 누구나 `mcpOAuthTokens/{임의값의 SHA-256}` 문서를 만들어 **owner 권한 MCP 토큰을 스스로 만들 수 있습니다**(직원·팀 관리 포함). 기존 MCP에서도 이미 같은 상태입니다.

### 바꿀 규칙 (전체)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // gcal*: 구글 캘린더 동기화 서버 전용 / mcp*: 공용 MCP 서버 전용 (Admin SDK는 규칙 무시)
    match /{col}/{document=**} {
      allow read, write: if !col.matches('(gcal|mcp).*');
    }
  }
}
```
- 영향: 앱 본체·`attendance/`·위젯 코드는 `mcp*` 컬렉션을 쓰지 않음(코드 검색 확인). Cloud Functions(MCP·동기화)는 Admin SDK라 규칙 영향 없음.
- **남는 위험(이번 범위 밖):** `companies/*`, `staffs`, `admins` 등 업무 데이터 전체가 여전히 비로그인 읽기·쓰기 허용입니다. 앱이 Firebase 로그인을 안 쓰는 구조라 생긴 문제로, 막으려면 앱 인증 구조 변경이 필요합니다.

### 백업·복구
1. 변경 전: Firebase 콘솔 → Firestore → 규칙 탭의 현재 규칙 전체를 복사해 보관 (콘솔 "규칙 기록"에도 이전 버전이 남음)
2. 변경 후 확인: 앱 일정 조회·등록·수정·삭제 1회씩, 그리고 아래 명령이 `mcp*`는 403, `companies` 조회는 계속 200인지 확인
3. 문제 시: 규칙 기록에서 이전 버전 선택 → 게시 (즉시 원복)

## 4. 배포 · 검증 순서

1. 위 규칙 변경 (영향: 앱 화면엔 없음 — 앱 코드는 `mcp*` 컬렉션을 쓰지 않음)
2. `firebase deploy --only functions:mcp,functions:sendEventNotification,functions:sendEventUpdateNotification,functions:sendEventDeleteNotification`
   - 기존 Claude 커넥터(패스프레이즈)는 그대로 동작해야 함 → 배포 후 기존 연결로 `list_events` 1회 확인
3. 접속키 발급: `cd functions && node scripts/mcp-agent.mjs issue chorong` (키는 한 번만 표시 — 채팅·문서에 붙여넣지 말 것)
4. 초롱이 연결 → 시험 일정 등록 → 웹앱에서 표시 확인 → 수정 확인
5. 해리·아리·덱스D 순서로 같은 확인

## 5. AI별 연결 방법

### 초롱이 — ChatGPT (가장 먼저)
1. ChatGPT 설정 → 앱/커넥터 → (개발자 모드 켜기) → 새 커넥터 만들기
2. MCP 서버 URL: `https://clean-manager-60bc9.web.app/mcp`, 인증: **OAuth**
3. 연결 누르면 "크린매니저 연결 승인" 화면 → `chorong` 접속키 입력
4. 시험 지시 예: "클린매니저에 10월 22일 오전 10~11시 '연결 확인' 시험 일정을 test=true로 등록해줘"
- ChatGPT 콜백 주소(`https://chatgpt.com/connector/oauth/…`, 예전 `…/connector_platform_oauth_redirect`)는 서버 허용 목록에 넣어뒀습니다. 커넥터 화면에 다른 콜백이 보이면 알려주세요.

### 해리 — Hermes (`~/.hermes/config.yaml`)
```yaml
mcp_servers:
  clean-manager:
    url: https://clean-manager-60bc9.web.app/mcp
    auth: oauth          # 이후 `hermes mcp login clean-manager` → 브라우저에 harry 접속키 입력
    # 또는 OAuth 대신 고정 헤더:
    # headers:
    #   Authorization: "Bearer ${CLEAN_MANAGER_KEY}"
```

### 아리 — Claude
claude.ai 설정 → 커넥터 → 사용자 지정 커넥터 추가 → URL 입력 → 승인 화면에서 `ari` 접속키 입력.
(이미 패스프레이즈로 연결된 커넥터가 있다면 그건 owner 권한입니다. 아리 전용으로 쓰려면 연결 해제 후 `ari` 키로 다시 연결)

### 덱스D — Codex 데스크톱 (`~/.codex/config.toml`)
```toml
[mcp_servers.clean-manager]
url = "https://clean-manager-60bc9.web.app/mcp"
bearer_token_env_var = "CLEAN_MANAGER_KEY"   # 환경변수에 dexd 접속키
```
또는 `bearer_token_env_var` 없이 두고 `codex mcp login clean-manager`로 OAuth.

## 6. 관리 명령 (`functions/scripts/mcp-agent.mjs`, 사람이 실행)

`list` · `issue <id>` · `disable <id>` · `enable <id>` · `deletions` · `approve <요청ID>` · `reject <요청ID>`
