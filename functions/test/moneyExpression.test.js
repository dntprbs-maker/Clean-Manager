import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyExpression } from '../lib/moneyExpression.js';

const KOREAN = /[가-힣]/;

function expectResult(input, amount, expression) {
  assert.deepEqual(parseMoneyExpression(input), { amount, expression });
}

function expectInvalid(input) {
  assert.throws(
    () => parseMoneyExpression(input),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(typeof err.message, 'string');
      assert.ok(KOREAN.test(err.message), `expected Korean message, got: ${err.message}`);
      return true;
    },
  );
}

test('valid multiplication chains', () => {
  expectResult('15000*37', 555000, '15000×37');
  expectResult('100000×4', 400000, '100000×4');
  expectResult('15,000 x 37', 555000, '15000×37');
  expectResult('15000 X 37.5', 562500, '15000×37.5');
  expectResult('1.5×10000', 15000, '1.5×10000');
});

test('normalizes whitespace, fullwidth digits and operators', () => {
  expectResult('  15,000   x   37  ', 555000, '15000×37');
  expectResult('１２３４５×２', 24690, '12345×2');
  expectResult('５ｘ５', 25, '5×5');
  expectResult('5＊5', 25, '5×5');
});

test('plain amount inputs stay compatible', () => {
  expectResult(15000, 15000, '15000');
  expectResult('15000', 15000, '15000');
  expectResult('15,000', 15000, '15000');
  expectResult(0, 0, '0');
  expectResult('0', 0, '0');
  expectResult(9007199254740991, 9007199254740991, '9007199254740991');
});

test('exact arithmetic with fractional factors', () => {
  expectResult('1.5×2', 3, '1.5×2');
  expectResult('0.5×10000', 5000, '0.5×10000');
  expectResult('12.5×8', 100, '12.5×8');
  expectResult('0.25×4', 1, '0.25×4');
  expectResult('0.000000×5', 0, '0.000000×5');
});

test('multiple factors and zero', () => {
  expectResult('2×3×4', 24, '2×3×4');
  expectResult('2×2×2×2×2×2×2×2', 256, '2×2×2×2×2×2×2×2');
  expectResult('0×123456789', 0, '0×123456789');
});

test('comma grouping before decimal', () => {
  expectResult('1,000,000×1', 1000000, '1000000×1');
  expectResult('15,000.50×2', 30001, '15000.50×2');
});

test('rejects empty and non-numeric input', () => {
  expectInvalid('');
  expectInvalid('   ');
  expectInvalid('abc');
  expectInvalid('12abc');
  expectInvalid('NaN');
  expectInvalid('Infinity');
  expectInvalid('-Infinity');
});

test('rejects negative and signs', () => {
  expectInvalid('-5');
  expectInvalid('-0.5');
  expectInvalid('1+1');
  expectInvalid('1-1');
});

test('rejects division, parentheses and code', () => {
  expectInvalid('1/2');
  expectInvalid('1(2)');
  expectInvalid('(()=>{})()');
  expectInvalid('process.exit(1)');
  expectInvalid("require('fs')");
});

test('rejects malformed comma grouping', () => {
  expectInvalid('1,00');
  expectInvalid(',100');
  expectInvalid('1000,');
  expectInvalid('1,,000');
  expectInvalid('1,0000');
  expectInvalid('1000,000');
});

test('rejects invalid or trailing operators', () => {
  expectInvalid('5×');
  expectInvalid('×5');
  expectInvalid('5××5');
  expectInvalid('5*');
  expectInvalid('*5');
  expectInvalid('×');
});

test('rejects malformed decimals and exponent notation', () => {
  expectInvalid('1..2');
  expectInvalid('1.2.3');
  expectInvalid('1.');
  expectInvalid('.5');
  expectInvalid('1e3');
  expectInvalid('1E3');
  expectInvalid('1e+3');
});

test('rejects limit violations', () => {
  expectInvalid('1.1234567×1');
  expectInvalid('1234567890123456789×1');
  expectInvalid('2×2×2×2×2×2×2×2×2');
  expectInvalid('1'.repeat(101));
});

test('rejects fractional won and overflow', () => {
  expectInvalid('1.5×3');
  expectInvalid('0.1×0.1');
  expectInvalid('9007199254740992');
  expectInvalid('999999999999999999');
  expectInvalid('999999999999999999×999999999999999999');
});

test('rejects non string/number types and bad numbers', () => {
  expectInvalid(null);
  expectInvalid(undefined);
  expectInvalid({});
  expectInvalid([]);
  expectInvalid(true);
  expectInvalid(NaN);
  expectInvalid(Infinity);
  expectInvalid(-Infinity);
  expectInvalid(-5);
  expectInvalid(1.5);
});

test('injection strings are rejected, not executed', () => {
  globalThis.__moneyPwned = false;
  expectInvalid('1;globalThis.__moneyPwned=true');
  expectInvalid('${1+1}');
  expectInvalid('1\n+2');
  assert.equal(globalThis.__moneyPwned, false);
  delete globalThis.__moneyPwned;
});
