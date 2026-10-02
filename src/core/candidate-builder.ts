import { DateTime } from 'luxon';
import type { TimeCandidate, TimeExpression } from '../types/messages';
import { validTimestamp } from './parser';
import { zoneInterpretations } from './timezone';

export function buildCandidates(expression: TimeExpression, postedAtUtc?: string): TimeCandidate[] {
  const posted = validTimestamp(postedAtUtc);
  const rule = expression.date;
  if (!posted && !(rule.kind === 'absolute' && rule.year)) return [];
  const result: TimeCandidate[] = [];
  const interpretations = zoneInterpretations(expression.timezoneToken);
  for (const interpretation of interpretations) {
    const local = posted?.setZone(interpretation.zone);
    let date: { year: number; month: number; day: number };
    if (rule.kind === 'absolute') date = { year: rule.year ?? local!.year, month: rule.month, day: rule.day };
    else {
      let day = local!.startOf('day');
      if (rule.kind === 'relative') day = day.plus({ days: rule.days });
      if (rule.kind === 'weekday') {
        const distance = rule.nextWeek ? 7 - day.weekday + rule.weekday : (rule.weekday - day.weekday + 7) % 7;
        day = day.plus({ days: distance });
      }
      date = { year: day.year, month: day.month, day: day.day };
    }
    const intended = { ...date, hour: expression.hour, minute: expression.minute, second: 0, millisecond: 0 };
    const zoned = DateTime.fromObject(intended, { zone: interpretation.zone });
    if (!zoned.isValid || Object.entries(intended).some(([key, value]) => zoned.get(key as keyof typeof intended) !== value)) continue;
    const possible = zoned.getPossibleOffsets();
    for (const value of possible) {
      // Prefer regional metadata if fixed and regional yield the same instant.
      if (result.some(candidate => DateTime.fromISO(candidate.jstDateTime).toMillis() === value.toMillis())) continue;
      const literal = interpretations.find(zone => !zone.regional);
      const mismatch = interpretation.regional && literal && typeof literal.zone !== 'string' && value.offset !== literal.zone.offset(value.toMillis());
      const warnings = [mismatch ? `原文は${expression.timezoneToken}ですが、この日の現地時間は${value.offsetNameShort}です。` : '', possible.length > 1 ? '夏時間終了で現地時刻が重複しています。' : ''].filter(Boolean);
      result.push({ id: `${interpretation.id}${possible.length > 1 ? `_offset_${value.offset}` : ''}`,
        sourceZone: value.zoneName!, sourceDateTime: value.toISO()!, jstDateTime: value.setZone('Asia/Tokyo').toISO()!,
        reason: interpretation.label, ...(warnings.length ? { warning: warnings.join(' ') } : {}) });
    }
  }
  return result;
}
