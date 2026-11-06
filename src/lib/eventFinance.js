export function financeTotals(finance = {}) {
  const number=value=>{const n=Number(String(value??'').replaceAll(',',''));return Number.isFinite(n)?n:0;};
  const revenue=number(finance.revenue);
  const payout=finance.payMethod==='member_direct'
    ? (finance.memberPays||[]).reduce((sum,row)=>sum+number(row.amount),0) : number(finance.leaderPay?.amount);
  const costs=(finance.extraCosts||[]).reduce((sum,row)=>sum+number(row.amount),0);
  return {revenue,payout,costs,profit:revenue-payout-costs};
}

export function prepareEventFinance(finance) {
  const amount=(value,label,required=false)=>{
    const raw=String(value??'').replaceAll(',','').trim();
    if(required&&!raw)throw Error(`${label}를 입력해주세요. 0원도 입력할 수 있습니다.`);
    if(raw&&!/^\d+$/.test(raw))throw Error(`${label}은 0 이상의 정수로 입력해주세요.`);
    const n=Number(raw||0);
    if(!Number.isSafeInteger(n))throw Error(`${label}이 너무 큽니다.`);
    return n;
  };
  const value={...finance,revenue:amount(finance.revenue,'청소비',true),payMethod:finance.payMethod||'leader_lump'};
  if(!['leader_lump','member_direct'].includes(value.payMethod))throw Error('지급 방식을 선택해주세요.');
  value.leaderPay={...finance.leaderPay,amount:amount(finance.leaderPay?.amount,'팀장 지급액')};
  value.memberPays=(finance.memberPays||[]).map(row=>({...row,employeeName:String(row.employeeName||'').trim(),amount:amount(row.amount,'팀원 지급액')}));
  if(value.payMethod==='member_direct') {
    if(!value.memberPays.length||value.memberPays.some(row=>!row.employeeName))throw Error('지급할 팀원 이름을 입력해주세요.');
    if(new Set(value.memberPays.map(row=>row.employeeName)).size!==value.memberPays.length)throw Error('같은 팀원은 한 번만 입력해주세요.');
  }
  value.extraCosts=(finance.extraCosts||[]).map(row=>({...row,label:String(row.label||'').trim(),amount:amount(row.amount,'추가 비용')}));
  if(value.extraCosts.some(row=>!row.label))throw Error('추가 비용의 항목명을 입력해주세요.');
  const totals=financeTotals(value);
  if(!Object.values(totals).every(Number.isSafeInteger))throw Error('합계 금액이 너무 큽니다.');
  return value;
}
