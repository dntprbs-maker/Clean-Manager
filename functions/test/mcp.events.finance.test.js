// 공용 MCP: 일정 사진 첨부(url/base64 업로드) + 정산 정보(finance) 입력·조회 검증
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFakeDb } from "./helpers/fakeFirestore.js";
import { __setDbForTest, __setBucketForTest } from "../mcp/lib/db.js";
import { createMcpServer } from "../mcp/server.js";
import { OWNER_AGENT } from "../mcp/lib/agents.js";

const CO = "co1";
let db, bucket;

function createFakeBucket() {
  const files = {};
  return {
    name: "fake-bucket.appspot.com",
    file(path) {
      return {
        async save(buffer, opts) {
          files[path] = { buffer, opts };
        },
      };
    },
    _files: files,
  };
}

beforeEach(async () => {
  db = createFakeDb();
  __setDbForTest(db);
  bucket = createFakeBucket();
  __setBucketForTest(bucket);
  await db.doc(`companies/${CO}/cals/cal1`).set({ label: "A팀" });
  await db.doc(`companies/${CO}/events/ev1`).set({ title: "상암동 정기청소", start: "2026-10-30", end: "2026-10-30", calId: "cal1" });
});

async function connect(agent = OWNER_AGENT) {
  const server = createMcpServer(CO, agent);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content[0].text;
    return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
  };
  return { call };
}

test("사진 첨부: base64는 Storage에 업로드돼 url로 저장, 이미 있는 url은 그대로", async () => {
  const { call } = await connect();
  const base64 = Buffer.from("fake-image-bytes").toString("base64");
  const r = await call("update_event", {
    eventId: "ev1",
    patch: { photos: [
      { name: "before.jpg", dataBase64: base64, mimeType: "image/jpeg" },
      { name: "already.jpg", url: "https://example.com/already.jpg" },
    ] },
  });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.updated.photos.length, 2);
  const uploaded = r.data.updated.photos.find(p => p.name === "before.jpg");
  assert.ok(uploaded.url.includes("firebasestorage.googleapis.com"), uploaded.url);
  assert.equal(r.data.updated.photos.find(p => p.name === "already.jpg").url, "https://example.com/already.jpg");
  // 실제로 버킷에 바이트가 저장됐는지
  const savedPath = Object.keys(bucket._files).find(p => p.includes("before.jpg"));
  assert.ok(savedPath, "업로드된 파일이 fake bucket에 없음");
  assert.equal(bucket._files[savedPath].buffer.toString(), "fake-image-bytes");

  const got = await call("get_event", { eventId: "ev1" });
  assert.equal(got.data.photos.length, 2);
  assert.equal(got.data.photos[0].path, undefined, "조회 결과에 내부 storage path가 노출되면 안 됨");
});

test("사진 첨부: dataBase64도 url도 없으면 거부", async () => {
  const { call } = await connect();
  const r = await call("update_event", { eventId: "ev1", patch: { photos: [{ name: "x.jpg" }] } });
  assert.equal(r.isError, true);
});

test("정산 정보: 팀장 일괄 지급 입력·조회·손익 계산", async () => {
  const { call } = await connect();
  const r = await call("set_event_finance", {
    eventId: "ev1",
    revenue: 350000,
    payMethod: "leader_lump",
    leaderPay: { amount: 150000, status: "paid" },
    extraCosts: [{ label: "주차비", amount: 5000 }],
    workers: [{ name: "이영희", role: "leader" }, { name: "박지훈", role: "member" }],
  });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.profit, 195000);

  const got = await call("get_event", { eventId: "ev1" });
  assert.equal(got.data.finance.revenue, 350000);
  assert.equal(got.data.finance.leaderPay.status, "paid");
});

test("정산 정보: 팀원 직접 지급인데 memberPays 없으면 거부", async () => {
  const { call } = await connect();
  const r = await call("set_event_finance", {
    eventId: "ev1", revenue: 100000, payMethod: "member_direct",
  });
  assert.equal(r.isError, true);
});

test("정산 정보: 없는 일정이면 거부", async () => {
  const { call } = await connect();
  const r = await call("set_event_finance", {
    eventId: "nope", revenue: 1, payMethod: "leader_lump", leaderPay: { amount: 1 },
  });
  assert.equal(r.isError, true);
});

test('청소비→인원별 지급→비용 순서로 입력해도 이전 값·식·지급상태를 보존하고 반복 입력은 중복되지 않는다',async()=>{
  const {call}=await connect();
  let r=await call('set_event_finance',{eventId:'ev1',revenue:'15000×37'});
  assert.equal(r.data.revenue,555000);assert.equal(r.data.profit,null);assert.equal(r.data.paymentRecorded,false);
  const group={headcount:4,unitAmount:'100000',status:'paid'};
  r=await call('set_event_finance',{eventId:'ev1',memberPays:[group]});
  assert.equal(r.data.payout,400000);assert.equal(r.data.headcount,4);assert.equal(r.data.profit,155000);
  assert.equal(r.data.finance.revenueExpression,'15000×37');
  await call('set_event_finance',{eventId:'ev1',extraCosts:[{label:'주차비',amount:'2500×2'}]});
  await call('set_event_finance',{eventId:'ev1',memberPays:[{headcount:4,unitAmount:100000}]});
  r=await call('get_event_finance',{eventId:'ev1'});
  assert.equal(r.data.finance.memberPays.length,1);assert.equal(r.data.finance.memberPays[0].status,'paid');
  assert.equal(r.data.extraCosts,5000);assert.equal(r.data.profit,150000);
  await call('set_event_finance',{eventId:'ev1',revenue:600000});
  const after=await call('get_event_finance',{eventId:'ev1'});assert.equal(after.data.profit,195000);assert.equal(after.data.finance.memberPays[0].amountExpression,'100000×4');
});

test('정산 전용 권한은 직원관리 권한을 주지 않으며 일반 일정 조회로 금액이 새지 않는다',async()=>{
  const owner=await connect();await owner.call('set_event_finance',{eventId:'ev1',revenue:900000,leaderPay:{amount:400000}});
  const plain=await connect({agentId:'plain',scopes:['events:read','events:write']});
  assert.equal((await plain.call('get_event',{eventId:'ev1'})).data.finance,undefined);
  assert.ok((await plain.call('get_event_finance',{eventId:'ev1'})).isError);
  assert.ok((await plain.call('set_event_finance',{eventId:'ev1',revenue:1})).isError);
  const finance=await connect({agentId:'fin',scopes:['finance:read','finance:write']});
  assert.equal((await finance.call('get_event_finance',{eventId:'ev1'})).data.revenue,900000);
  assert.ok((await finance.call('list_employees',{})).isError);
  const reader=await connect({agentId:'reader',scopes:['finance:read']});assert.ok((await reader.call('set_event_finance',{eventId:'ev1',revenue:1})).isError);
});

test('잘못된 식·인원·합계와 다른 회사 일정은 거절하고 원본을 바꾸지 않는다',async()=>{
  const {call}=await connect();const before=structuredClone(db._store.get(`companies/${CO}/events/ev1`));
  for(const patch of [{revenue:'15000×'},{revenue:'1;process.exit()'},{revenue:100000,memberPays:[{headcount:4,unitAmount:100000,amount:1}]},{revenue:100000,memberPays:[{headcount:0,unitAmount:1000}]},{revenue:100000,memberPays:[{employeeName:'A',amount:1},{employeeName:'A',amount:2}]}])assert.ok((await call('set_event_finance',{eventId:'ev1',...patch})).isError);
  await db.doc('companies/other/events/other').set({title:'다른회사'});
  assert.ok((await call('set_event_finance',{eventId:'other',revenue:1})).isError);
  assert.deepEqual(db._store.get(`companies/${CO}/events/ev1`),before);
});

test('사진 추가는 기존 사진을 보존하고 응답에 내부 경로를 내보내지 않는다',async()=>{
  const {call}=await connect();await db.doc(`companies/${CO}/events/ev1`).update({photos:[{name:'old.jpg',url:'https://example.com/old.jpg',path:'private/old'}]});
  const r=await call('attach_event_photos',{eventId:'ev1',photos:[{name:'../../new.png',dataBase64:Buffer.from('photo').toString('base64'),mimeType:'image/png'}]});
  assert.equal(r.isError,false,r.text);assert.equal(r.data.photos.length,2);assert.ok(r.data.photos.every(p=>p.path===undefined));
  assert.equal(db._store.get(`companies/${CO}/events/ev1`).photos[0].path,'private/old');
  assert.ok(!Object.keys(bucket._files)[0].includes('/../'));
});

test('위험하거나 잘못된 사진은 저장 전에 차단한다',async()=>{
  const {call}=await connect();
  for(const photo of [{name:'x.svg',dataBase64:'YWJj',mimeType:'image/svg+xml'},{name:'bad.png',dataBase64:'!!!!',mimeType:'image/png'},{name:'x',url:'javascript:alert(1)'},{name:'x',url:'http://example.com/a'},{name:'x',url:'https://example.com/a',dataBase64:'YWJj'}])assert.ok((await call('attach_event_photos',{eventId:'ev1',photos:[photo]})).isError);
  assert.equal(Object.keys(bucket._files).length,0);assert.equal(db._store.get(`companies/${CO}/events/ev1`).photos,undefined);
});

test('사진 개별 교체·삭제는 순서와 다른 일정 필드를 보존한다', async () => {
  const {call} = await connect();
  const photos = [{name:'a.jpg',url:'https://example.com/a.jpg'}, {name:'b.jpg',url:'https://example.com/b.jpg'}];
  await call('attach_event_photos',{eventId:'ev1',photos});
  const replaced = await call('replace_event_photo',{eventId:'ev1',photoUrl:photos[0].url,photo:{name:'new.png',dataBase64:Buffer.from('test').toString('base64'),mimeType:'image/png'}});
  assert.equal(replaced.isError,false,replaced.text);
  assert.equal(replaced.data.photos[0].name,'new.png');
  assert.deepEqual(replaced.data.photos[1],photos[1]);
  const removed = await call('remove_event_photo',{eventId:'ev1',photoUrl:replaced.data.photos[0].url});
  assert.equal(removed.isError,false,removed.text);
  assert.deepEqual(removed.data.photos,[photos[1]]);
  assert.equal(Object.keys(bucket._files).length,1);
  const got=await call('get_event',{eventId:'ev1'});
  assert.equal(got.data.title,'상암동 정기청소');
  assert.deepEqual(got.data.photos,[photos[1]]);
  assert.equal((await call('remove_event_photo',{eventId:'ev1',photoUrl:photos[0].url})).isError,true);
});

test('없는 대상 사진 교체는 업로드 전에 거부한다', async () => {
  const {call}=await connect();
  const r=await call('replace_event_photo',{eventId:'ev1',photoUrl:'https://example.com/missing',photo:{name:'x.png',dataBase64:'dGVzdA==',mimeType:'image/png'}});
  assert.equal(r.isError,true);
  assert.equal(Object.keys(bucket._files).length,0);
});

test('ChatGPT 첨부 도구 메타데이터 및 클라우드 추가·교체 종단 저장', async () => {
 const server = createMcpServer(CO, OWNER_AGENT);
 const [a,b] = InMemoryTransport.createLinkedPair();
 const client = new Client({name:'file-test',version:'1'});
 await Promise.all([server.connect(a),client.connect(b)]);
 const listed = await client.listTools();
 for (const [name, field] of [['attach_event_photos','files'],['replace_event_photo','file']]) {
  const tool = listed.tools.find(t=>t.name===name);
  assert.deepEqual(tool._meta['openai/fileParams'],[field]);
  const schema = tool.inputSchema.properties[field];
  const obj = schema.items || schema;
  assert.deepEqual(obj.required,['download_url','file_id']);
  for (const prop of ['download_url','file_id','mime_type','file_name']) assert.ok(obj.properties[prop]);
 }
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(png);
 try {
  const file={download_url:'https://files.oaiusercontent.com/test',file_id:'file-test',file_name:'cloud.png'};
  let r=await client.callTool({name:'attach_event_photos',arguments:{eventId:'ev1',files:[file]}});
  assert.ok(!r.isError,JSON.stringify(r));
  const first=JSON.parse(r.content[0].text).photos[0];
  assert.ok(first.url.includes('firebasestorage.googleapis.com'));
  r=await client.callTool({name:'replace_event_photo',arguments:{eventId:'ev1',photoUrl:first.url,file:{...file,file_name:'replaced.png'}}});
  assert.ok(!r.isError,JSON.stringify(r));
  const final=(await db.doc(`companies/${CO}/events/ev1`).get()).data();
  assert.equal(final.photos.length,1); assert.equal(final.photos[0].name,'replaced.png'); assert.equal(final.title,'상암동 정기청소');
  assert.deepEqual(Object.values(bucket._files)[0].buffer,png);
 } finally {globalThis.fetch=oldFetch; await client.close(); await server.close();}
});
