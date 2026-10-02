import { FixedOffsetZone } from 'luxon';
export type ZoneInterpretation = { id: string; zone: string | FixedOffsetZone; label: string; regional: boolean };
const regions: Record<string, string> = { P: 'America/Los_Angeles', E: 'America/New_York', C: 'America/Chicago', M: 'America/Denver' };
const offsets: Record<string, number> = { PST: -480, PDT: -420, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360 };
export function zoneInterpretations(token: string): ZoneInterpretation[] {
  if (token === 'UTC' || token === 'GMT') return [{ id: 'utc', zone: 'UTC', label: token, regional: false }];
  const offset = /^(UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(token);
  if (offset) {
    const hours = Number(offset[3]), minutes = Number(offset[4] ?? 0);
    if (minutes >= 60 || hours > 14 || (hours === 14 && minutes !== 0)) return [];
    const value = (hours * 60 + minutes) * (offset[2] === '-' ? -1 : 1);
    return [{ id: 'explicit_offset', zone: FixedOffsetZone.instance(value), label: token, regional: false }];
  }
  const region = regions[token[0] ?? ''];
  if (!region) return [];
  if (/^[PECM]T$/.test(token)) return [{ id: `regional_${token.toLowerCase()}`, zone: region, label: `${region}の現地時間`, regional: true }];
  const fixed = offsets[token];
  if (fixed === undefined) return [];
  return [
    { id: `regional_${token.toLowerCase()}`, zone: region, label: `${region}の現地時間`, regional: true },
    { id: `literal_${token.toLowerCase()}`, zone: FixedOffsetZone.instance(fixed), label: `${token}を固定UTCオフセットとして解釈`, regional: false },
  ];
}
