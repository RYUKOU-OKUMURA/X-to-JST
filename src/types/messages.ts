export type TweetContext = { text: string; postedAtUtc?: string; url?: string; lang?: string };
export type DateRule =
  | { kind: 'relative'; days: 0 | 1 }
  | { kind: 'weekday'; weekday: number; nextWeek: boolean }
  | { kind: 'absolute'; year?: number; month: number; day: number }
  | { kind: 'posted-day' };
export type TimeExpression = {
  raw: string; index: number; hour: number; minute: number;
  timezoneToken: string; date: DateRule;
};
export type TimeCandidate = {
  id: string; sourceZone: string; sourceDateTime: string; jstDateTime: string;
  reason: string; warning?: string;
};
export type Resolution =
  | { status: 'resolved'; candidate: TimeCandidate; expression: TimeExpression; jev?: JevChoice }
  | { status: 'ambiguous'; candidates: TimeCandidate[]; expression: TimeExpression; warning?: string; jev?: JevChoice }
  | { status: 'unsupported'; reason: string };
export type JevChoice = { choice: string; confidence: number; probabilities: Record<string, number> };
export type ResolveMessage = {
  type: 'RESOLVE_TIME_AMBIGUITY';
  payload: { tweetText: string; postedAtUtc?: string; expression: TimeExpression; candidates: TimeCandidate[] };
};
export type WorkerReply =
  | { ok: true; result: JevChoice }
  | { ok: false; error: { code: 'KEY_NOT_SET' | 'JEV_UNAVAILABLE' | 'INVALID_REQUEST'; message: string } };
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
