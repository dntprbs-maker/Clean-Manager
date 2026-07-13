import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../lib/db.js";
import { ok, err } from "../lib/toolResult.js";

const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

export function registerEmployeeTools(server, companyId) {
  const usersCol = () => getDb().collection(`companies/${companyId}/users`);
  const staffsCol = () => getDb().collection("staffs");

  server.registerTool(
    "list_employees",
    {
      title: "직원 목록 조회",
      description: "이 회사 소속 직원 목록을 조회한다.",
      inputSchema: {
        includeDeleted: z.boolean().optional().default(false).describe("삭제된 직원도 포함할지"),
      },
    },
    async ({ includeDeleted }) => {
      const snap = await usersCol().get();
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => includeDeleted || u.status !== "deleted");
      return ok(list.map((u) => ({
        id: u.id, name: u.name, phone: u.phone,
        memberships: u.memberships || [], status: u.status || "active",
      })));
    }
  );

  server.registerTool(
    "create_employee",
    {
      title: "직원 등록",
      description: "새 직원을 등록한다. 비밀번호는 설정하지 않으며(직원 본인이 첫 로그인 시 설정), 팀 배정은 assign_member 도구로 별도 진행한다.",
      inputSchema: {
        name: z.string().min(1).describe("직원 이름"),
        phone: z.string().min(1).describe("전화번호"),
      },
    },
    async ({ name, phone }) => {
      const phoneDigits = onlyDigits(phone);
      const uid = staffsCol().doc().id;
      const base = { name, phone: phoneDigits, memberships: [], pw: "", createdAt: FieldValue.serverTimestamp() };
      const batch = getDb().batch();
      batch.set(usersCol().doc(uid), base);
      batch.set(staffsCol().doc(uid), { ...base, companyId });
      await batch.commit();
      return ok({ id: uid, name, phone: phoneDigits });
    }
  );

  server.registerTool(
    "update_employee",
    {
      title: "직원 정보 수정",
      description: "직원의 이름/전화번호를 수정한다. 비밀번호나 팀 소속은 이 도구로 바꾸지 않는다.",
      inputSchema: {
        employeeId: z.string().describe("직원 id"),
        name: z.string().optional(),
        phone: z.string().optional(),
      },
    },
    async ({ employeeId, name, phone }) => {
      const snap = await usersCol().doc(employeeId).get();
      if (!snap.exists) return err(`직원 ${employeeId}을 찾을 수 없습니다.`);
      const patch = {};
      if (name !== undefined) patch.name = name;
      if (phone !== undefined) patch.phone = onlyDigits(phone);
      if (Object.keys(patch).length === 0) return err("수정할 필드가 없습니다.");

      const batch = getDb().batch();
      batch.update(usersCol().doc(employeeId), patch);
      batch.update(staffsCol().doc(employeeId), patch);
      await batch.commit();
      return ok({ id: employeeId, updated: patch });
    }
  );

  server.registerTool(
    "delete_employee",
    {
      title: "직원 삭제",
      description: "직원을 삭제(소프트 삭제)한다. 데이터는 남지만 목록/로그인에서 제외된다.",
      inputSchema: { employeeId: z.string().describe("직원 id") },
    },
    async ({ employeeId }) => {
      const snap = await usersCol().doc(employeeId).get();
      if (!snap.exists) return err(`직원 ${employeeId}을 찾을 수 없습니다.`);
      const patch = { status: "deleted", deletedAt: FieldValue.serverTimestamp(), deletedBy: "mcp" };
      const batch = getDb().batch();
      batch.set(usersCol().doc(employeeId), patch, { merge: true });
      batch.set(staffsCol().doc(employeeId), patch, { merge: true });
      await batch.commit();
      return ok({ id: employeeId, deleted: true });
    }
  );
}
