import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEventText } from '../src/lib/eventTextParser.js';

test('상대 날짜는 기기 시간대와 무관하게 한국 날짜와 월요일 기준을 따른다', () => {
  const OriginalDate = globalThis.Date;
  const cases = [
    ['2026-11-06T14:59:59Z', '내일', '2026-11-07'],
    ['2026-11-06T15:00:00Z', '내일', '2026-11-08'],
    ['2026-11-07T03:00:00Z', '다음 주 월요일', '2026-11-09'],
    ['2026-11-07T03:00:00Z', '다음주 화요일', '2026-11-10'],
    ['2026-11-30T15:00:00Z', '모레', '2026-12-03'],
    ['2026-12-31T15:00:00Z', '1월 5일', '2027-01-05'],
    ['2026-11-06T15:00:00Z', '2026-12-03 내일', '2026-12-03'],
  ];
  try {
    for (const [instant, text, expected] of cases) {
      globalThis.Date = class extends OriginalDate {
        constructor(...args) { super(...(args.length ? args : [instant])); }
        static now() { return OriginalDate.parse(instant); }
      };
      const result = parseEventText(text);
      assert.equal(result.start, expected, text);
      assert.equal(result.end, expected, text);
    }
  } finally { globalThis.Date = OriginalDate; }
});
