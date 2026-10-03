import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import type { DateRule, TimeExpression } from '../types/messages';

// Reuse Chrono's merging and overlap removal for bilingual date/clock expressions.
const dateParser = chrono.en.casual.clone();
dateParser.parsers.push(...chrono.ja.casual.parsers);
dateParser.refiners.unshift(...chrono.ja.casual.refiners);

// Short zone names require uppercase: ordinary words such as "at" must not match.
export const ZONE_PATTERN = /\b(?:UTC|GMT)(?:[+-](?:\d{1,2}:\d{2}|\d{4}|\d{1,2}))?(?![\w:+-])|\b(?:PST|PDT|EST|EDT|CST|CDT|MST|MDT|PT|ET|CT|MT)\b/g;
export function validTimestamp(value: string | undefined): DateTime | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return;
  const parsed = DateTime.fromISO(value, { setZone: true });
  return parsed.isValid ? parsed.toUTC() : undefined;
}
export function parseExpression(text: string, postedAtUtc?: string): TimeExpression | { reason: string } {
  if (!text.trim() || text.length > 20_000) return { reason: 'ポスト本文を取得できませんでした。' };
  const zones = [...text.matchAll(ZONE_PATTERN)];
  const stripped = text.replace(ZONE_PATTERN, match => ' '.repeat(match.length));
  const reference = validTimestamp(postedAtUtc)?.toJSDate() ?? new Date('2000-01-01T12:00:00Z');
  const matches = dateParser.parse(stripped, { instant: reference, timezone: 0 })
    .filter(match => !/^now$/i.test(match.text.trim()));
  if (matches.length === 0) return { reason: '変換できる日時表現が見つかりませんでした。' };
  if (matches.length !== 1 || matches[0]?.end) return { reason: '複数の日時や時間範囲の同時変換には対応していません。' };
  const match = matches[0]!;
  const end = match.index + match.text.trimEnd().length;
  const clause = text.slice(0, end).split(/[。！？!?]/).at(-1)!;
  const tomorrow = match.tags().has('casualReference/tomorrow');
  const supportedRelative = tomorrow || match.tags().has('casualReference/today') || /\btonight\b|今夜|こんや|今晩|こんばん|今夕|こんゆう|今朝|けさ/i.test(match.text);
  // ponytail: bounded Japanese relative vocabulary; add local-day rules before accepting more modifiers.
  if (/\b(last|previous|yesterday)\b/i.test(match.text) || match.tags().has('casualReference/yesterday') ||
      /明後日|あさって|あす|翌日|毎日|(?:来|再来|先|今|翌|毎)週|次の|前の|(?:今|来|去|翌|毎)年|同年|本年|(?:来|先|翌|毎)月|\d+\s*(?:日|週間?|か月|ヶ月|時間|分)(?:後|前)/.test(clause) ||
      (!supportedRelative && match.tags().has('result/relativeDate'))) {
    return { reason: 'この相対日時表現には対応していません。' };
  }
  if (!match.start.isCertain('hour')) return { reason: '時刻が明示されていないため変換できません。' };
  if ((match.start.get('second') ?? 0) !== 0) return { reason: '秒を含む時刻には対応していません。' };
  if (zones.length === 0) return { reason: 'タイムゾーンを特定できませんでした。' };
  if (zones.length !== 1) return { reason: '複数のタイムゾーンの同時変換には対応していません。' };
  const zone = zones[0]!;
  // Associate a zone only with this expression, not an unrelated sentence.
  const after = zone.index >= end && /^[\s,()]*$/.test(text.slice(end, zone.index));
  const before = zone.index + zone[0].length <= match.index && /^[\s,():]*$/.test(text.slice(zone.index + zone[0].length, match.index));
  if (!after && !before) return { reason: '日時に対応するタイムゾーンを特定できませんでした。' };
  let date: DateRule;
  if (supportedRelative) {
    date = { kind: 'relative', days: tomorrow ? 1 : 0 };
  } else if (match.start.isCertain('weekday') && !match.start.isCertain('month')) {
    date = { kind: 'weekday', weekday: match.start.get('weekday') || 7, nextWeek: /\bnext\b/i.test(match.text) };
  } else if (match.start.isCertain('month') && match.start.isCertain('day')) {
    date = { kind: 'absolute', month: match.start.get('month')!, day: match.start.get('day')!,
      ...(match.start.isCertain('year') ? { year: match.start.get('year')! } : {}) };
  } else if (!match.start.isCertain('day') && !match.start.isCertain('month') && !match.start.isCertain('year')) {
    date = { kind: 'posted-day' };
  } else return { reason: 'この日付表現には対応していません。' };
  const start = Math.min(match.index, zone.index);
  return { raw: text.slice(start, Math.max(end, zone.index + zone[0].length)).trim(), index: start,
    hour: match.start.get('hour')!, minute: match.start.get('minute') ?? 0, timezoneToken: zone[0], date };
}
