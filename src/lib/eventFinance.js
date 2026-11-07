import { normalizeMoneyInput, normalizePaymentGrouping, parseMoneyExpression } from '../../functions/lib/moneyExpression.js';

export function financeTotals(finance = {}) {
  const number=value=>{try{return parseMoneyExpression(value??0).amount;}catch{return 0;}};
  const revenue=number(finance.revenue);
  const payout=finance.payMethod==='member_direct'
    ? (finance.memberPays||[]).reduce((sum,row)=>sum+number(row.amount),0) : number(finance.leaderPay?.amount);
  const costs=(finance.extraCosts||[]).reduce((sum,row)=>sum+number(row.amount),0);
  return {revenue,payout,costs,profit:revenue-payout-costs};
}

export function prepareEventFinance(finance) {
  const revenue=normalizeMoneyInput(finance.revenue,finance.revenueExpression,{label:'청소비',required:true});
  const amount=(row,label)=>{const parsed=normalizeMoneyInput(row?.amount,row?.amountExpression,{label});return {...row,amount:parsed.amount,amountExpression:parsed.expression||null};};
  const value={...finance,revenue:revenue.amount,revenueExpression:revenue.expression||null,payMethod:finance.payMethod||'leader_lump'};
  if(!['leader_lump','member_direct'].includes(value.payMethod))throw Error('지급 방식을 선택해주세요.');
  value.leaderPay=amount(finance.leaderPay,'팀장 지급액');
  value.memberPays=(finance.memberPays||[]).map(row=>normalizePaymentGrouping({...amount(row,'팀원 지급액'),employeeName:String(row.employeeName||'').trim()}));
  if(value.payMethod==='member_direct') {
    if(!value.memberPays.length||value.memberPays.some(row=>!row.employeeName))throw Error('지급할 팀원 이름을 입력해주세요.');
    if(new Set(value.memberPays.map(row=>row.employeeName)).size!==value.memberPays.length)throw Error('같은 팀원은 한 번만 입력해주세요.');
  }
  value.extraCosts=(finance.extraCosts||[]).map(row=>({...amount(row,'추가 비용'),label:String(row.label||'').trim()}));
  if(value.extraCosts.some(row=>!row.label))throw Error('추가 비용의 항목명을 입력해주세요.');
  const totals=financeTotals(value);
  if(!Object.values(totals).every(Number.isSafeInteger))throw Error('합계 금액이 너무 큽니다.');
  return value;
}
