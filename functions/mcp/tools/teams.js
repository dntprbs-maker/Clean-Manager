import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../lib/db.js";
import { ok, err } from "../lib/toolResult.js";
import { getMemberships } from "../../lib/membership.js";

const DEFAULT_TEAM_COLOR = "#f59e0b";

async function getConfig(companyId) {
  const ref = getDb().doc(`companies/${companyId}/meta/config`);
  const snap = await ref.get();
  return { ref, teams: snap.exists ? (snap.data().teams || []) : [] };
}

async function findCalsByTeamName(companyId, teamName) {
  const snap = await getDb().collection(`companies/${companyId}/cals`).get();
  return snap.docs.filter((d) => { const c = d.data(); return c.label === teamName || c.name === teamName; });
}

// 특정 팀에 소속된 모든 직원의 memberships를 일괄 갱신 (users + staffs 동시 기록).
// mapFn(memberships) => 새 memberships 배열. null을 반환하면 해당 직원은 건드리지 않음.
async function updateAllMembers(companyId, teamName, mapFn) {
  const db = getDb();
  const usersSnap = await db.collection(`companies/${companyId}/users`).get();
  const batch = db.batch();
  let changed = 0;
  usersSnap.forEach((doc) => {
    const u = doc.data();
    if (!getMemberships(u).some((m) => m.team === teamName)) return;
    const next = mapFn(getMemberships(u));
    if (next === null) return;
    batch.update(doc.ref, { memberships: next });
    batch.update(db.doc(`staffs/${doc.id}`), { memberships: next });
    changed++;
  });
  await batch.commit();
  return changed;
}

export function registerTeamTools(server, companyId) {
  server.registerTool(
    "list_teams",
    {
      title: "팀 목록 조회",
      description: "회사의 팀 목록을 조회한다 (팀 색상, 현장팀 여부 포함).",
      inputSchema: {},
    },
    async () => {
      const { teams } = await getConfig(companyId);
      const calsSnap = await getDb().collection(`companies/${companyId}/cals`).get();
      const byName = {};
      calsSnap.forEach((d) => { const c = d.data(); byName[c.label || c.name] = { id: d.id, color: c.color, isField: !!c.isField }; });
      return ok(teams.map((name) => ({ name, ...(byName[name] || {}) })));
    }
  );

  server.registerTool(
    "create_team",
    {
      title: "팀 생성",
      description: "새 팀을 만든다. isField=true면 실제 청소 현장을 담당하는 '현장팀'(일정에 표시됨), false면 관리/영업 같은 '업무팀'.",
      inputSchema: {
        name: z.string().min(1).describe("팀 이름"),
        isField: z.boolean().default(true).describe("현장팀 여부"),
      },
    },
    async ({ name, isField }) => {
      const { ref, teams } = await getConfig(companyId);
      if (teams.includes(name)) return err(`팀 "${name}"은 이미 있습니다.`);

      const batch = getDb().batch();
      batch.set(ref, { teams: [...teams, name] }, { merge: true });
      const calRef = getDb().collection(`companies/${companyId}/cals`).doc();
      batch.set(calRef, { label: name, name, color: DEFAULT_TEAM_COLOR, checked: true, isField: !!isField });
      await batch.commit();
      return ok({ name, calId: calRef.id, isField: !!isField });
    }
  );

  server.registerTool(
    "rename_team",
    {
      title: "팀 이름 변경",
      description: "팀 이름을 바꾼다. 소속 직원들의 멤버십과 팀 캘린더(구독링크 등)의 이름도 함께 갱신된다.",
      inputSchema: {
        oldName: z.string().describe("현재 팀 이름"),
        newName: z.string().min(1).describe("새 팀 이름"),
      },
    },
    async ({ oldName, newName }) => {
      const { ref, teams } = await getConfig(companyId);
      const idx = teams.indexOf(oldName);
      if (idx === -1) return err(`팀 "${oldName}"을 찾을 수 없습니다.`);
      if (teams.includes(newName)) return err(`팀 "${newName}"은 이미 있습니다.`);

      const nextTeams = [...teams];
      nextTeams[idx] = newName;
      await ref.set({ teams: nextTeams }, { merge: true });

      const changed = await updateAllMembers(companyId, oldName, (memberships) =>
        memberships.map((m) => (m.team === oldName ? { ...m, team: newName } : m))
      );

      const cals = await findCalsByTeamName(companyId, oldName);
      const batch = getDb().batch();
      cals.forEach((d) => batch.update(d.ref, { label: newName, name: newName }));
      await batch.commit();

      return ok({ oldName, newName, membersUpdated: changed, calsUpdated: cals.length });
    }
  );

  server.registerTool(
    "delete_team",
    {
      title: "팀 삭제",
      description: "팀을 삭제한다. 소속 직원들의 멤버십에서도 제거되고, 팀 캘린더도 함께 삭제된다.",
      inputSchema: { name: z.string().describe("삭제할 팀 이름") },
    },
    async ({ name }) => {
      const { ref, teams } = await getConfig(companyId);
      if (!teams.includes(name)) return err(`팀 "${name}"을 찾을 수 없습니다.`);

      const changed = await updateAllMembers(companyId, name, (memberships) =>
        memberships.filter((m) => m.team !== name)
      );

      await ref.set({ teams: teams.filter((t) => t !== name) }, { merge: true });

      const cals = await findCalsByTeamName(companyId, name);
      const batch = getDb().batch();
      cals.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      return ok({ name, membersUpdated: changed, calsDeleted: cals.length });
    }
  );

  server.registerTool(
    "assign_member",
    {
      title: "팀원 배정",
      description: "직원을 팀에 배정하고 역할(팀장/팀원)을 지정한다.",
      inputSchema: {
        employeeId: z.string().describe("직원 id"),
        teamName: z.string().describe("배정할 팀 이름"),
        role: z.enum(["팀장", "팀원"]).default("팀원"),
      },
    },
    async ({ employeeId, teamName, role }) => {
      const { teams } = await getConfig(companyId);
      if (!teams.includes(teamName)) return err(`팀 "${teamName}"을 찾을 수 없습니다.`);

      const userRef = getDb().doc(`companies/${companyId}/users/${employeeId}`);
      const snap = await userRef.get();
      if (!snap.exists) return err(`직원 ${employeeId}을 찾을 수 없습니다.`);
      const memberships = getMemberships(snap.data());
      if (memberships.some((m) => m.team === teamName)) return err(`이미 "${teamName}" 소속입니다.`);

      const next = [...memberships, { team: teamName, role }];
      const batch = getDb().batch();
      batch.update(userRef, { memberships: next });
      batch.update(getDb().doc(`staffs/${employeeId}`), { memberships: next });
      await batch.commit();
      return ok({ employeeId, memberships: next });
    }
  );

  server.registerTool(
    "remove_member",
    {
      title: "팀원 배정 해제",
      description: "직원을 팀에서 제외한다.",
      inputSchema: {
        employeeId: z.string().describe("직원 id"),
        teamName: z.string().describe("제외할 팀 이름"),
      },
    },
    async ({ employeeId, teamName }) => {
      const userRef = getDb().doc(`companies/${companyId}/users/${employeeId}`);
      const snap = await userRef.get();
      if (!snap.exists) return err(`직원 ${employeeId}을 찾을 수 없습니다.`);
      const memberships = getMemberships(snap.data());
      if (!memberships.some((m) => m.team === teamName)) return err(`"${teamName}" 소속이 아닙니다.`);

      const next = memberships.filter((m) => m.team !== teamName);
      const batch = getDb().batch();
      batch.update(userRef, { memberships: next });
      batch.update(getDb().doc(`staffs/${employeeId}`), { memberships: next });
      await batch.commit();
      return ok({ employeeId, memberships: next });
    }
  );

  server.registerTool(
    "change_member_role",
    {
      title: "팀원 역할 변경",
      description: "특정 팀 내에서 직원의 역할(팀장/팀원)을 바꾼다.",
      inputSchema: {
        employeeId: z.string().describe("직원 id"),
        teamName: z.string().describe("역할을 바꿀 팀 이름"),
        role: z.enum(["팀장", "팀원"]),
      },
    },
    async ({ employeeId, teamName, role }) => {
      const userRef = getDb().doc(`companies/${companyId}/users/${employeeId}`);
      const snap = await userRef.get();
      if (!snap.exists) return err(`직원 ${employeeId}을 찾을 수 없습니다.`);
      const memberships = getMemberships(snap.data());
      if (!memberships.some((m) => m.team === teamName)) return err(`"${teamName}" 소속이 아닙니다.`);

      const next = memberships.map((m) => (m.team === teamName ? { ...m, role } : m));
      const batch = getDb().batch();
      batch.update(userRef, { memberships: next });
      batch.update(getDb().doc(`staffs/${employeeId}`), { memberships: next });
      await batch.commit();
      return ok({ employeeId, memberships: next });
    }
  );
}
