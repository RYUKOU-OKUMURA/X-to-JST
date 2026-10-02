import { isRecord, type TweetContext } from '../types/messages';
import { canonicalizeSearchQuery } from './search-query';
export const RESEARCH_PREFIX = 'research:post:';
export const MAX_RESEARCH_POSTS = 200;
export const MAX_RESEARCH_BYTES = 2 * 1024 * 1024;
export const MAX_RESEARCH_BATCH = 20;
export const MAX_RESEARCH_BATCH_CHARS = 60_000;
export const RESEARCH_SOURCES = ['timeline', 'bookmarks', 'post', 'other'] as const;
export type ResearchSource = typeof RESEARCH_SOURCES[number];
export interface ResearchPost { id: string; text: string; url: string; postedAtUtc?: string; lang?: string; savedAt: string; source: ResearchSource; note: string }
export interface ResearchBackup { version: 1; posts: ResearchPost[] }
export const RELATIONS = ['followup', 'change', 'example', 'same', 'unrelated', 'unknown'] as const;
export type ResearchRelation = typeof RELATIONS[number];
export interface ResearchResult { id: string; score?: number; relation?: ResearchRelation; confidence: number; probabilities: Record<string, number> }
export interface ResearchJudge { mode: 'search' | 'relate'; query: string; posts: ResearchPost[]; anchor?: ResearchPost; includeNotes: boolean; requestId: string }
export function normalizePostUrl(value: unknown): { id: string; url: string } | undefined {
  if (typeof value !== 'string' || value.length > 512) return;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://x.com' || url.username || url.password) return;
    const match = /^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/([1-9]\d{0,24})(?:\/(?:photo|video)\/\d+)?\/?$/.exec(url.pathname);
    return match ? { id: match[1]!, url: `https://x.com${url.pathname.replace(/\/(?:photo|video)\/\d+\/?$/, '').replace(/\/$/, '')}` } : undefined;
  } catch { return; }
}
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
export function validatePost(value: unknown): ResearchPost | undefined {
  if (!isRecord(value)) return;
  const link = normalizePostUrl(value.url);
  if (!link || value.id !== link.id || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 20_000 ||
    typeof value.note !== 'string' || value.note.length > 4_000 || !timestamp(value.savedAt) || !RESEARCH_SOURCES.includes(value.source as ResearchSource) ||
    (value.postedAtUtc !== undefined && !timestamp(value.postedAtUtc)) ||
    (value.lang !== undefined && (typeof value.lang !== 'string' || !/^[a-zA-Z0-9-]{1,35}$/.test(value.lang)))) return;
  return { id: link.id, text: value.text, url: link.url, savedAt: value.savedAt, source: value.source as ResearchSource, note: value.note,
    ...(value.postedAtUtc === undefined ? {} : { postedAtUtc: value.postedAtUtc }), ...(value.lang === undefined ? {} : { lang: value.lang as string }) };
}
export function makePost(context: TweetContext & { lang?: string }, source: ResearchSource): ResearchPost | undefined {
  const link = normalizePostUrl(context.url);
  return link ? validatePost({ ...link, text: context.text, postedAtUtc: context.postedAtUtc, lang: context.lang, source, savedAt: new Date().toISOString(), note: '' }) : undefined;
}
export function postBytes(value: ResearchPost | ResearchPost[]): number { const posts = Array.isArray(value) ? value : [value]; return new TextEncoder().encode(posts.map(post => post.text + post.note).join('')).byteLength; }
export function decodeRecords(value: unknown): ResearchPost[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_RESEARCH_POSTS) return;
  const posts = value.map(validatePost);
  if (posts.some(post => !post) || new Set(posts.map(post => post!.id)).size !== posts.length) return;
  const valid = posts as ResearchPost[];
  return postBytes(valid) <= MAX_RESEARCH_BYTES ? valid : undefined;
}
export function decodeJudge(value: unknown): ResearchJudge | undefined {
  if (!isRecord(value) || !['search', 'relate'].includes(value.mode as string) || typeof value.query !== 'string' || value.query.length > 2_000 ||
    (value.mode === 'search' && !value.query.trim()) || typeof value.includeNotes !== 'boolean' || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.requestId)) return;
  const query = canonicalizeSearchQuery(value.query);
  if (query.length > 2_000) return;
  const posts = decodeRecords(value.posts);
  const anchor = value.anchor === undefined ? undefined : validatePost(value.anchor);
  if (!posts?.length || posts.length > MAX_RESEARCH_BATCH || (value.mode === 'relate' && !anchor) || (value.anchor !== undefined && !anchor)) return;
  if (posts.reduce((sum, post) => sum + post.text.length + (value.includeNotes ? post.note.length : 0), query.length + (anchor?.text.length ?? 0) + (value.includeNotes ? anchor?.note.length ?? 0 : 0)) > MAX_RESEARCH_BATCH_CHARS) return;
  return { mode: value.mode as ResearchJudge['mode'], query, posts, anchor, includeNotes: value.includeNotes, requestId: value.requestId };
}
