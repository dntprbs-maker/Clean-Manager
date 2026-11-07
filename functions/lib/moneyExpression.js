const MAX_FACTORS = 8;
const MAX_DIGITS = 18;
const MAX_FRACTION_DIGITS = 6;
const MAX_INPUT_LENGTH = 100;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const TEN = 10n;

const FACTOR_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

function fail(message) {
  throw new Error(message);
}

export function parseMoneyExpression(input) {
  let text;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) fail('유한한 숫자를 입력해 주세요.');
    if (input < 0) fail('음수 금액은 입력할 수 없습니다.');
    text = String(input);
  } else if (typeof input === 'string') {
    text = input;
  } else {
    fail('숫자 또는 문자열만 입력할 수 있습니다.');
  }

  if (text.length > MAX_INPUT_LENGTH) fail('입력이 너무 깁니다.');

  const normalized = text
    .normalize('NFKC')
    .replace(/[xX*]/g, '×')
    .replace(/\s+/g, '');

  if (normalized.length === 0) fail('금액을 입력해 주세요.');

  const factors = normalized.split('×');
  if (factors.length > MAX_FACTORS) fail('곱셈은 최대 8개까지 가능합니다.');

  let numerator = 1n;
  let scale = 0;

  for (const factor of factors) {
    if (!FACTOR_RE.test(factor)) fail('올바른 금액 형식이 아닙니다.');

    const digitCount = factor.replace(/[^0-9]/g, '').length;
    if (digitCount > MAX_DIGITS) fail('숫자가 너무 깁니다.');

    const plain = factor.replace(/,/g, '');
    const dotIndex = plain.indexOf('.');
    const intPart = dotIndex === -1 ? plain : plain.slice(0, dotIndex);
    const fracPart = dotIndex === -1 ? '' : plain.slice(dotIndex + 1);

    if (fracPart.length > MAX_FRACTION_DIGITS) {
      fail('소수점은 최대 6자리까지 가능합니다.');
    }

    numerator *= BigInt(intPart + fracPart);
    scale += fracPart.length;
  }

  const divisor = TEN ** BigInt(scale);
  if (numerator % divisor !== 0n) fail('원 단위로 나누어지지 않습니다.');

  const amount = numerator / divisor;
  if (amount > MAX_SAFE) fail('계산 결과가 너무 큽니다.');

  return { amount: Number(amount), expression: normalized.replace(/,/g, '') };
}

// Numeric amounts stay authoritative for older clients that do not know formulas.
export function normalizeMoneyInput(value, expression, { label = '금액', required = false } = {}) {
  if (value === '' || value == null) {
    if (required) throw new Error(`${label}를 입력해주세요. 0원도 입력할 수 있습니다.`);
    return { amount: 0 };
  }
  let result;
  try { result = parseMoneyExpression(value); }
  catch (error) { throw new Error(`${label}은 0 이상의 정수 금액이어야 합니다. ${error.message}`); }
  if (expression) {
    try { const saved = parseMoneyExpression(expression); if (saved.amount === result.amount) result = saved; }
    catch { /* Old stale metadata cannot replace a valid numeric amount. */ }
  }
  return { amount: result.amount, ...(result.expression.includes('×') ? { expression: result.expression } : {}) };
}

export function normalizePaymentGrouping(row) {
  if (row.headcount == null && row.unitAmount == null) return row;
  const total = normalizeMoneyInput(row.amount,row.amountExpression,{required:true});
  const parts = total.expression?.split('×');
  if (parts?.length === 2) {
    const count = Number(parts[1]), unit = parseMoneyExpression(parts[0]);
    if (Number.isInteger(count) && count > 0 && count <= 1000 && unit.amount * count === total.amount) {
      const employeeName = row.employeeName?.replace(/^작업자 \d+명 \(묶음 (\d+)\)$/,`작업자 ${count}명 (묶음 $1)`);
      return {...row,headcount:count,unitAmount:unit.amount,unitAmountExpression:unit.expression,...(employeeName?{employeeName}:{})};
    }
  }
  if (row.unitAmount != null && parseMoneyExpression(row.unitAmount).amount * row.headcount === total.amount) return row;
  const next = {...row};delete next.headcount;delete next.unitAmount;delete next.unitAmountExpression;
  if(next.employeeName)next.employeeName=next.employeeName.replace(/^작업자 \d+명 \(묶음 (\d+)\)$/,'작업자 지급 묶음 $1');
  return next;
}
