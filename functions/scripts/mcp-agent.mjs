// 공용 MCP 관리자 스크립트 — 사람이 직접 실행한다 (AI가 실행하지 않음).
// 필요: Firebase 관리자 자격 (gcloud auth application-default login 또는 GOOGLE_APPLICATION_CREDENTIALS)
//
//   node scripts/mcp-agent.mjs list
//   node scripts/mcp-agent.mjs issue <agentId>        # 새 접속키 발급(기존 키는 즉시 무효). 키는 이때 한 번만 표시
//   node scripts/mcp-agent.mjs disable <agentId>      # 연결 끊기 (발급된 토큰도 바로 막힘)
//   node scripts/mcp-agent.mjs enable <agentId>
//   node scripts/mcp-agent.mjs deletions              # 대기 중인 삭제 요청
//   node scripts/mcp-agent.mjs approve <requestId>    # 삭제 요청 승인 = 실제 삭제 실행
//   node scripts/mcp-agent.mjs reject <requestId>
//
// agentId: chorong(초롱이·ChatGPT) harry(해리·Hermes) ari(아리·Claude) dexd(덱스D·Codex)
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createHash, randomBytes } from "node:crypto";

const DEFAULT_AGENTS = {
  chorong: { label: "초롱이", platform: "ChatGPT" },
  harry: { label: "해리", platform: "Hermes" },
  ari: { label: "아리", platform: "Claude" },
  dexd: { label: "덱스D", platform: "Codex 데스크톱" },
};
const DEFAULT_SCOPES = ["events:read", "events:write", "events:delete_request"];

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "clean-manager-60bc9" });
const db = getFirestore();
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const [cmd, arg] = process.argv.slice(2);
const now = () => new Date().toISOString();

async function main() {
  if (cmd === "list") {
    const snap = await db.collection("mcpAgents").get();
    snap.forEach((d) => { const a = d.data(); console.log(`${d.id}\t${a.label}\t${a.platform}\t${a.enabled === false ? "꺼짐" : "켜짐"}\t${(a.scopes || []).join(",")}`); });
    return;
  }
  if (cmd === "issue") {
    const base = DEFAULT_AGENTS[arg];
    const ref = db.doc(`mcpAgents/${arg}`);
    const cur = await ref.get();
    if (!base && !cur.exists) throw new Error(`알 수 없는 agentId: ${arg}`);
    const key = "cmk_" + randomBytes(24).toString("base64url");
    await ref.set({
      ...(cur.exists ? {} : { ...base, scopes: DEFAULT_SCOPES }),
      keyHash: sha(key), enabled: true, keyIssuedAt: now(),
    }, { merge: true });
    console.log(`[${arg}] 새 접속키 (지금만 표시됩니다 — 바로 해당 AI 설정에 넣고 이 창을 닫으세요):\n${key}`);
    return;
  }
  if (cmd === "disable" || cmd === "enable") {
    await db.doc(`mcpAgents/${arg}`).update({ enabled: cmd === "enable" });
    console.log(`[${arg}] ${cmd === "enable" ? "켜짐" : "꺼짐"}`);
    return;
  }
  if (cmd === "deletions") {
    const snap = await db.collection("mcpDeletionRequests").where("status", "==", "pending").get();
    snap.forEach((d) => { const r = d.data(); console.log(`${d.id}\t${r.eventStart}\t${r.eventTitle}\t${r.scope}${r.date ? " " + r.date : ""}\t${r.requestedBy?.label}\t${r.reason}`); });
    if (snap.empty) console.log("대기 중인 삭제 요청 없음");
    return;
  }
  if (cmd === "approve" || cmd === "reject") {
    const ref = db.doc(`mcpDeletionRequests/${arg}`);
    const snap = await ref.get();
    if (!snap.exists || snap.data().status !== "pending") throw new Error("대기 중인 요청이 아닙니다.");
    const r = snap.data();
    if (cmd === "approve") {
      const evRef = db.doc(`companies/${r.companyId}/events/${r.eventId}`);
      if (r.scope === "instance") await evRef.update({ [`exceptions.${r.date}`]: { _deleted: true } });
      else await evRef.delete();
    }
    await ref.update({ status: cmd === "approve" ? "approved" : "rejected", decidedAt: now() });
    console.log(`요청 ${arg}: ${cmd === "approve" ? "승인·삭제 완료" : "거절"}`);
    return;
  }
  console.log("사용법은 파일 맨 위 주석 참고");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
