// 운영자용 관리 페이지(gcalAdmin 함수) — 구글 계정 연결(OAuth), 전역/캘린더별 켜기·끄기, 상태 확인.
// 이 앱은 Firebase Auth 대신 자체 로그인을 써서 서버가 "누가 사장인지"를 믿을 수 없으므로,
// MCP 연결 승인 화면(mcp/oauth/login.js)과 같은 방식으로 Secret Manager의 패스프레이즈로만 보호한다.
// 모든 변경 동작은 POST + 패스프레이즈 필수.
import { COL } from "./config.js";
import { safeEqual } from "./crypto.js";
import {
  startOAuth, finishOAuth, enableCalendar, disableCalendar, setGlobalPush, calendarIdFromIcsUrl,
} from "./service.js";
import { syncCalendar } from "./syncEngine.js";
import { isGlobalPushEnabled } from "./store.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
const fmt = (v) => (v ? new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-");

// 함수 URL(…/gcalAdmin)은 끝에 "/"가 없어 상대 경로가 엉뚱한 곳을 가리키므로 <base>로 고정
let BASE = "";
function page(title, body) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${BASE ? `<base href="${esc(BASE)}/">` : ""}
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f4f6;margin:0;padding:16px;color:#111827}
.card{background:#fff;border-radius:12px;padding:20px;max-width:760px;margin:0 auto 16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:18px;margin:0 0 12px}h2{font-size:15px;margin:0 0 8px}
p,li{font-size:14px;color:#374151}input{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin:4px 0 10px}
button{padding:8px 12px;border:none;border-radius:8px;background:#111827;color:#fff;font-size:13px;font-weight:600;cursor:pointer;margin:2px}
button.warn{background:#b91c1c}button.ok{background:#1d4ed8}
table{width:100%;border-collapse:collapse;font-size:12px}td,th{border-bottom:1px solid #e5e7eb;padding:6px;text-align:left;vertical-align:top}
.err{color:#b91c1c}.muted{color:#6b7280;font-size:12px}form.inline{display:inline}
</style></head><body>${body}</body></html>`;
}

const pwField = (pw) => `<input type="hidden" name="passphrase" value="${esc(pw)}">`;
const actionForm = (pw, action, fields, label, cls = "") =>
  `<form class="inline" method="post" action="${action}">${pwField(pw)}${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("")}<button class="${cls}">${esc(label)}</button></form>`;

function loginPage(error) {
  return page("구글 캘린더 실시간 동기화 관리", `<div class="card"><h1>구글 캘린더 실시간 동기화 관리</h1>
<form method="post" action="status">${error ? `<p class="err">${esc(error)}</p>` : ""}
<input type="password" name="passphrase" placeholder="관리 패스프레이즈" autofocus required><button>들어가기</button></form></div>`);
}

async function statusPage(deps, pw, notice) {
  const { db } = deps;
  const globalOn = await isGlobalPushEnabled(db);
  const calsSnap = await db.collection(COL.calendars).get();
  const rows = calsSnap.docs.map((d) => {
    const s = d.data();
    return `<tr><td><b>${esc(s.companyId)}</b> / ${esc(s.calId)}<br><span class="muted">${esc(s.googleCalendarId)}</span></td>
<td>${s.enabled ? "✅ 켜짐" : "⏸ 꺼짐"}${s.needsReauth ? "<br><span class='err'>재연결 필요</span>" : ""}</td>
<td>성공: ${fmt(s.lastSuccessAt)}<br>전체: ${fmt(s.lastFullSyncAt)}<br>채널 만료: ${fmt(s.channelExpiresAt)}
${s.lastError ? `<br><span class="err">오류(${fmt(s.lastErrorAt)}): ${esc(s.lastError)}</span>` : ""}</td>
<td>${s.enabled
    ? actionForm(pw, "disable", { key: d.id }, "끄기(ICS로 복귀)", "warn") + actionForm(pw, "resync", { key: d.id }, "전체 재동기화") + actionForm(pw, "resync", { key: d.id, force: "1" }, "강제(대량삭제 허용)", "warn")
    : actionForm(pw, "enable", { key: d.id }, "켜기", "ok")}</td></tr>`;
  }).join("");

  // 연결 후보: 구글 iCal 구독 주소가 저장된 팀 캘린더(회사 ID/팀 ID를 찾기 쉽게)
  const companies = await db.collection("companies").get();
  const candidates = [];
  for (const c of companies.docs) {
    if (c.data()?.status === "deleted") continue;
    const cals = await db.collection(`companies/${c.id}/cals`).get();
    for (const cal of cals.docs) {
      const gid = calendarIdFromIcsUrl(cal.data()?.icsSubscriptionUrl);
      if (gid) candidates.push({ companyId: c.id, companyName: c.data()?.name, calId: cal.id, calName: cal.data()?.name, gid });
    }
  }
  const candRows = candidates.map((c) => `<tr><td>${esc(c.companyName || c.companyId)}<br><span class="muted">${esc(c.companyId)}</span></td>
<td>${esc(c.calName)}<br><span class="muted">${esc(c.calId)}</span></td><td class="muted">${esc(c.gid)}</td>
<td>${actionForm(pw, "connect", { companyId: c.companyId, calId: c.calId, googleCalendarId: c.gid }, "구글 계정 연결")}</td></tr>`).join("");

  return page("구글 캘린더 실시간 동기화 관리", `
${notice ? `<div class="card"><p>${notice}</p></div>` : ""}
<div class="card"><h1>전역 스위치: ${globalOn ? "✅ 켜짐" : "⏸ 꺼짐(모든 팀이 기존 ICS 방식)"}</h1>
${globalOn ? actionForm(pw, "global", { enabled: "0" }, "전역 끄기(즉시 ICS로 복귀)", "warn") : actionForm(pw, "global", { enabled: "1" }, "전역 켜기", "ok")}
<p class="muted">전역 스위치와 팀별 스위치가 둘 다 켜진 팀만 실시간 동기화를 쓰고, 나머지는 기존 6시간 ICS 동기화가 그대로 돕니다.</p></div>
<div class="card"><h2>연결된 팀 캘린더</h2><table><tr><th>회사/팀</th><th>상태</th><th>동기화</th><th>동작</th></tr>${rows || "<tr><td colspan=4>없음</td></tr>"}</table></div>
<div class="card"><h2>연결 후보 (구글 iCal 구독 주소가 있는 팀)</h2><table><tr><th>회사</th><th>팀</th><th>구글 캘린더 ID</th><th></th></tr>${candRows || "<tr><td colspan=4>없음</td></tr>"}</table></div>
<div class="card"><h2>직접 연결</h2><form method="post" action="connect">${pwField(pw)}
<input name="companyId" placeholder="회사 ID (companies 문서 ID)" required>
<input name="calId" placeholder="팀 캘린더 ID (cals 문서 ID)" required>
<input name="googleCalendarId" placeholder="구글 캘린더 ID (예: xxx@group.calendar.google.com, 비우면 iCal 주소에서 추출)">
<button>구글 계정 연결</button></form></div>`);
}

// req: { method, path, body, query }  →  { status, html?, redirect? }
export async function handleAdmin(deps, req) {
  const { passphrase } = deps;
  BASE = deps.adminBaseUrl || "";
  const path = "/" + String(req.path || "/").split("/").filter(Boolean).pop();
  try {
    if (req.method === "GET" && path === "/callback") {
      if (req.query?.error) return { status: 400, html: page("연결 실패", `<div class="card"><h1>연결이 취소되었습니다</h1><p>${esc(req.query.error)}</p></div>`) };
      const r = await finishOAuth(deps, { code: req.query?.code, state: req.query?.state });
      return { status: 200, html: page("연결 완료", `<div class="card"><h1>✅ 구글 계정 연결 완료</h1>
<p>${esc(r.companyId)} / ${esc(r.calId)} ← ${esc(r.googleCalendarId)}</p>
<p>아직 <b>꺼진 상태</b>입니다(기존 ICS 동기화 유지). 관리 페이지로 돌아가 "켜기"를 눌러야 실시간 동기화가 시작됩니다.</p>
<p><a href="./">관리 페이지로</a></p></div>`) };
    }
    if (req.method !== "POST") return { status: 200, html: loginPage() };

    const body = req.body || {};
    if (!passphrase || !safeEqual(String(body.passphrase || ""), passphrase)) {
      await new Promise((r) => setTimeout(r, 800)); // 무차별 대입 속도 늦추기
      return { status: 401, html: loginPage("패스프레이즈가 올바르지 않습니다.") };
    }
    const pw = body.passphrase;
    let notice = "";
    if (path === "/connect") {
      const r = await startOAuth(deps, { companyId: String(body.companyId || "").trim(), calId: String(body.calId || "").trim(), googleCalendarId: body.googleCalendarId });
      return { status: 303, redirect: r.url };
    } else if (path === "/global") {
      await setGlobalPush(deps.db, body.enabled === "1");
      notice = body.enabled === "1" ? "전역 스위치를 켰습니다. 팀별로 '켜기'를 눌러야 실제로 시작됩니다." : "전역 스위치를 껐습니다. 다음 ICS 자동 동기화(6시간 주기)부터 예전 방식으로 동작합니다.";
    } else if (path === "/enable") {
      const r = await enableCalendar(deps, String(body.key));
      notice = `켜기 완료 — 채널 ${esc(r.channel?.id || "")}, 동기화 ${esc(r.sync?.status)}${r.sync?.error ? ` (${esc(r.sync.error)})` : ""}`;
    } else if (path === "/disable") {
      await disableCalendar(deps, String(body.key));
      notice = "껐습니다. 일정 데이터는 그대로이며, 다음 ICS 자동 동기화부터 예전 방식으로 갱신됩니다(앱의 '저장하고 지금 동기화'로 즉시 실행 가능).";
    } else if (path === "/resync") {
      const force = body.force === "1";
      const r = await syncCalendar(deps, String(body.key), { forceFull: true, allowMassDelete: force, reason: force ? "admin_force" : "admin" });
      notice = `재동기화: ${esc(r.status)}${r.error ? ` (${esc(r.error)})` : ""}${r.results?.length ? ` — ${esc(JSON.stringify(r.results[r.results.length - 1]))}` : ""}`;
    }
    return { status: 200, html: await statusPage(deps, pw, notice) };
  } catch (e) {
    console.error("[gcalAdmin] 오류:", e?.message || e);
    return { status: 500, html: page("오류", `<div class="card"><h1>오류</h1><p class="err">${esc(e?.message || e)}</p><p><a href="./">처음으로</a></p></div>`) };
  }
}
