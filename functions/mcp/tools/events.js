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

export function registerEventTools(server, companyId) {
  const eventsCol = () => getDb().collection(`companies/${companyId}/events`);

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
    async ({ start, end, team }) => {
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

      const result = filtered.map((ev) => ({
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
      }));
      return ok(result);
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
        ...REPEAT_FIELDS,
      },
    },
    async (input) => {
      const { title, start, team, ...rest } = input;
      const end = rest.end || start;
      if (end < start) return err("end는 start보다 빠를 수 없습니다.");
      if (!rest.allDay && rest.startTime && rest.endTime && rest.endTime <= rest.startTime) {
        return err("allDay가 아니면 endTime은 startTime보다 늦어야 합니다.");
      }
      const calId = await resolveCalId(companyId, team);
      if (team && !calId) return err(`팀 "${team}"을 찾을 수 없습니다. list_teams로 존재하는 팀 이름을 확인하세요.`);

      const docRef = eventsCol().doc();
      const data = { title, start, end, team: team || "", calId: calId || "", ...rest };
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
    async ({ eventId, patch }) => {
      const docRef = eventsCol().doc(eventId);
      const snap = await docRef.get();
      if (!snap.exists) return err(`일정 ${eventId}을 찾을 수 없습니다.`);

      const next = { ...patch };
      if (patch.team !== undefined) {
        const calId = await resolveCalId(companyId, patch.team);
        if (patch.team && !calId) return err(`팀 "${patch.team}"을 찾을 수 없습니다.`);
        next.calId = calId || "";
      }
      await docRef.update(next);
      return ok({ id: eventId, updated: next });
    }
  );

  server.registerTool(
    "delete_event",
    {
      title: "일정 삭제",
      description: "일정을 삭제한다. 반복 일정의 특정 1회차만 지우려면 scope=instance와 date를 함께 지정한다.",
      inputSchema: {
        eventId: z.string().describe("삭제할 일정 id"),
        scope: z.enum(["all", "instance"]).default("all").describe("all=전체 삭제, instance=특정 회차만 삭제"),
        date: z.string().optional().describe("scope=instance일 때 삭제할 회차의 날짜 YYYY-MM-DD"),
      },
    },
    async ({ eventId, scope, date }) => {
      const docRef = eventsCol().doc(eventId);
      const snap = await docRef.get();
      if (!snap.exists) return err(`일정 ${eventId}을 찾을 수 없습니다.`);

      if (scope === "instance") {
        if (!date) return err("scope=instance일 때는 date가 필요합니다.");
        await docRef.update({ [`exceptions.${date}`]: { _deleted: true } });
        return ok({ id: eventId, deleted: "instance", date });
      }
      await docRef.delete();
      return ok({ id: eventId, deleted: "all" });
    }
  );
}
