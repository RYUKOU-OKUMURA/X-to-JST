import { DateTime } from 'luxon';
import type { TimeCandidate } from '../types/messages';
export function interpretationLabel(candidate: TimeCandidate, timezoneToken: string): string {
  if (!candidate.sourceZone.includes('/')) return `${timezoneToken}表記どおりに読む`;
  return DateTime.fromISO(candidate.sourceDateTime, { setZone: true }).setZone(candidate.sourceZone).isInDST
    ? '夏時間として読む' : '現地の標準時として読む';
}
export function formatSource(candidate: TimeCandidate): string {
  return DateTime.fromISO(candidate.sourceDateTime, { setZone: true }).toFormat("yyyy/M/d HH:mm 'UTC'ZZ");
}
export function formatJst(candidate: TimeCandidate): string {
  return DateTime.fromISO(candidate.jstDateTime, { setZone: true }).setZone('Asia/Tokyo').setLocale('ja').toFormat('yyyy年M月d日（ccc）HH:mm') + ' JST';
}
export function copyText(candidate: TimeCandidate): string { return `日本時間 ${formatJst(candidate)}`; }
