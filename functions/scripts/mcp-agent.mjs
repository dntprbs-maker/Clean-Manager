// 공용 MCP 관리자 스크립트 — 사람이 직접 실행한다 (AI가 실행하지 않음).
// 필요: Firebase 관리자 자격 (gcloud auth application-default login 또는 GOOGLE_APPLICATION_CREDENTIALS)
//
//   node scripts/mcp-agent.mjs list
//   node scripts/mcp-agent.mjs issue <agentId>        # 새 접속키 발급(기존 키는 즉시 무효). 키는 이때 한 번만 표시
//   node scripts/mcp-agent.mjs issue jian --display-local # 새 지안만 발급, 키는 크롬의 임시 로컬 화면에만 표시
//   node scripts/mcp-agent.mjs disable <agentId>      # 연결 끊기 (발급된 토큰도 바로 막힘)
//   node scripts/mcp-agent.mjs enable <agentId>
//   node scripts/mcp-agent.mjs deletions              # 대기 중인 삭제 요청
//   node scripts/mcp-agent.mjs approve <requestId>    # 삭제 요청 승인 = 실제 삭제 실행
//   node scripts/mcp-agent.mjs reject <requestId>
//
// agentId: chorong(초롱이·ChatGPT) jian(지안) harry(해리·Hermes) ari(아리·Claude) dexd(덱스D·Codex)
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createHash, randomBytes } from "node:crypto";
import { prepareLocalKeyDisplay } from "./local-key-display.mjs";

const DEFAULT_AGENTS = {
  chorong: { label: "초롱이", platform: "ChatGPT" },
  jian: { label: "지안", platform: "ChatGPT" },
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
    const localDisplay = process.argv.includes("--display-local");
    if (localDisplay && arg !== "jian") throw new Error("로컬 발급은 jian만 허용합니다.");
    const base = DEFAULT_AGENTS[arg];
    const ref = db.doc(`mcpAgents/${arg}`);
    const cur = await ref.get();
    if (localDisplay && cur.exists) throw new Error("jian이 이미 존재합니다. 기존 키를 변경하지 않습니다.");
    if (!base && !cur.exists) throw new Error(`알 수 없는 agentId: ${arg}`);
    const otherAgents = async () => {
      const snap = await db.collection("mcpAgents").get();
      return sha(JSON.stringify(snap.docs.filter(d => d.id !== "jian").map(d => [d.id, d.data()]).sort((a,b) => a[0].localeCompare(b[0]))));
    };
    const before = localDisplay ? await otherAgents() : null;
    const display = localDisplay ? await prepareLocalKeyDisplay({ onDelivered: () => console.log("크롬 로컬 화면으로 키 전달 확인.") }) : null;
    const key = "cmk_" + randomBytes(24).toString("base64url");
    try {
      const data = {
        ...(cur.exists ? {} : { ...base, scopes: DEFAULT_SCOPES }),
        keyHash: sha(key), enabled: true, keyIssuedAt: now(),
      };
      // 원자적 신규 생성으로 동시에 등록된 기존 키의 덮어쓰기도 방지한다.
      if (localDisplay) await ref.create(data);
      else await ref.set(data, { merge: true });
      if (display) {
        const saved = (await ref.get()).data();
        if (saved.label !== "지안" || saved.keyHash !== sha(key) || saved.enabled !== true || JSON.stringify(saved.scopes) !== JSON.stringify(DEFAULT_SCOPES)) throw new Error("지안 저장 검증 실패");
        if (await otherAgents() !== before) throw new Error("다른 agent 변경이 감지됐습니다. 확인이 필요합니다.");
        display.show(key);
        console.log("지안 키 발급·권한 재조회 완료. 다른 agent 변경 없음. 키는 크롬 로컬 화면에만 표시됩니다.");
        try {
          const response = await fetch("https://clean-manager-60bc9.web.app/mcp", {
            method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), signal: AbortSignal.timeout(30_000),
          });
          const result = await response.json();
          const names = result.result?.tools?.map(t => t.name) || [];
          const required = ["list_events", "search_events", "create_event", "update_event", "request_event_deletion"];
          const forbidden = ["delete_event", "create_staff", "update_staff", "delete_staff", "create_team", "update_team", "delete_team"];
          if (!response.ok || !required.every(n => names.includes(n)) || forbidden.some(n => names.includes(n))) throw new Error();
          console.log("운영 MCP 키 인증·도구 목록 검증 통과: 조회·검색·등록·수정·삭제요청, 관리자·실삭제 권한 없음.");
        } catch { console.log("운영 MCP 도구 목록 검증 미통과. 키는 발급됐으며 로컬 화면에서 확인 가능합니다."); }
      } else {
        console.log(`[${arg}] 새 접속키 (지금만 표시됩니다 — 바로 해당 AI 설정에 넣고 이 창을 닫으세요):\n${key}`);
      }
    } catch (error) { display?.stop(); throw error; }
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
