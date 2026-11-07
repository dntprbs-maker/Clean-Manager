import { useId, useRef, useState } from 'react';
import { parseMoneyExpression } from '../../../functions/lib/moneyExpression.js';

export function MoneyExpressionInput({ label, value, expression, onChange, placeholder = '0', className = '', disabled = false }) {
  const [focused, setFocused] = useState(false), [touched, setTouched] = useState(false);
  const input = useRef(null), hint = useId();
  let parsed, failure = '';
  if (value !== '' && value != null) {
    try { parsed = parseMoneyExpression(value); } catch (error) { failure = error.message; }
  }
  let source = String(value ?? '');
  if (expression) {
    try { if (parseMoneyExpression(expression).amount === parsed?.amount) source = expression; }
    catch { if (failure) source = expression; }
  }
  const shown = focused ? source : parsed ? parsed.amount.toLocaleString('ko-KR') : source;
  const insertMultiply = () => {
    const el = input.current, editing = document.activeElement === el;
    const start = editing ? el.selectionStart ?? source.length : source.length, end = editing ? el.selectionEnd ?? start : start;
    const next = source.slice(0, start) + '×' + source.slice(end);
    onChange(next, next); el?.focus();
    requestAnimationFrame(() => el?.setSelectionRange(start + 1, start + 1));
  };
  return <div className="min-w-0 w-full">
    <div className="flex items-center gap-1 min-w-0">
      <input ref={input} aria-label={label} aria-invalid={!!failure} aria-describedby={hint} type="text" inputMode="decimal"
        value={shown} placeholder={placeholder} disabled={disabled} maxLength={100}
        onFocus={() => setFocused(true)}
        onChange={event => onChange(event.target.value, event.target.value)}
        onBlur={() => { setFocused(false); setTouched(true); if (parsed) onChange(parsed.amount, parsed.expression.includes('×') ? parsed.expression : undefined); }}
        className={`w-full min-w-0 ${className}`}/>
      <button type="button" disabled={disabled} aria-label={`${label} 곱하기 입력`} title="곱하기 입력" onPointerDown={event => event.preventDefault()}
        onClick={insertMultiply} className="shrink-0 rounded-lg border border-gray-200 px-2 py-2 text-blue-600 text-sm">×</button>
    </div>
    <p id={hint} role={failure && touched ? 'alert' : undefined} className={`mt-1 text-[10px] ${failure && touched ? 'text-red-600' : 'text-gray-400'}`}>
      {failure && touched ? failure : focused ? '예: 15000×37 · 칸을 벗어나면 금액으로 표시' : parsed && source.includes('×') ? '탭하면 입력한 계산식을 수정할 수 있습니다' : ''}
    </p>
  </div>;
}
