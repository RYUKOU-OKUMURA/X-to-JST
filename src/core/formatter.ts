import { DateTime } from 'luxon';
import type { TimeCandidate } from '../types/messages';
export function formatJst(candidate: TimeCandidate): string {
  return DateTime.fromISO(candidate.jstDateTime, { setZone: true }).setZone('Asia/Tokyo').setLocale('ja').toFormat('yyyy年M月d日（ccc）HH:mm') + ' JST';
}
export function copyText(candidate: TimeCandidate): string { return `日本時間 ${formatJst(candidate)}`; }
