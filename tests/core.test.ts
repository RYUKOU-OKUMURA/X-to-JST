import { describe, expect, it } from 'vitest';
import { Settings } from 'luxon';
import { parseExpression } from '../src/core/parser';
import { buildCandidates } from '../src/core/candidate-builder';
import { resolveLocal, chooseCandidate } from '../src/core/resolver';
import { copyText, formatJst, formatSource } from '../src/core/formatter';
const POST = '2026-10-02T02:14:00Z';
function times(text: string, post: string | undefined = POST) {
  const result = resolveLocal({ text, postedAtUtc: post });
  if (result.status === 'unsupported') return [];
  return (result.status === 'resolved' ? [result.candidate] : result.candidates).map(c => c.jstDateTime.replace('.000', ''));
}
describe('deterministic date conversion', () => {
  it('converts the complete reported post in English and Japanese', () => {
    const english = "Global reset landing tomorrow 10am PST for all paid ChatGPT accounts. Apologies for the slow start with GPT-6.1 Sol, it's now back to running at expected speeds after the massive load spike in the first two days.";
    const japanese = '明日午前10時PSTに、全有料ChatGPTアカウント向けのグローバルリセット着陸が行われます。GPT-6.1 Solの開始が遅れたことについてお詫び申し上げます。最初の2日間の大量の負荷急増の後、現在は期待される速度で動作しています。';
    expect(times(english)).toEqual(['2026-10-03T02:00:00+09:00', '2026-10-03T03:00:00+09:00']);
    expect(times(japanese)).toEqual(times(english));
    expect(parseExpression(japanese, POST)).toMatchObject({ raw: '明日午前10時PST', index: 0, date: { kind: 'relative', days: 1 } });
  });
  it.each([
    ['明日の午前10時30分 PT', '2026-10-03T02:30:00+09:00'],
    ['今日午後7時PDT', '2026-10-02T11:00:00+09:00'],
    ['今夜午後7時PDT', '2026-10-02T11:00:00+09:00'],
    ['2026年10月2日15時 UTC', '2026-10-03T00:00:00+09:00'],
    ['PDT 明日午前10時', '2026-10-03T02:00:00+09:00'],
    ['今日22:00 UTC', '2026-10-03T07:00:00+09:00'],
    ['今年も開発を続けます。明日午前10時PTに公開します。', '2026-10-03T02:00:00+09:00'],
  ])('converts Japanese clocks without duplicate locale matches: %s', (text, expected) => {
    expect(times(text)).toEqual([expected]);
  });
  it('uses regional posting dates for Japanese relative rules', () => {
    expect(times('明日午前10時PST', '2026-10-02T07:30:00Z')).toEqual(['2026-10-04T02:00:00+09:00', '2026-10-03T03:00:00+09:00']);
    expect(times('今夜午後7時PDT', '2027-01-01T02:14:00Z')).toEqual(times('Tonight at 7pm PDT', '2027-01-01T02:14:00Z'));
    expect(resolveLocal({ text: '明日午前10時PT' }).status).toBe('unsupported');
  });
  it.each([
    'now PT', '10am PT and now 2pm', '10am PT, now tomorrow at 2pm',
    '明日午前10時から午後2時PT', '明日午前10時PT、午後2時',
    '明日午前10時30分20秒PT', '明日午前25時PT',
    '昨日午前10時PT', '明後日午前10時PT', '明後日\n午前10時PT', '来週金曜日午後2時PT',
    '次の金曜日午後2時PT', '今年10月2日午前10時PT',
    '毎週月曜日午前10時PST', '翌週月曜日午前10時PST',
    '毎月2日午前10時PST', '翌月2日午前10時PST',
  ])('does not silently discard actual clocks or unsupported Japanese dates: %s', text => {
    expect(times(text)).toEqual([]);
  });
  it('resolves tomorrow per regional and literal local posting dates', () => {
    expect(times('Tomorrow at 10am PST')).toEqual(['2026-10-03T02:00:00+09:00', '2026-10-03T03:00:00+09:00']);
    expect(times('Tomorrow at 10am PST', '2026-10-02T07:30:00Z')).toEqual(['2026-10-04T02:00:00+09:00', '2026-10-03T03:00:00+09:00']);
  });
  it.each([
    ['Tomorrow at 10am PT', '2026-10-03T02:00:00+09:00'],
    ['2026-10-02 15:00 UTC', '2026-10-03T00:00:00+09:00'],
    ['Friday at 2 PM ET', '2026-10-03T03:00:00+09:00'],
    ['Oct 5, 9am CT', '2026-10-05T23:00:00+09:00'],
    ['October 5, 9am MT', '2026-10-06T00:00:00+09:00'],
    ['Tonight at 7pm PDT', '2026-10-02T11:00:00+09:00'],
    ['2026-10-02 22:00 GMT+05:30', '2026-10-03T01:30:00+09:00'],
    ['2026-10-02 22:00 UTC-5', '2026-10-03T12:00:00+09:00'],
    ['next Friday at 2pm PT', '2026-10-10T06:00:00+09:00'],
  ])('%s', (text, expected) => { expect(times(text)).toEqual([expected]); });
  it.each(['PST', 'PDT', 'EST', 'EDT', 'CST', 'CDT', 'MST', 'MDT', 'PT', 'ET', 'CT', 'MT', 'UTC', 'GMT'])('extracts %s without assigning the relative day in JST', zone => {
    const result = parseExpression(`Tomorrow at 10:30 AM ${zone}`, POST);
    expect(result).toMatchObject({ timezoneToken: zone, hour: 10, minute: 30, date: { kind: 'relative', days: 1 } });
  });
  it('deduplicates matching regional and literal offsets in winter', () => {
    expect(times('2026-01-10 10am PST')).toEqual(['2026-01-11T03:00:00+09:00']);
  });
  it('adds calendar days over DST and year boundaries', () => {
    expect(times('Tomorrow at 10am PT', '2026-03-08T07:30:00Z')).toEqual(['2026-03-09T02:00:00+09:00']);
    expect(times('Tomorrow at 10am PT', '2027-01-01T02:00:00Z')).toEqual(['2027-01-02T03:00:00+09:00']);
  });
  it.each(['PT', 'ET', 'CT', 'MT'])('rejects the DST gap in %s', token => {
    expect(times(`2026-03-08 2:30am ${token}`)).toEqual([]);
  });
  it.each(['PT', 'ET', 'CT', 'MT'])('keeps both DST fold instants in %s', token => {
    const result = resolveLocal({ text: `2026-11-01 1:30am ${token}` });
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates.every(c => c.warning?.includes('重複'))).toBe(true);
      const millis = result.candidates.map(c => Date.parse(c.jstDateTime));
      expect(Math.abs(millis[0]! - millis[1]!)).toBe(3_600_000);
    }
  });
  it('uses the posting year for dates with no year', () => {
    expect(times('Jan 1 10am PT', '2026-12-31T20:00:00Z')).toEqual(['2026-01-02T03:00:00+09:00']);
  });
  it('allows fully specified dates without timestamp', () => {
    const absolute = resolveLocal({ text: '2026-10-02 15:00 UTC' });
    expect(absolute.status).toBe('resolved');
    if (absolute.status === 'resolved') expect(absolute.candidate.jstDateTime.replace('.000', '')).toBe('2026-10-03T00:00:00+09:00');
    expect(resolveLocal({ text: 'Tomorrow at 10am PT' }).status).toBe('unsupported');
    expect(resolveLocal({ text: 'Oct 5 at 10am PT' }).status).toBe('unsupported');
  });
  it.each(['Tomorrow at 10am', 'Tomorrow at 10am at the store', 'Tonight PT', '2026-02-30 10am PT', '2026-10-02 10am UTC+25:00', '2026-10-02 10am UTC+5:90', '2026-10-02 10am UTC+5:3', '2026-10-02 10am UTC+100', '2026-10-02 10:00:30 UTC', '10am PT and 2pm ET', '10am to 2pm PT', 'No time here'])('rejects unsupported input: %s', text => {
    expect(resolveLocal({ text, postedAtUtc: POST }).status).toBe('unsupported');
  });
  it('is independent of the host default time zone', () => {
    const original = Settings.defaultZone;
    try {
      Settings.defaultZone = 'Asia/Tokyo'; const a = times('Tomorrow at 10am PST');
      Settings.defaultZone = 'Pacific/Honolulu'; expect(times('Tomorrow at 10am PST')).toEqual(a);
    } finally { Settings.defaultZone = original; }
  });
  it.each(['yesterday 10am PT', 'last Friday 10am PT', 'in 2 hours PT', 'next week 10am PT'])('does not guess unsupported relative rules: %s', text => {
    expect(resolveLocal({ text, postedAtUtc: POST }).status).toBe('unsupported');
  });
  it('uses one consistent year/date/time for display and copy', () => {
    const expression = parseExpression('Tomorrow at 10am PT', POST);
    if ('reason' in expression) throw new Error(expression.reason);
    const c = buildCandidates(expression, POST)[0]!;
    expect(formatJst(c)).toBe('2026年10月3日（土）02:00 JST');
    expect(formatSource(c)).toBe('2026/10/2 10:00 UTC-07:00');
    expect(copyText(c)).toBe('日本時間 2026年10月3日（土）02:00 JST');
  });
  it('preserves the source offset and date when the Japan comparison crosses a year', () => {
    const result = resolveLocal({ text: '2026-12-31 23:30 UTC-08:00' });
    if (result.status !== 'resolved') throw new Error('Expected one candidate');
    expect(formatSource(result.candidate)).toBe('2026/12/31 23:30 UTC-08:00');
    expect(formatJst(result.candidate)).toBe('2027年1月1日（金）16:30 JST');
  });
  it('applies confidence and probability-gap thresholds', () => {
    const resolution = resolveLocal({ text: 'Tomorrow at 10am PST', postedAtUtc: POST });
    if (resolution.status !== 'ambiguous') throw new Error('Expected candidates');
    const ids = resolution.candidates.map(c => c.id);
    const choice = { choice: ids[0]!, confidence: .8, probabilities: { [ids[0]!]: .6, [ids[1]!]: .35, unresolved: .05 } };
    expect(chooseCandidate(choice, resolution.candidates)).toBe(resolution.candidates[0]);
    expect(chooseCandidate({ ...choice, confidence: .799 }, resolution.candidates)).toBeUndefined();
    expect(chooseCandidate({ ...choice, probabilities: { [ids[0]!]: .599, [ids[1]!]: .351, unresolved: .05 } }, resolution.candidates)).toBeUndefined();
    expect(chooseCandidate({ ...choice, choice: 'unknown' }, resolution.candidates)).toBeUndefined();
  });
});
