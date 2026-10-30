import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getDb, getBucket } from "../lib/db.js";
import { expandRecurringForFeed } from "../../lib/recurring.js";
import { buildHubFeed } from "../../lib/hubFeed.js";
import { exportHubChanges } from "../../lib/hubChanges.js";
import { ok, err } from "../lib/toolResult.js";

async function loadTeamNameByCalId(companyId) {
  const snap = await getDb().collection(`companies/${companyId}/cals`).get();
  const map = {};
  snap.forEach((d) => { const c = d.data(); map[d.id] = c.label || c.name || ""; });
  return map;
}

async function resolveCalId(companyId, teamName) {
  if (!teamName) return null;
  const snap = await getDb().collection(`companies/${companyId}/cals`).get();
  const hit = snap.docs.find((d) => { const c = d.data(); return c.label === teamName || c.name === teamName; });
  return hit ? hit.id : null;
}

const REPEAT_FIELDS = {
  repeat: z.enum(["none", "daily", "weekly", "monthly", "yearly"]).optional(),
  repeatInterval: z.number().int().positive().optional(),
  repeatUntil: z.string().optional(),
  repeatWeekdays: z.array(z.number().int().min(0).max(6)).optional(),
  repeatMonthlyType: z.enum(["day", "weekday"]).optional(),
  repeatMonthlyDay: z.number().int().optional(),
  repeatMonthlyOrdinal: z.number().int().optional(),
  repeatMonthlyWeekday: z.number().int().min(0).max(6).optional(),
  repeatYearlyType: z.enum(["date", "weekday"]).optional(),
  repeatYearlyMonth: z.number().int().min(1).max(12).optional(),
  repeatYearlyDay: z.number().int().optional(),
  repeatYearlyOrdinal: z.number().int().optional(),
  repeatYearlyWeekday: z.number().int().min(0).max(6).optional(),
};

export const TEST_TITLE_PREFIX = "[MCP시험] ";

const audit = (agent) => ({ agentId: agent?.agentId || "unknown", label: agent?.label || "", at: new Date().toISOString() });

function toView(ev, teamByCal) {
  return {
    id: ev.id,
    title: ev.title,
    start: ev.start,
    end: ev.end,
    allDay: !!ev.allDay,
    startTime: ev.startTime,
    endTime: ev.endTime,
    place: ev.place,
    contact: ev.contact,
    description: ev.description,
    team: ev.team || teamByCal[ev.calId] || null,
    calId: ev.calId || null,
    repeat: ev.repeat && ev.repeat !== "none" ? ev.repeat : undefined,
    mcpTest: ev.mcpTest ? true : undefined,
    createdBy: ev.mcpCreatedBy?.label || undefined,
    // 앱 화면과 같은 모양(name/url)만 내보낸다 — Storage 내부 path는 비공개 정보라 뺀다.
    photos: (ev.photos || []).length > 0 ? ev.photos.map((p) => ({ name: p.name, url: p.url })) : undefined,
    finance: ev.finance || undefined,
  };
}

// 사진 입력 — 이미 업로드된 것은 url로, 새로 올릴 것은 base64(dataBase64)로 받는다.
// 앱 화면(CalendarCore.jsx)이 올릴 때 쓰는 것과 같은 경로 규칙(companies/{cid}/events/{eid}/...)
// 에 저장해 같은 Storage 버킷·권한 규칙을 그대로 탄다.
const PHOTO_SHAPE = z.object({
  name: z.string().min(1).describe("파일 이름 (확장자 포함)"),
  url: z.string().optional().describe("이미 업로드돼 있는 사진이면 그 URL"),
  dataBase64: z.string().optional().describe("새로 올릴 사진의 base64 인코딩 데이터(데이터 URI 접두어 없이)"),
  mimeType: z.string().optional().describe("dataBase64일 때 MIME 타입(예: image/jpeg). 생략 시 image/jpeg로 처리"),
});

async function uploadPhotos(companyId, eventId, photos) {
  if (!photos || photos.length === 0) return undefined;
  const bucket = getBucket();
  return Promise.all(photos.map(async (p) => {
    if (p.url) return { name: p.name, url: p.url };
    if (!p.dataBase64) throw new Error(`사진 "${p.name}"에 url도 dataBase64도 없습니다.`);
    const buffer = Buffer.from(p.dataBase64, "base64");
    const path = `companies/${companyId}/events/${eventId}/${Date.now()}_${p.name}`;
    const file = bucket.file(path);
    const token = randomUUID();
    await file.save(buffer, {
      metadata: { contentType: p.mimeType || "image/jpeg", metadata: { firebaseStorageDownloadTokens: token } },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { name: p.name, url, path };
  }));
}

export function registerEventTools(server, companyId) {
  server.registerTool('export_hub_changes', {
    title: '허브 원본 변경분 조회',
    description: '최초 원본 전체, 이후 회사별 확정 순번 변경분. cursor는 허브 원본·회차와 함께 원자 저장한다.',
    inputSchema: { cursor: z.number().int().nonnegative().optional(), through: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200).optional() },
  }, args => exportHubChanges(getDb(), companyId, args).then(ok));
  const eventsCol = () => getDb().collection(`companies/${companyId}/events`);

  server.registerTool("export_hub_events", {
    title: "통합 허브용 자체 일정 조회",
    description: "읽기 전용. 구글/ICS 유입을 제외한 자체 일정 회차·상태·팀·반복 정보를 반환. 모든 페이지가 성공한 뒤에만 허브 reconcile. snapshot_changed면 처음부터 재조회.",
    inputSchema: { start: z.string(), end: z.string(), offset: z.number().int().min(0).optional(), snapshot: z.string().optional() },
  }, async args => {
    const [snap, teams, reports] = await Promise.all([eventsCol().get(), loadTeamNameByCalId(companyId), getDb().collection(`companies/${companyId}/reports`).get()]);
    return ok(buildHubFeed(snap.docs.map(d=>({id:d.id,...d.data(),__hubUpdatedAt:d.updateTime?.toDate().toISOString() || null})), teams, args, reports.docs.map(d=>d.data())));
  });
  // 기간 안의 (반복 전개된) 일정 + 팀 필터
  async function eventsInRange({ start, end, team }) {
    const snap = await eventsCol().get();
    const events = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((e) => e.status !== "deleted");
    const expanded = expandRecurringForFeed(events);
    const teamByCal = await loadTeamNameByCalId(companyId);
    const inRange = expanded.filter((ev) => {
      const evEnd = ev.end || ev.start;
      return ev.start <= end && evEnd >= start;
    });
    const filtered = team
      ? inRange.filter((ev) => ev.team === team || teamByCal[ev.calId] === team)
      : inRange;
    return filtered.map((ev) => toView(ev, teamByCal));
  }

  server.registerTool(
    "list_events",
    {
      title: "일정 조회",
      description: "지정한 기간(start~end) 안에 있는 일정을 조회한다. 반복 일정은 실제 발생하는 회차로 전개해서 보여준다. team을 주면 해당 팀 일정만 필터링한다.",
      inputSchema: {
        start: z.string().describe("조회 시작 날짜 YYYY-MM-DD"),
        end: z.string().describe("조회 종료 날짜 YYYY-MM-DD"),
        team: z.string().optional().describe("팀 이름으로 필터링 (선택)"),
      },
    },
    async ({ start, end, team }) => ok(await eventsInRange({ start, end, team }))
  );

  server.registerTool(
    "search_events",
    {
      title: "날짜별 일정 검색",
      description: "날짜(date 하루 또는 start~end 기간)와 검색어(제목·장소·메모·연락처에 포함)로 일정을 찾는다. date만 주면 그날 일정 전체.",
      inputSchema: {
        date: z.string().optional().describe("특정 날짜 YYYY-MM-DD (start/end 대신)"),
        start: z.string().optional().describe("기간 시작 YYYY-MM-DD"),
        end: z.string().optional().describe("기간 끝 YYYY-MM-DD (생략 시 start와 동일)"),
        query: z.string().optional().describe("검색어 (선택)"),
        team: z.string().optional().describe("팀 이름 (선택)"),
        onlyTest: z.boolean().optional().describe("true면 MCP 시험 일정만"),
      },
    },
    async ({ date, start, end, query, team, onlyTest }) => {
      const s0 = date || start;
      if (!s0) return err("date 또는 start가 필요합니다.");
      const e0 = date || end || s0;
      if (e0 < s0) return err("end는 start보다 빠를 수 없습니다.");
      let list = await eventsInRange({ start: s0, end: e0, team });
      if (query) {
        const q = query.toLowerCase();
        list = list.filter((ev) => [ev.title, ev.place, ev.description, ev.contact].some((v) => (v || "").toLowerCase().includes(q)));
      }
      if (onlyTest) list = list.filter((ev) => ev.mcpTest);
      return ok(list);
    }
  );

  server.registerTool(
    "get_event",
    {
      title: "일정 상세",
      description: "일정 id로 원본 일정 1건을 조회한다.",
      inputSchema: { eventId: z.string().describe("일정 id") },
    },
    async ({ eventId }) => {
      const snap = await eventsCol().doc(eventId).get();
      if (!snap.exists || snap.data().status === "deleted") return err(`일정 ${eventId}을 찾을 수 없습니다.`);
      const teamByCal = await loadTeamNameByCalId(companyId);
      return ok(toView({ id: eventId, ...snap.data() }, teamByCal));
    }
  );

  server.registerTool(
    "create_event",
    {
      title: "일정 등록",
      description: "새 일정(청소 일정 등)을 등록한다. title과 start는 필수. team 이름을 주면 해당 팀 캘린더에 연결한다.",
      inputSchema: {
        title: z.string().min(1).describe("일정 제목"),
        start: z.string().describe("시작 날짜 YYYY-MM-DD"),
        end: z.string().optional().describe("종료 날짜 YYYY-MM-DD (생략 시 start와 동일)"),
        allDay: z.boolean().optional().default(false),
        startTime: z.string().optional().describe("시작 시각 HH:MM (24시간제)"),
        endTime: z.string().optional().describe("종료 시각 HH:MM (24시간제)"),
        place: z.string().optional().describe("주소/장소"),
        contact: z.string().optional().describe("연락처"),
        description: z.string().optional().describe("메모/특이사항"),
        team: z.string().optional().describe("담당 팀 이름 (기존에 있는 팀이어야 함)"),
        test: z.boolean().optional().describe("시험용 일정이면 true — 제목 앞에 [MCP시험]이 붙고 직원 알림이 가지 않는다"),
        photos: z.array(PHOTO_SHAPE).optional().describe("첨부 사진 목록"),
        ...REPEAT_FIELDS,
      },
    },
    async (input, extra) => {
      const { title: rawTitle, start, team, test, photos, ...rest } = input;
      const title = test && !rawTitle.startsWith(TEST_TITLE_PREFIX) ? TEST_TITLE_PREFIX + rawTitle : rawTitle;
      const end = rest.end || start;
      if (end < start) return err("end는 start보다 빠를 수 없습니다.");
      if (!rest.allDay && rest.startTime && rest.endTime && rest.endTime <= rest.startTime) {
        return err("allDay가 아니면 endTime은 startTime보다 늦어야 합니다.");
      }
      const calId = await resolveCalId(companyId, team);
      if (team && !calId) return err(`팀 "${team}"을 찾을 수 없습니다. list_teams로 존재하는 팀 이름을 확인하세요.`);

      const docRef = eventsCol().doc();
      let uploadedPhotos;
      try {
        uploadedPhotos = await uploadPhotos(companyId, docRef.id, photos);
      } catch (e) {
        return err(`사진 업로드 실패: ${e.message}`);
      }
      const data = { title, start, end, team: team || "", calId: calId || "", ...rest, mcpCreatedBy: audit(extra?.agent) };
      if (uploadedPhotos) data.photos = uploadedPhotos;
      if (test) data.mcpTest = true;
      await docRef.set(data);
      return ok({ id: docRef.id, ...data });
    }
  );

  const PATCH_SHAPE = {
    title: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    allDay: z.boolean().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    place: z.string().optional(),
    contact: z.string().optional(),
    description: z.string().optional(),
    team: z.string().optional(),
    photos: z.array(PHOTO_SHAPE).optional().describe("전체 교체 — 기존 사진을 유지하려면 그 사진도 url로 함께 포함해서 보낼 것"),
    ...REPEAT_FIELDS,
  };

  server.registerTool(
    "update_event",
    {
      title: "일정 수정",
      description: "기존 일정을 부분 수정한다. patch에 넣은 필드만 바뀌고 나머지는 그대로 유지된다(전체 덮어쓰기 아님).",
      inputSchema: {
        eventId: z.string().describe("수정할 일정 id (list_events로 조회한 id)"),
        // 일부 MCP 클라이언트가 nested object 인자를 JSON 문자열로 감싸서 보내는 경우가
        // 있어(패치 객체가 "{\"...\"}" 형태로 도착), 문자열로 오면 먼저 파싱해서 받아준다.
        // 파싱 실패 시엔 원래 값을 그대로 넘겨 기존과 동일한 zod 에러 메시지가 나오게 한다.
        patch: z.preprocess((val) => {
          if (typeof val !== "string") return val;
          try { return JSON.parse(val); } catch { return val; }
        }, z.object(PATCH_SHAPE)).describe("바꿀 필드만 담아서 전달 (객체 또는 JSON 문자열 모두 허용)"),
      },
    },
    async ({ eventId, patch }, extra) => {
      const docRef = eventsCol().doc(eventId);
      const snap = await docRef.get();
      if (!snap.exists || snap.data().status === "deleted") return err(`일정 ${eventId}을 찾을 수 없습니다.`);
      const cur = snap.data();
      const nStart = patch.start ?? cur.start;
      const nEnd = patch.end ?? cur.end ?? nStart;
      if (nEnd < nStart) return err("end는 start보다 빠를 수 없습니다.");
      if (cur.mcpTest && patch.title !== undefined && !patch.title.startsWith(TEST_TITLE_PREFIX)) {
        patch.title = TEST_TITLE_PREFIX + patch.title; // 시험 일정 표시는 수정해도 유지
      }

      const next = { ...patch, mcpUpdatedBy: audit(extra?.agent) };
      if (patch.team !== undefined) {
        const calId = await resolveCalId(companyId, patch.team);
        if (patch.team && !calId) return err(`팀 "${patch.team}"을 찾을 수 없습니다.`);
        next.calId = calId || "";
      }
      if (patch.photos !== undefined) {
        try {
          next.photos = await uploadPhotos(companyId, eventId, patch.photos) || [];
        } catch (e) {
          return err(`사진 업로드 실패: ${e.message}`);
        }
      }
      await docRef.update(next);
      return ok({ id: eventId, updated: next });
    }
  );

  server.registerTool(
    "set_event_finance",
    {
      title: "정산 정보 입력",
      description:
        "일정 1건의 정산(금액) 정보를 전체 교체한다 — 부분 수정이 아니라 매번 전체 값을 다시 보낸다. " +
        "앱 상세 화면의 '정산 정보' 섹션(접으면 최종 손익 1줄, 펼치면 전체)과 같은 데이터다. " +
        "사장·관리팀만 보이는 민감 정보라 이 도구는 admin 권한이 필요하다. " +
        "손익 = revenue − (payMethod가 leader_lump면 leaderPay.amount, member_direct면 memberPays 합) − extraCosts 합.",
      inputSchema: {
        eventId: z.string().describe("정산 정보를 넣을 일정 id"),
        revenue: z.number().nonnegative().describe("청소비(매출), 원"),
        payMethod: z.enum(["leader_lump", "member_direct"]).describe("leader_lump=팀장 일괄 지급, member_direct=팀원 직접 지급"),
        leaderPay: z.object({
          amount: z.number().nonnegative(),
          status: z.enum(["pending", "paid"]).optional(),
        }).optional().describe("payMethod=leader_lump일 때 팀장에게 지급할(한) 금액"),
        memberPays: z.array(z.object({
          employeeName: z.string(),
          amount: z.number().nonnegative(),
        })).optional().describe("payMethod=member_direct일 때 팀원별 지급액"),
        extraCosts: z.array(z.object({
          label: z.string(),
          amount: z.number().nonnegative(),
        })).optional().describe("기타 현장 비용(주차비 등), 항목+금액"),
        workers: z.array(z.object({
          name: z.string(),
          role: z.enum(["leader", "member"]).optional(),
        })).optional().describe("이 현장에 참여한 작업자 목록"),
      },
    },
    async ({ eventId, ...finance }, extra) => {
      const docRef = eventsCol().doc(eventId);
      const snap = await docRef.get();
      if (!snap.exists || snap.data().status === "deleted") return err(`일정 ${eventId}을 찾을 수 없습니다.`);
      if (finance.payMethod === "leader_lump" && !finance.leaderPay) {
        return err("payMethod가 leader_lump면 leaderPay가 필요합니다.");
      }
      if (finance.payMethod === "member_direct" && !(finance.memberPays?.length)) {
        return err("payMethod가 member_direct면 memberPays가 1건 이상 필요합니다.");
      }
      await docRef.update({ finance, mcpUpdatedBy: audit(extra?.agent) });
      const payOut = finance.payMethod === "member_direct"
        ? finance.memberPays.reduce((s, p) => s + p.amount, 0)
        : finance.leaderPay.amount;
      const costsSum = (finance.extraCosts || []).reduce((s, c) => s + c.amount, 0);
      const profit = finance.revenue - payOut - costsSum;
      return ok({ id: eventId, finance, profit });
    }
  );

  // 삭제는 AI가 직접 하지 않는다. 요청만 남기고, 실제 삭제는 관리자가 확인 후 처리한다.
  // (구글 캘린더에서 온 일정은 앱에서 지워도 다음 동기화 때 되살아날 수 있어 더더욱 사람 확인이 필요)
  server.registerTool(
    "request_event_deletion",
    {
      title: "일정 삭제 요청",
      description: "일정을 바로 지우지 않고 삭제 요청만 등록한다. 관리자가 승인해야 실제로 삭제된다. 일정은 그대로 남는다.",
      inputSchema: {
        eventId: z.string().describe("삭제를 요청할 일정 id"),
        scope: z.enum(["all", "instance"]).default("all").describe("all=전체, instance=반복 일정의 특정 회차"),
        date: z.string().optional().describe("scope=instance일 때 회차 날짜 YYYY-MM-DD"),
        reason: z.string().min(1).describe("삭제 사유"),
      },
    },
    async ({ eventId, scope, date, reason }, extra) => {
      const snap = await eventsCol().doc(eventId).get();
      if (!snap.exists || snap.data().status === "deleted") return err(`일정 ${eventId}을 찾을 수 없습니다.`);
      if (scope === "instance" && !date) return err("scope=instance일 때는 date가 필요합니다.");
      const ev = snap.data();
      const ref = getDb().collection("mcpDeletionRequests").doc();
      const req = {
        companyId, eventId, scope, date: date || null, reason,
        eventTitle: ev.title || "", eventStart: ev.start || "",
        status: "pending", requestedBy: audit(extra?.agent),
      };
      await ref.set(req);
      return ok({ requestId: ref.id, status: "pending", message: "삭제 요청을 등록했습니다. 관리자 승인 전까지 일정은 그대로 유지됩니다." });
    }
  );
}


