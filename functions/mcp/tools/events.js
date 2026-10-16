import { z } from "zod";
import { getDb } from "../lib/db.js";
import { expandRecurringForFeed } from "../../lib/recurring.js";
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
  };
}

export function registerEventTools(server, companyId) {
  const eventsCol = () => getDb().collection(`companies/${companyId}/events`);

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
        ...REPEAT_FIELDS,
      },
    },
    async (input, extra) => {
      const { title: rawTitle, start, team, test, ...rest } = input;
      const title = test && !rawTitle.startsWith(TEST_TITLE_PREFIX) ? TEST_TITLE_PREFIX + rawTitle : rawTitle;
      const end = rest.end || start;
      if (end < start) return err("end는 start보다 빠를 수 없습니다.");
      if (!rest.allDay && rest.startTime && rest.endTime && rest.endTime <= rest.startTime) {
        return err("allDay가 아니면 endTime은 startTime보다 늦어야 합니다.");
      }
      const calId = await resolveCalId(companyId, team);
      if (team && !calId) return err(`팀 "${team}"을 찾을 수 없습니다. list_teams로 존재하는 팀 이름을 확인하세요.`);

      const docRef = eventsCol().doc();
      const data = { title, start, end, team: team || "", calId: calId || "", ...rest, mcpCreatedBy: audit(extra?.agent) };
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
      await docRef.update(next);
      return ok({ id: eventId, updated: next });
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
