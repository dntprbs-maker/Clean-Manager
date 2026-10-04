// refresh token 암호화 + 비밀값 비교 도우미.
// refresh token은 서버 전용 컬렉션(gcalCredentials)에 저장하지만, 보안 규칙 설정 실수에 대비해
// Secret Manager에 있는 별도 키(GCAL_TOKEN_KEY)로 한 번 더 암호화해 둔다(AES-256-GCM).
import crypto from "node:crypto";
import { Buffer } from "node:buffer";

function keyFrom(secret) {
  const raw = String(secret || "").trim();
  if (!raw) throw new Error("GCAL_TOKEN_KEY가 설정되어 있지 않습니다.");
  // 32바이트 base64 키를 권장하지만, 어떤 문자열이 와도 SHA-256으로 32바이트 키를 만든다.
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}

export function decryptSecret(box, secret) {
  if (!box || box.v !== 1) throw new Error("암호화된 토큰 형식이 올바르지 않습니다.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(box.ct, "base64")), decipher.final()]).toString("utf8");
}

export const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

// 길이와 무관하게 상수 시간 비교(해시 후 비교)
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return crypto.timingSafeEqual(Buffer.from(sha256(a), "hex"), Buffer.from(sha256(b), "hex"));
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
