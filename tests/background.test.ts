import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createService } from '../src/background/service';
import { resolveLocal } from '../src/core/resolver';
import { validateChoice } from '../src/background/jev-client';
const POST = '2026-10-02T02:14:00Z';
const runtime = { id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension/${path}`, openOptionsPage: vi.fn() };
const sender = { id: runtime.id, url: 'https://x.com/home', tab: { id: 1 } } as chrome.runtime.MessageSender;
const optionsSender = { id: runtime.id, url: runtime.getURL('options/index.html') };
function fixture() {
  const result = resolveLocal({ text: 'Tomorrow at 10am PST', postedAtUtc: POST });
  if (result.status !== 'ambiguous') throw new Error('Expected candidates');
  const ids = result.candidates.map(c => c.id);
  const choice = { choice: ids[0], confidence: .91, probabilities: { [ids[0]!]: .88, [ids[1]!]: .07, unresolved: .05 } };
  return { message: { type: 'RESOLVE_TIME_AMBIGUITY', payload: { tweetText: 'Tomorrow at 10am PST', postedAtUtc: POST, expression: result.expression, candidates: result.candidates } }, choice, ids };
}
function storage(key: unknown = 'test-api-key') {
  let value = key;
  return { setAccessLevel: vi.fn(async () => undefined), get: vi.fn(async () => ({ apiKey: value })), set: vi.fn(async (record: { apiKey: string }) => { value = record.apiKey; }), remove: vi.fn(async () => { value = undefined; }) };
}
beforeEach(() => { vi.stubGlobal('chrome', { runtime }); });
describe('worker and API contract', () => {
  it('restricts storage before reading keys and returns only validated choices', async () => {
    const store = storage(); const { message, choice } = fixture();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ answers: { timezone_intent: { type: 'choice', ...choice } } })));
    const service = createService(store as unknown as chrome.storage.LocalStorageArea, fetcher);
    const response = await service.handle(message, sender);
    expect(store.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(store.setAccessLevel.mock.invocationCallOrder[0]).toBeLessThan(store.get.mock.invocationCallOrder[0]!);
    expect(response).toEqual({ ok: true, result: choice });
    const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[1].credentials).toBe('omit'); expect(init[1].redirect).toBe('error');
    expect(JSON.stringify(response)).not.toContain('test-api-key');
    const state = JSON.parse(init[1].body as string).state;
    expect(JSON.stringify(state)).not.toContain('test-api-key');
    expect(Object.keys(state)).toEqual(['tweet_text', 'posted_at_utc', 'extracted_expression', 'candidates']);
    expect(state.candidates.regional_pst).toMatchObject({ interpretation: '夏時間として読む', source_zone: 'America/Los_Angeles', utc_offset_minutes: -420, regional_daylight_saving: true, calculation_note: expect.stringContaining('原文はPST') });
    expect(state.candidates.literal_pst).toMatchObject({ interpretation: 'PST表記どおりに読む', utc_offset_minutes: -480, regional_daylight_saving: null });
  });
  it('rebuilds seasonal facts rather than forwarding extra fields', async () => {
    const { message, choice } = fixture();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ answers: { timezone_intent: { type: 'choice', ...choice } } })));
    const service = createService(storage() as unknown as chrome.storage.LocalStorageArea, fetcher);
    expect(await service.handle({ ...message, payload: { ...message.payload, regional_daylight_saving: 'forged', originalText: 'old post' } }, sender)).toMatchObject({ ok: true });
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.state).not.toHaveProperty('regional_daylight_saving');
    expect(body.state).not.toHaveProperty('original_text');
    expect(body.questions.timezone_intent.instructions).toContain('mismatch alone does not prove author intent');
  });
  it.each([401, 429, 500])('falls back on HTTP %s', async status => {
    const service = createService(storage() as unknown as chrome.storage.LocalStorageArea, vi.fn(async () => new Response('', { status })));
    expect(await service.handle(fixture().message, sender)).toMatchObject({ ok: false, error: { code: 'JEV_UNAVAILABLE' } });
  });
  it('does not fetch with an unset key or a unique time', async () => {
    const fetcher = vi.fn(); const service = createService(storage(undefined) as unknown as chrome.storage.LocalStorageArea, fetcher);
    // Explicit null avoids the fixture's default parameter.
    const unset = createService(storage(null) as unknown as chrome.storage.LocalStorageArea, fetcher);
    expect(await unset.handle(fixture().message, sender)).toMatchObject({ ok: false, error: { code: 'KEY_NOT_SET' } });
    const unique = fixture().message; unique.payload.tweetText = 'Tomorrow at 10am PT';
    expect(await service.handle(unique, sender)).toMatchObject({ ok: false }); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { choice: 'unknown' }, { confidence: NaN }, { confidence: 1.1 }, { confidence: -.1 },
    { probabilities: { unknown: 1 } }, { probabilities: null }, { choice: 'literal_pst' },
  ])('rejects malformed or contradictory choices %j', override => {
    const { choice, ids } = fixture(); expect(validateChoice({ ...choice, ...override }, ids)).toBeUndefined();
  });
  it('keeps API calls out of content and rejects forged messages/senders', async () => {
    const fetcher = vi.fn(); const store = storage(); const service = createService(store as unknown as chrome.storage.LocalStorageArea, fetcher);
    expect(await service.handle(fixture().message, { ...sender, url: 'https://evil.example/' })).toMatchObject({ ok: false });
    expect(await service.handle(fixture().message, { ...sender, id: 'another-extension' })).toMatchObject({ ok: false });
    const forged = fixture().message; forged.payload.candidates[0]!.jstDateTime = 'evil';
    expect(await service.handle(forged, sender)).toMatchObject({ ok: false });
    expect(await service.handle({ type: 'SAVE_API_KEY', key: 'evil' }, sender)).toMatchObject({ ok: false });
    expect(fetcher).not.toHaveBeenCalled(); expect(store.set).not.toHaveBeenCalled();
  });
  it('saves/deletes keys only for options, never sends the key in status', async () => {
    const store = storage(null); const service = createService(store as unknown as chrome.storage.LocalStorageArea);
    expect(await service.handle({ type: 'SAVE_API_KEY', key: 'new-secret' }, optionsSender)).toEqual({ ok: true });
    expect(await service.handle({ type: 'GET_KEY_STATUS' }, optionsSender)).toEqual({ ok: true, configured: true });
    expect(await service.handle({ type: 'DELETE_API_KEY' }, optionsSender)).toEqual({ ok: true });
    expect(await service.handle({ type: 'GET_KEY_STATUS' }, optionsSender)).toEqual({ ok: true, configured: false });
  });
  it('fails closed when the storage restriction fails', async () => {
    const store = storage(); store.setAccessLevel.mockRejectedValue(new Error('denied'));
    const fetcher = vi.fn(); const service = createService(store as unknown as chrome.storage.LocalStorageArea, fetcher);
    expect(await service.handle(fixture().message, sender)).toMatchObject({ ok: false });
    expect(store.get).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('deduplicates simultaneous requests', async () => {
    const { message, choice } = fixture();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ answers: { timezone_intent: { type: 'choice', ...choice } } })));
    const service = createService(storage() as unknown as chrome.storage.LocalStorageArea, fetcher);
    const result = await Promise.all([service.handle(message, sender), service.handle(message, sender)]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(result[0]).toEqual(result[1]);
  });
  it('times out an API call and returns fallback', async () => {
    vi.useFakeTimers();
    try {
      const fetcher: typeof fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
      const service = createService(storage() as unknown as chrome.storage.LocalStorageArea, fetcher);
      const promise = service.handle(fixture().message, sender);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(await promise).toMatchObject({ ok: false, error: { code: 'JEV_UNAVAILABLE' } });
    } finally { vi.useRealTimers(); }
  });
  it('cancels an in-flight judgment when the key is deleted', async () => {
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    const fetcher: typeof fetch = vi.fn((_url, init) => { entered(); return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))); });
    const store = storage(); const service = createService(store as unknown as chrome.storage.LocalStorageArea, fetcher);
    const pending = service.handle(fixture().message, sender); await started;
    await service.handle({ type: 'DELETE_API_KEY' }, optionsSender);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'JEV_UNAVAILABLE' } });
    expect(await service.handle(fixture().message, sender)).toMatchObject({ ok: false, error: { code: 'KEY_NOT_SET' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a response with the wrong primitive or invalid JSON', async () => {
    for (const text of ['not-json', JSON.stringify({ answers: { timezone_intent: { type: 'score', ...fixture().choice } } })]) {
      const service = createService(storage() as unknown as chrome.storage.LocalStorageArea, vi.fn(async () => new Response(text)));
      expect(await service.handle(fixture().message, sender)).toMatchObject({ ok: false, error: { code: 'JEV_UNAVAILABLE' } });
    }
  });
});
