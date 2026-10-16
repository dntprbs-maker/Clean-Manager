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

현재 운영 규칙은 `gcal*`만 막고 나머지 컬렉션은 **비로그인 클라이언트도 읽기/쓰기 허용**입니다. 그래서 `mcpAgents`(접속키 해시), `mcpOAuthTokens`(토큰 해시)에 누군가 문서를 직접 써 넣으면 **스스로 접속 권한을 만들 수 있습니다** (기존 MCP도 이미 같은 위험 상태).
콘솔에서 아래처럼 바꿔야 합니다 (`mcp`로 시작하는 컬렉션은 서버(Admin SDK) 전용 — 앱은 `mcp*`를 쓰지 않음):

```
match /{col}/{document=**} {
  allow read, write: if !col.matches('(gcal|mcp).*');
}
```

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
