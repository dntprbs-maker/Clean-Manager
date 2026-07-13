import { defineSecret } from "firebase-functions/params";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// index.js가 항상 먼저 initializeApp()을 호출하지만, 이 모듈이 단독으로(테스트 등) 로드될
// 가능성을 대비해 방어적으로 한 번 더 체크 (Firebase Admin SDK는 중복 호출을 허용하지 않음).
if (getApps().length === 0) initializeApp();

export const REGION = "asia-northeast3";

// MCP 커넥터가 항상 동작하는 고정 회사(단일 테넌트) + 로그인 게이트용 패스프레이즈.
// 기존 OPENROUTER_API_KEY와 동일하게 Secret Manager로 관리 (firebase functions:secrets:set).
export const MCP_COMPANY_ID = defineSecret("MCP_COMPANY_ID");
export const MCP_PASSPHRASE = defineSecret("MCP_PASSPHRASE");

// DCR 클라이언트(public client의 client_secret 등)처럼 undefined 필드가 자연스럽게 섞여
// 들어오는 객체를 그대로 Firestore에 쓸 일이 많아서, Admin SDK 기본값(undefined 필드면 예외)
// 대신 무시하도록 전역 설정. Firestore 인스턴스가 실제로 쓰이기 전에(콜드 스타트 중, 모듈
// 로드 시점) 딱 한 번만 호출해야 하므로 지연 초기화하지 않고 여기서 즉시 실행.
const _db = getFirestore();
_db.settings({ ignoreUndefinedProperties: true });
export function getDb() {
  return _db;
}
