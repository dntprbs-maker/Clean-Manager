import { z } from "zod";
import { CHAT_FILE, downloadChatPhotos } from '../lib/chatFiles.js';
import { randomUUID } from "node:crypto";
import { getDb, getBucket } from "../lib/db.js";
import { expandRecurringForFeed } from "../../lib/recurring.js";
import { buildHubFeed } from "../../lib/hubFeed.js";
import { exportHubChanges } from "../../lib/hubChanges.js";
import { ok, err } from "../lib/toolResult.js";
import { SCOPES, hasScope } from '../lib/agents.js';

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

// 시각 필드는 "09:05"처럼 두 자리 HH:MM(24시간제)만 받는다.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isTime = (t) => typeof t === "string" && TIME_RE.test(t);

// YYYY-MM-DD에 일수를 더한다 (기기 시간대·서머타임 영향 없이 UTC 기준).
function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// "HH:MM"에서 분을 더한 시각과 자정 넘김 일수를 구한다 (23:30 + 60분 → 00:30, 1일).
function shiftTime(time, minutes) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const inDay = ((total % 1440) + 1440) % 1440;
  return { time: `${String(Math.floor(inDay / 60)).padStart(2, "0")}:${String(inDay % 60).padStart(2, "0")}`, days: Math.floor(total / 1440) };
}

const publicPhotos = photos => (photos || []).map(({ name, url }) => ({ name, url }));
const canReadFinance = agent => hasScope(agent, SCOPES.FINANCE_READ) || hasScope(agent, SCOPES.FINANCE_WRITE) || hasScope(agent, SCOPES.ADMIN);
function toView(ev, teamByCal, agent) {
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
    finance: canReadFinance(agent) ? ev.finance || undefined : undefined,
  };
}

// 사진 입력 — 이미 업로드된 것은 url로, 새로 올릴 것은 base64(dataBase64)로 받는다.
// 앱 화면(CalendarCore.jsx)이 올릴 때 쓰는 것과 같은 경로 규칙(companies/{cid}/events/{eid}/...)
// 에 저장해 같은 Storage 버킷·권한 규칙을 그대로 탄다.
const PHOTO_SHAPE = z.object({
  name: z.string().min(1).max(200).describe("파일 이름 (확장자 포함)"),
  url: z.string().max(4096).optional().describe("이미 업로드돼 있는 사진이면 그 URL"),
  dataBase64: z.string().max(14_000_000).optional().describe("새로 올릴 사진의 base64 인코딩 데이터(데이터 URI 접두어 없이)"),
  mimeType: z.string().optional().describe("dataBase64일 때 MIME 타입(예: image/jpeg). 생략 시 image/jpeg로 처리"),
});

async function uploadPhotos(companyId, eventId, photos) {
  if (!photos || photos.length === 0) return undefined;
  if (photos.length > 20) throw Error('사진은 한 번에 20장까지 첨부할 수 있습니다.');
  let totalBytes = 0;
  const validated = photos.map(p => {
    if (p.url && p.dataBase64) throw Error('사진 URL과 새 데이터 중 하나만 입력해주세요.');
    if (p.url) { const url = new URL(p.url); if (url.protocol !== 'https:' || url.username || url.password) throw Error('사진 URL은 HTTPS 주소여야 합니다.'); return p; }
    if (!p.dataBase64 || p.dataBase64.length > 14_000_000 || p.dataBase64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(p.dataBase64)) throw Error('사진의 base64 데이터가 올바르지 않습니다.');
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(p.mimeType || 'image/jpeg')) throw Error('JPG·PNG·WEBP·GIF 사진만 첨부할 수 있습니다.');
    const buffer = Buffer.from(p.dataBase64,'base64'); totalBytes += buffer.length;
    if(buffer.toString('base64')!==p.dataBase64)throw Error('사진의 base64 데이터가 올바르지 않습니다.');
    if (!buffer.length || buffer.length > 10 * 1024 * 1024 || totalBytes > 20 * 1024 * 1024) throw Error('사진은 장당 10MB, 합계 20MB 이하여야 합니다.');
    return { ...p, buffer };
  });
  const bucket = getBucket();
  return Promise.all(validated.map(async (p) => {
    if (p.url) return { name: p.name, url: p.url };
    if (!p.dataBase64) throw new Error(`사진 "${p.name}"에 url도 dataBase64도 없습니다.`);
    const buffer = p.buffer;
    const safeName = p.name.replace(/[^\p{L}\p{N}_. -]/gu,'_').replace(/^\.+/,'') || 'photo';
    const path = `companies/${companyId}/events/${eventId}/${randomUUID()}_${safeName}`;
    const file = bucket.file(path);
    const token = randomUUID();
    await file.save(buffer, {
      metadata: { contentType: p.mimeType || "image/jpeg", metadata: { firebaseStorageDownloadTokens: token } },
    });
    const emulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    if (emulator && !/^127\.0\.0\.1:\d+$/.test(emulator)) throw Error('잘못된 로컬 저장소 주소입니다.');
    const origin = emulator ? `http://${emulator}` : 'https://firebasestorage.googleapis.com';
    const url = `${origin}/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
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
  async function eventsInRange({ start, end, team }, agent) {
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
    return filtered.map((ev) => toView(ev, teamByCal, agent));
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
    async ({ start, end, team }, extra) => ok(await eventsInRange({ start, end, team }, extra?.agent))
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
    async ({ date, start, end, query, team, onlyTest }, extra) => {
      const s0 = date || start;
      if (!s0) return err("date 또는 start가 필요합니다.");
      const e0 = date || end || s0;
      if (e0 < s0) return err("end는 start보다 빠를 수 없습니다.");
      let list = await eventsInRange({ start: s0, end: e0, team }, extra?.agent);
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
    async ({ eventId }, extra) => {
      const snap = await eventsCol().doc(eventId).get();
      if (!snap.exists || snap.data().status === "deleted") return err(`일정 ${eventId}을 찾을 수 없습니다.`);
      const teamByCal = await loadTeamNameByCalId(companyId);
      return ok(toView({ id: eventId, ...snap.data() }, teamByCal, extra?.agent));
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
      let end = rest.end || start;
      if (end < start) return err("end는 start보다 빠를 수 없습니다.");
      if (!rest.allDay) {
        if (rest.startTime !== undefined && !isTime(rest.startTime)) return err("startTime은 HH:MM(24시간제) 형식이어야 합니다.");
        if (rest.endTime !== undefined && !isTime(rest.endTime)) return err("endTime은 HH:MM(24시간제) 형식이어야 합니다.");
        // 시작 시각만 주면 종료 시각을 1시간 뒤로 채운다 (23시대면 다음 날로 넘어감).
        if (rest.startTime && rest.endTime === undefined) {
          const { time, days } = shiftTime(rest.startTime, 60);
          rest.endTime = time;
          if (rest.end === undefined) end = addDays(start, days);
        }
        if (rest.startTime && rest.endTime !== undefined && end === start && rest.endTime <= rest.startTime) {
          return err("allDay가 아니면 endTime은 startTime보다 늦어야 합니다.");
        }
      }
      rest.end = end;
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
      return ok({ id: docRef.id, ...data, ...(data.photos ? { photos: publicPhotos(data.photos) } : {}) });
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
      const allDay = patch.allDay !== undefined ? patch.allDay : !!cur.allDay;
      const nStart = patch.start ?? cur.start;
      let nEnd = patch.end ?? cur.end ?? nStart;
      const touchesSchedule = ["start", "end", "allDay", "startTime", "endTime"].some((k) => patch[k] !== undefined);
      if (!allDay && touchesSchedule) {
        if (patch.startTime !== undefined && !isTime(patch.startTime)) return err("startTime은 HH:MM(24시간제) 형식이어야 합니다.");
        if (patch.endTime !== undefined && !isTime(patch.endTime)) return err("endTime은 HH:MM(24시간제) 형식이어야 합니다.");
        // 시작 시각만 바꾸면 종료 시각을 1시간 뒤로 맞춘다 (23시대면 날짜도 다음 날로).
        if (patch.startTime !== undefined && patch.endTime === undefined) {
          const { time, days } = shiftTime(patch.startTime, 60);
          patch.endTime = time;
          if (patch.end === undefined) nEnd = addDays(nStart, days);
        }
        const nStartTime = patch.startTime ?? cur.startTime;
        const nEndTime = patch.endTime ?? cur.endTime;
        if (nStartTime && nEndTime && nEnd === nStart && nEndTime <= nStartTime) {
          return err("allDay가 아니면 endTime은 startTime보다 늦어야 합니다.");
        }
        patch.end = nEnd;
      }
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
      return ok({ id: eventId, updated: { ...next, ...(next.photos ? { photos: publicPhotos(next.photos) } : {}) } });
    }
  );

  server.registerTool('attach_event_photos', {
    title: '현장 일정에 사진 추가', description: 'ChatGPT 대화 첨부 사진은 files로 전달한다. 서버가 파일을 다운로드하여 영구 저장한다. 일정 생성 후에도 이 도구로 첨부한다. 기존 사진은 보존한다. 로컬 업로드는 photos의 base64 또는 기존 HTTPS URL도 지원한다. 이후 get_event로 확인한다.',
    _meta: { 'openai/fileParams': ['files'] },
    inputSchema: { eventId: z.string().min(1), photos: z.array(PHOTO_SHAPE).min(1).max(20).optional(), files: z.array(CHAT_FILE).min(1).max(20).optional() },
  }, async ({ eventId, photos, files }, extra) => {
    if (!!photos === !!files) return err("photos 또는 ChatGPT 첨부 files 중 하나만 전달해주세요.");
    const ref = eventsCol().doc(eventId), original = await ref.get();
    if (!original.exists || original.data().status === 'deleted') return err('일정을 찾을 수 없습니다.');
    if ((original.data().photos || []).length + (photos || files).length > 100) return err('일정당 사진은 100장까지 첨부할 수 있습니다.');
    try {
      const uploaded = await uploadPhotos(companyId,eventId,files ? await downloadChatPhotos(files) : photos);
      const merged = await getDb().runTransaction(async transaction => {
        const snap = await transaction.get(ref); if (!snap.exists || snap.data().status === 'deleted') throw Error('일정을 찾을 수 없습니다.');
        const all = [...(snap.data().photos || [])];
        for (const photo of uploaded) if (!all.some(old => old.url === photo.url)) all.push(photo);
        if (all.length > 100) throw Error('일정당 사진은 100장까지 첨부할 수 있습니다.');
        transaction.set(ref,{photos:all,mcpUpdatedBy:audit(extra?.agent)},{merge:true});return all;
      });
      return ok({eventId,photos:publicPhotos(merged),added:uploaded.length});
    } catch(error) { return err(`사진 첨부 실패: ${error.message}`); }
  });

  // URL로 대상을 특정하고 트랜잭션에서 재확인하여 다른 사진·일정 필드를 보존한다.
  for (const replace of [true, false]) {
    server.registerTool(replace ? 'replace_event_photo' : 'remove_event_photo', {
      title: replace ? '일정 사진 한 장 교체' : '일정 사진 한 장 삭제',
      description: '먼저 get_event로 조회한 photoUrl을 지정한다. ' +
        (replace ? '해당 사진을 새 사진으로 교체하며 순서를 유지한다. ChatGPT 첨부는 file로 전달한다.' : '사용자가 삭제를 요청한 사진만 일정에서 제거한다.') +
        ' 다른 사진과 일정은 보존한다. 저장소 원본 파일은 영구 삭제하지 않는다.',
      ...(replace ? { _meta: { 'openai/fileParams': ['file'] } } : {}),
      inputSchema: {
        eventId: z.string().min(1),
        photoUrl: z.string().min(1).max(4096).describe('현재 일정에 첨부된 대상 사진의 정확한 URL'),
        ...(replace ? { photo: PHOTO_SHAPE.optional().describe('로컬 또는 URL 사진'), file: CHAT_FILE.optional().describe('ChatGPT에 첨부한 교체 사진') } : {}),
      },
    }, async ({ eventId, photoUrl, photo, file }, extra) => {
      if (replace && (!!photo === !!file)) return err("photo 또는 ChatGPT 첨부 file 중 하나만 전달해주세요.");
      const ref = eventsCol().doc(eventId);
      const check = snap => {
        if (!snap.exists || snap.data().status === 'deleted') throw Error('일정을 찾을 수 없습니다.');
        const photos = snap.data().photos || [];
        if (!photos.some(p => p.url === photoUrl)) throw Error('대상 사진이 없습니다. get_event로 다시 조회해주세요.');
        return photos;
      };
      try {
        check(await ref.get());
        const uploaded = replace ? (await uploadPhotos(companyId, eventId, file ? await downloadChatPhotos([file]) : [photo]))[0] : null;
        const result = await getDb().runTransaction(async transaction => {
          const photos = check(await transaction.get(ref));
          const next = replace
            ? photos.map(p => p.url === photoUrl ? { ...uploaded, ...(uploaded.url === p.url && p.path ? { path: p.path } : {}) } : p)
            : photos.filter(p => p.url !== photoUrl);
          transaction.set(ref, { photos: next, mcpUpdatedBy: audit(extra?.agent) }, { merge: true });
          return next;
        });
        return ok({ eventId, photos: publicPhotos(result), storageFilesDeleted: false });
      } catch (error) { return err(`사진 변경 실패: ${error.message}`); }
    });
  }

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


