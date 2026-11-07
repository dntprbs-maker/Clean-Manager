import { useId } from 'react';
import { ChevronDown, X, LockKeyhole } from 'lucide-react';
import { financeTotals } from '../../lib/eventFinance';
import { MoneyExpressionInput } from './MoneyExpressionInput';

function MoneyInput({label,value,expression,onChange}) {
  return <div className="flex items-center gap-2 min-w-0">
    <MoneyExpressionInput label={label} value={value} expression={expression} onChange={onChange}
      className="rounded-lg border border-gray-200 px-2.5 py-2 text-right text-sm outline-none focus:border-blue-500"/>
    <span className="text-sm shrink-0">원</span>
  </div>;
}

export function EventFinanceAccordion({value,onChange,open,onToggle,users=[],error}) {
  const id=useId();
  const finance=value||{revenue:'',payMethod:'leader_lump',leaderPay:{amount:''},memberPays:[],extraCosts:[]};
  const update=patch=>onChange({...finance,...patch});
  const members=finance.memberPays||[],costs=finance.extraCosts||[];
  const totals=financeTotals(finance);
  const updateRow=(field,rows,index,patch)=>update({[field]:rows.map((row,i)=>i===index?{...row,...patch}:row)});
  const direct=finance.payMethod==='member_direct';
  return <section className="mx-4 my-3 rounded-xl border border-blue-500 overflow-hidden" aria-label="청소비·정산 입력">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}
      className="w-full px-3 py-3 flex items-center gap-2 text-left">
      <span className="font-bold text-sm">청소비·정산 입력</span><span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">선택</span>
      <ChevronDown size={18} className={`ml-auto text-blue-600 ${open?'rotate-180':''}`}/>
    </button>
    {!open&&<p className="px-3 pb-3 text-xs text-gray-400">{value?'입력한 금액이 저장되어 있습니다. 펼쳐서 확인하세요.':'필요할 때 펼쳐서 입력하세요'}</p>}
    {open&&<div id={id} className="px-3 pb-3 space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
        <div className="text-sm">청소비<p className="mt-0.5 text-[10px] text-gray-400">고객에게 받을 금액</p></div>
        <MoneyInput label="청소비" value={finance.revenue} expression={finance.revenueExpression} onChange={(revenue,revenueExpression)=>update({revenue,revenueExpression:revenueExpression||null})}/>
      </div>
      <div><span className="text-sm block mb-2">지급 방식</span>
        <div className="flex gap-2" role="group" aria-label="지급 방식">
          {[['leader_lump','팀장 일괄 지급'],['member_direct','팀원 직접 지급']].map(([method,label])=><button key={method} type="button" aria-pressed={(finance.payMethod||'leader_lump')===method}
            onClick={()=>update({payMethod:method,...(method==='member_direct'&&!members.length?{memberPays:[{employeeName:'',amount:''}]}:{})})}
            className={`flex-1 rounded-full border py-1.5 text-xs ${(finance.payMethod||'leader_lump')===method?'border-blue-200 bg-blue-100 text-blue-700 font-bold':'border-gray-200 text-gray-600'}`}>{label}</button>)}
        </div>
      </div>
      {!direct?<div className="grid grid-cols-2 items-center gap-2"><div className="text-sm">팀장 지급액{finance.leaderPay?.status==='paid'&&<span className="block text-[10px] text-green-600">지급완료 상태 유지</span>}</div>
        <MoneyInput label="팀장 지급액" value={finance.leaderPay?.amount} expression={finance.leaderPay?.amountExpression} onChange={(amount,amountExpression)=>update({leaderPay:{...finance.leaderPay,amount,amountExpression:amountExpression||null}})}/></div>
        :<div className="space-y-2">
          <datalist id={`${id}-names`}>{[...new Set(users.map(user=>user.name).filter(Boolean))].map(name=><option key={name} value={name}/>)}</datalist>
          {members.map((row,index)=><div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
            <input aria-label={`팀원 ${index+1} 이름`} list={`${id}-names`} value={row.employeeName||''} placeholder="팀원 이름" onChange={event=>updateRow('memberPays',members,index,{employeeName:event.target.value})}
              className="w-full min-w-0 border border-gray-200 rounded-lg px-2 py-2 text-sm"/>
            <MoneyInput label={`팀원 ${index+1} 지급액`} value={row.amount} expression={row.amountExpression} onChange={(amount,amountExpression)=>updateRow('memberPays',members,index,{amount,amountExpression:amountExpression||null})}/>
            <button type="button" aria-label={`팀원 ${index+1} 입력 삭제`} onClick={()=>update({memberPays:members.filter((_,i)=>i!==index)})} className="p-1.5 text-gray-400"><X size={16}/></button>
          </div>)}
          <button type="button" onClick={()=>update({memberPays:[...members,{employeeName:'',amount:''}]})} className="text-xs text-blue-500 font-bold">+ 팀원 추가</button>
        </div>}
      <div className="space-y-2"><span className="text-sm">추가 비용</span>
        {costs.map((row,index)=><div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
          <input aria-label={`추가 비용 ${index+1} 항목`} value={row.label||''} placeholder="주차비 등" onChange={event=>updateRow('extraCosts',costs,index,{label:event.target.value})} className="w-full min-w-0 border border-gray-200 rounded-lg px-2 py-2 text-sm"/>
          <MoneyInput label={`추가 비용 ${index+1} 금액`} value={row.amount} expression={row.amountExpression} onChange={(amount,amountExpression)=>updateRow('extraCosts',costs,index,{amount,amountExpression:amountExpression||null})}/>
          <button type="button" aria-label={`추가 비용 ${index+1} 입력 삭제`} onClick={()=>update({extraCosts:costs.filter((_,i)=>i!==index)})} className="p-1.5 text-gray-400"><X size={16}/></button>
        </div>)}
        <button type="button" onClick={()=>update({extraCosts:[...costs,{label:'',amount:''}]})} className="block text-xs text-blue-500 font-bold">+ 비용 추가</button>
      </div>
      <div className="rounded-lg bg-blue-50 px-3 py-2"><div className="flex justify-between gap-2 text-sm font-bold text-blue-900"><span>예상 손익</span><output aria-label="예상 손익">{totals.profit.toLocaleString('ko-KR')}원</output></div>
        <p className="text-[10px] text-gray-400 mt-1">청소비 − 지급액 − 추가 비용</p></div>
      <p className="flex items-center gap-1 text-[10px] text-gray-400"><LockKeyhole size={12}/>사장·관리팀만 표시</p>
      {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>}
  </section>;
}
