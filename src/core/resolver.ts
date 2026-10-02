import type { JevChoice, Resolution, TimeCandidate, TweetContext } from '../types/messages';
import { parseExpression } from './parser';
import { buildCandidates } from './candidate-builder';
export const CONFIDENCE_THRESHOLD = 0.8;
export const PROBABILITY_GAP = 0.25;
export function resolveLocal(context: TweetContext): Resolution {
  const expression = parseExpression(context.text, context.postedAtUtc);
  if ('reason' in expression) return { status: 'unsupported', reason: expression.reason };
  const candidates = buildCandidates(expression, context.postedAtUtc);
  if (!candidates.length) return { status: 'unsupported', reason: '投稿日時・日付・タイムゾーンを確認してください。存在しない現地時刻は変換できません。' };
  if (candidates.length === 1) return { status: 'resolved', candidate: candidates[0]!, expression };
  return { status: 'ambiguous', candidates, expression };
}
export function chooseCandidate(choice: JevChoice, candidates: TimeCandidate[]): TimeCandidate | undefined {
  const ranked = Object.entries(choice.probabilities).sort((a, b) => b[1] - a[1]);
  if (choice.choice === 'unresolved' || choice.confidence < CONFIDENCE_THRESHOLD || ranked[0]?.[0] !== choice.choice || !ranked[1]) return;
  if (ranked[0][1] - ranked[1][1] + Number.EPSILON < PROBABILITY_GAP) return;
  return candidates.find(candidate => candidate.id === choice.choice);
}
