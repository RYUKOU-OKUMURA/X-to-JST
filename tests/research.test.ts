import { beforeEach, expect, it, vi } from 'vitest';
import { createResearchService } from '../src/background/research-service';
import { decodeJudge, makePost, validatePost, type ResearchPost } from '../src/core/research';
import { decodeResearchAnswers, makeResearchRequest } from '../src/background/research-jev';
const sender = { id: 'extension', url: 'https://x.com/home', tab: { id: 1 } } as chrome.runtime.MessageSender;
const post = (id = '123'): ResearchPost => ({ id, text: 'AI workflow', url: `https://x.com/user/status/${id}`, savedAt: '2026-10-02T00:00:00Z', source: 'timeline', note: 'private note' });
function store() {
  const data: Record<string, unknown> = { apiKey: 'secret' };
  return { data, get: vi.fn(async (key: unknown) => key === null ? { ...data } : { [key as string]: data[key as string] }), set: vi.fn(async (records: Record<string, unknown>) => { Object.assign(data, records); }), remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }) };
}
beforeEach(() => vi.stubGlobal('chrome', { runtime: { id: 'extension' } }));
it('normalizes post links and rejects unsafe records and timestamps', () => {
  expect(validatePost({ ...post(), url: post().url + '?s=20' })?.url).toBe(post().url);
  expect(validatePost({ ...post(), url: 'https://x.com.evil/user/status/123' })).toBeUndefined();
  expect(validatePost({ ...post(), id: '999' })).toBeUndefined();
  expect(validatePost({ ...post(), savedAt: 'garbage' })).toBeUndefined();
  expect(makePost({ text: 'no timestamp', url: post().url }, 'bookmarks')).toMatchObject({ id: '123', text: 'no timestamp' });
});
it('serializes concurrent saves and keeps storage/key out of export', async () => {
  const storage = store(); const service = createResearchService(storage as unknown as chrome.storage.LocalStorageArea);
  expect(await Promise.all(['123', '124'].map(id => service.handle({ type: 'RESEARCH_SAVE', post: post(id) }, sender)))).toEqual(expect.arrayContaining([expect.objectContaining({ ok: true })]));
  const result = await service.handle({ type: 'RESEARCH_EXPORT' }, sender);
  expect(result).toMatchObject({ ok: true, backup: { version: 1, posts: expect.any(Array) } });
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(Object.keys(storage.data)).toHaveLength(3);
});
it('fails invalid import before mutation and preserves notes on changed-body update', async () => {
  const storage = store(); const service = createResearchService(storage as unknown as chrome.storage.LocalStorageArea);
  await service.handle({ type: 'RESEARCH_SAVE', post: post() }, sender);
  const writes = storage.set.mock.calls.length;
  expect(await service.handle({ type: 'RESEARCH_IMPORT', backup: { version: 1, posts: [post('124'), { ...post('125'), url: 'https://evil/' }] } }, sender)).toMatchObject({ ok: false });
  expect(storage.set.mock.calls).toHaveLength(writes);
  expect(await service.handle({ type: 'RESEARCH_SAVE', post: { ...post(), text: 'changed', note: '' } }, sender)).toMatchObject({ ok: false, error: { code: 'POST_CHANGED' } });
  expect(await service.handle({ type: 'RESEARCH_SAVE', post: { ...post(), text: 'changed', note: '' }, update: true }, sender)).toMatchObject({ ok: true, posts: [{ text: 'changed', note: 'private note' }] });
});
it('enforces 200-record limits without deleting existing records', async () => {
  const storage = store(); const service = createResearchService(storage as unknown as chrome.storage.LocalStorageArea);
  await service.handle({ type: 'RESEARCH_IMPORT', backup: { version: 1, posts: Array.from({ length: 200 }, (_, index) => post(String(index + 1))) } }, sender);
  expect(await service.handle({ type: 'RESEARCH_SAVE', post: post('999') }, sender)).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
  expect(storage.remove).not.toHaveBeenCalled();
});
it('restores only new IDs and keeps a newer saved memo and body', async () => {
  const storage = store(); const service = createResearchService(storage as unknown as chrome.storage.LocalStorageArea);
  await service.handle({ type: 'RESEARCH_SAVE', post: { ...post(), text:'new body', note:'new note' } }, sender);
  expect(await service.handle({ type:'RESEARCH_IMPORT', backup:{ version:1, posts:[post(),post('124')] } },sender)).toMatchObject({ok:true,posts:expect.arrayContaining([expect.objectContaining({id:'123',text:'new body',note:'new note'}),expect.objectContaining({id:'124'})])});
});
it('rejects untrusted senders and forwards only explicit notes with one question per post', async () => {
  const storage = store(); const fetcher = vi.fn(); const service = createResearchService(storage as unknown as chrome.storage.LocalStorageArea, fetcher);
  expect(await service.handle({ type: 'RESEARCH_LIST' }, { ...sender, url: 'https://x.com.evil/' })).toMatchObject({ ok: false });
  expect(storage.get).not.toHaveBeenCalled();
  const payload = decodeJudge({ mode: 'search', query: 'automation', posts: [post()], includeNotes: false, requestId: 'run' })!;
  const request = makeResearchRequest(payload);
  expect(JSON.stringify(request)).not.toContain('private note');
  expect(Object.keys(request.questions)).toEqual(['post_0']);
  expect(decodeResearchAnswers({ answers: { post_0: { type: 'score', score: 3, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1 } } } }, payload)).toMatchObject([{ id: '123', score: 1 }]);
  expect(decodeResearchAnswers({ answers: { post_0: { type: 'score', score: 0, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1 } } } }, payload)).toBeUndefined();
});
it('cancels active judgment and suppresses late responses', async () => {
  const storage = store(); let finish!: (response: Response) => void; let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const fetcher: typeof fetch = vi.fn(async () => { started(); return new Promise<Response>(resolve => { finish = resolve; }); });
  const service = createResearchService(storage as unknown as chrome.storage.LocalStorageArea, fetcher);
  const pending = service.handle({ type: 'RESEARCH_JUDGE', payload: { mode: 'search', query: 'AI', posts: [post()], includeNotes: false, requestId: 'run' } }, sender);
  await entered;
  await service.handle({ type: 'RESEARCH_CANCEL', requestId: 'run' }, sender);
  finish(new Response(JSON.stringify({ answers: { post_0: { type: 'score', score: 3, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1 } } }, usage: { input_tokens: 100, output_tokens: 10 } })));
  expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
});
it('returns sanitized actual token usage and validates relationship candidates', async () => {
  const probabilities = { followup: 0, change: 0, example: 0, same: 0, unrelated: 0, unknown: 1 };
  const storage = store();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ answers: { post_0: { type: 'choice', choice: 'unknown', confidence: 1, probabilities } }, usage: { input_tokens: 123, output_tokens: 45, secret: 'leak' }, secret: 'leak' })));
  const service = createResearchService(storage as unknown as chrome.storage.LocalStorageArea, fetcher);
  expect(await service.handle({ type: 'RESEARCH_JUDGE', payload: { mode: 'relate', query: '', posts: [post('124')], anchor: post(), includeNotes: false, requestId: 'relation' } }, sender)).toEqual({ ok: true, results: [{ id: '124', relation: 'unknown', confidence: 1, probabilities }], usage: { input_tokens: 123, output_tokens: 45 } });
  const request = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(request.state.anchor.note).toBeUndefined();
  expect(request.questions.post_0.instructions).toContain('posts[0]');
});
it('clears only research keys and rejects invalid calendar dates', async () => {
  const storage = store(); storage.data.unrelated = 'keep'; const service = createResearchService(storage as unknown as chrome.storage.LocalStorageArea);
  await service.handle({ type: 'RESEARCH_SAVE', post: post() }, sender);
  expect(await service.handle({ type: 'RESEARCH_CLEAR' }, sender)).toEqual({ ok: true, posts: [] });
  expect(storage.data).toEqual({ apiKey: 'secret', unrelated: 'keep' });
  expect(validatePost({ ...post(), savedAt: '2026-02-30T00:00:00Z' })).toBeUndefined();
});
