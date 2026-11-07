import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { ok, err } from '../lib/toolResult.js';
import { normalizeMoneyInput, normalizePaymentGrouping, parseMoneyExpression } from '../../lib/moneyExpression.js';

const money = z.union([z.number().nonnegative().finite(), z.string().min(1).max(100)]);
const payment = z.object({ employeeName: z.string().trim().min(1).optional(), amount: money.optional(), amountExpression: z.string().max(100).nullish(),
  headcount: z.number().int().min(1).max(1000).optional(), unitAmount: money.optional(), status: z.enum(['pending','paid']).optional(), paidAt: z.string().optional(), scheduledAt: z.string().optional() });
const mergeRows = (previous, rows, key, replace = false) => {
  if (new Set(rows.map(row => row[key])).size !== rows.length) throw Error('같은 이름이나 비용 항목은 한 번만 입력해주세요.');
  if (replace) return rows.map(row => ({ ...(previous || []).find(old => old[key] === row[key]), ...row }));
  const next = (previous || []).map(row => ({ ...row }));
  for (const row of rows) { const at = next.findIndex(old => old[key] === row[key]); if (at < 0) next.push(row); else next[at] = { ...next[at], ...row }; }
  return next;
};
function amountRow(row, label) {
  const result = normalizeMoneyInput(row.amount, row.amountExpression, { label, required: true });
  return { ...row, amount: result.amount, amountExpression: result.expression || null };
}
export function financeSummary(finance = {}) {
  const sum = rows => (rows || []).reduce((total,row) => total + parseMoneyExpression(row.amount ?? 0).amount, 0);
  const revenue = finance.revenue == null ? null : parseMoneyExpression(finance.revenue).amount;
  const paymentRecorded = finance.payMethod === 'member_direct' ? !!finance.memberPays?.length : finance.leaderPay?.amount != null;
  const payout = paymentRecorded ? finance.payMethod === 'member_direct' ? sum(finance.memberPays) : parseMoneyExpression(finance.leaderPay.amount).amount : null;
  const extraCosts = sum(finance.extraCosts), profit = revenue != null && payout != null ? revenue - payout - extraCosts : null;
  if (![revenue,payout,extraCosts,profit].filter(value => value != null).every(Number.isSafeInteger)) throw Error('합계 금액이 너무 큽니다.');
  return { revenue,payout,extraCosts,profit,paymentRecorded,headcount:finance.payMethod==='member_direct'?(finance.memberPays||[]).reduce((n,row)=>n+(row.headcount||1),0):null };
}
export function mergeEventFinance(previous, patch) {
  const next = { ...(previous || {}) };
  if (patch.revenue !== undefined) { const value=normalizeMoneyInput(patch.revenue,patch.revenueExpression,{label:'청소비',required:true});next.revenue=value.amount;next.revenueExpression=value.expression||null; }
  if (next.revenue == null) throw Error('청소비가 아직 없습니다. 청소비를 먼저 입력하거나 revenue를 함께 넣어주세요.');
  if (patch.leaderPay) next.leaderPay = { ...next.leaderPay,...amountRow(patch.leaderPay,'팀장 지급액') };
  if (patch.memberPays) {
    const rows=patch.memberPays.map((row,index)=>{
      if (row.unitAmount !== undefined) {
        if (!row.headcount) throw Error('1인당 지급액에는 인원수(headcount)가 필요합니다.');
        const unit=parseMoneyExpression(row.unitAmount),total=parseMoneyExpression(`${unit.expression}×${row.headcount}`);
        if (row.amount!==undefined&&parseMoneyExpression(row.amount).amount!==total.amount) throw Error('인원수 × 1인당 지급액과 합계가 다릅니다.');
        return {...row,employeeName:row.employeeName||`작업자 ${row.headcount}명 (묶음 ${index+1})`,unitAmount:unit.amount,unitAmountExpression:unit.expression,amount:total.amount,amountExpression:total.expression};
      }
      if (!row.employeeName) throw Error('이름 또는 인원수와 1인당 지급액을 입력해주세요.');
      if (row.headcount&&row.headcount!==1) throw Error('여러 명을 묶어 입력할 때는 unitAmount를 함께 입력해주세요.');
      return amountRow(row,'팀원 지급액');
    });
    next.memberPays=mergeRows(next.memberPays,rows,'employeeName',patch.replaceMemberPays).map(normalizePaymentGrouping);
  }
  if (patch.extraCosts) next.extraCosts=mergeRows(next.extraCosts,patch.extraCosts.map(row=>amountRow(row,'추가 비용')),'label',patch.replaceExtraCosts);
  if (patch.workers) next.workers=mergeRows(next.workers,patch.workers,'name');
  next.payMethod=patch.payMethod||(patch.memberPays?'member_direct':patch.leaderPay?'leader_lump':next.payMethod||'leader_lump');
  if (next.payMethod==='member_direct'&&!next.memberPays?.length) throw Error('팀원 직접 지급에는 지급 내역이 필요합니다.');
  if (patch.payMethod==='leader_lump'&&!next.leaderPay) throw Error('팀장 지급액이 필요합니다.');
  financeSummary(next);return next;
}
export function registerFinanceTools(server, companyId) {
  const ref=id=>getDb().collection(`companies/${companyId}/events`).doc(id);
  server.registerTool('get_event_finance',{
    title:'현장 청소비·지급액·손익 조회',description:'일정 ID로 청소비, 지급액, 인원수/1인당 금액, 추가 비용, 손익을 조회한다. 미입력 금액은 null이며 0원으로 추정하지 않는다.',inputSchema:{eventId:z.string().min(1)},
  },async({eventId})=>{const snap=await ref(eventId).get();if(!snap.exists||snap.data().status==='deleted')return err('일정을 찾을 수 없습니다.');const event=snap.data();return ok({eventId,title:event.title,finance:event.finance||null,...financeSummary(event.finance)});});
  server.registerTool('set_event_finance',{
    title:'현장 청소비·인원별 지급액 입력',
    description:'알려준 필드만 수정하고 다른 금액/지급상태는 보존. 청소비만 먼저 입력한 뒤 지급액 추가 가능. 금액에 15000×37 같은 곱셈식 허용. memberPays의 이름별 amount 또는 headcount:4,unitAmount:100000으로 4명에게 각10만원을 기록. 이름 미제공 시 실제 이름 대신 인원 묶음 표시. 기본은 같은 이름/항목만 갱신하며 다른 내역은 유지. 전체 목록 교체 때만 replaceMemberPays/replaceExtraCosts=true. 사장님이 알려준 금액·대상만 입력하고 기존 내역을 먼저 조회한다.',
    inputSchema:{eventId:z.string().min(1),revenue:money.optional(),revenueExpression:z.string().max(100).nullish(),payMethod:z.enum(['leader_lump','member_direct']).optional(),
      leaderPay:z.object({amount:money,amountExpression:z.string().max(100).nullish(),status:z.enum(['pending','paid']).optional(),paidAt:z.string().optional(),scheduledAt:z.string().optional()}).optional(),
      memberPays:z.array(payment).max(100).optional(),replaceMemberPays:z.boolean().optional(),extraCosts:z.array(z.object({label:z.string().trim().min(1),amount:money,amountExpression:z.string().max(100).nullish()})).max(100).optional(),replaceExtraCosts:z.boolean().optional(),workers:z.array(z.object({name:z.string().trim().min(1),role:z.enum(['leader','member']).optional()})).max(100).optional()},
  },async({eventId,...patch},extra)=>{
    if(!['revenue','payMethod','leaderPay','memberPays','extraCosts','workers'].some(key=>patch[key]!==undefined))return err('입력할 금액이나 지급 내역이 없습니다.');
    try{const finance=await getDb().runTransaction(async transaction=>{const doc=ref(eventId),snap=await transaction.get(doc);if(!snap.exists||snap.data().status==='deleted')throw Error('일정을 찾을 수 없습니다.');const value=mergeEventFinance(snap.data().finance,patch);transaction.set(doc,{finance:value,mcpUpdatedBy:{agentId:extra.agent.agentId,label:extra.agent.label,at:new Date().toISOString()}},{merge:true});return value;});return ok({id:eventId,finance,...financeSummary(finance)});}catch(error){return err(error.message);}
  });
}
