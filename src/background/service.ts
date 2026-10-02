import { isRecord, type ResolveMessage, type WorkerReply } from '../types/messages';
import { resolveLocal } from '../core/resolver';
import { JEV_TIMEOUT_MS, requestJev } from './jev-client';
type Storage = Pick<chrome.storage.LocalStorageArea, 'setAccessLevel' | 'get' | 'set' | 'remove'>;
export function createService(storage: Storage, fetcher: typeof fetch = fetch) {
  // Start the restriction immediately; listeners register synchronously while this runs.
  const ready = storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  void ready.catch(() => undefined);
  const flights = new Map<string, { result: Promise<WorkerReply>; controller: AbortController }>();
  let keyRevision = 0;
  const failure = (code: 'KEY_NOT_SET' | 'JEV_UNAVAILABLE' | 'INVALID_REQUEST'): WorkerReply => ({ ok: false, error: { code,
    message: code === 'KEY_NOT_SET' ? 'TypeSafe APIキーを設定してください。' : code === 'INVALID_REQUEST' ? '変換リクエストを確認してください。' : 'Jev判定を取得できませんでした。' } });
  async function handle(value: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
    if (!isRecord(value) || sender.id !== chrome.runtime.id) return failure('INVALID_REQUEST');
    const optionsSender = sender.url === chrome.runtime.getURL('options/index.html') && !sender.tab?.url?.startsWith('https://x.com/');
    if (value.type === 'GET_KEY_STATUS' || value.type === 'SAVE_API_KEY' || value.type === 'DELETE_API_KEY' || value.type === 'OPEN_OPTIONS') {
      const xSender = !!sender.tab && sender.url?.startsWith('https://x.com/');
      if (value.type === 'OPEN_OPTIONS' && xSender) { await chrome.runtime.openOptionsPage(); return { ok: true }; }
      if (!optionsSender || value.type === 'OPEN_OPTIONS') return failure('INVALID_REQUEST');
      await ready;
      if (value.type === 'GET_KEY_STATUS') return { ok: true, configured: typeof (await storage.get('apiKey')).apiKey === 'string' };
      if (value.type === 'SAVE_API_KEY') {
        if (typeof value.key !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(value.key)) return { ok: false };
        await storage.set({ apiKey: value.key });
      } else await storage.remove('apiKey');
      keyRevision++;
      for (const flight of flights.values()) flight.controller.abort();
      flights.clear();
      return { ok: true };
    }
    if (value.type !== 'RESOLVE_TIME_AMBIGUITY' || !sender.tab || !sender.url?.startsWith('https://x.com/')) return failure('INVALID_REQUEST');
    const payload = value.payload;
    if (!isRecord(payload) || typeof payload.tweetText !== 'string' || payload.tweetText.length > 20_000 ||
      (payload.postedAtUtc !== undefined && (typeof payload.postedAtUtc !== 'string' || payload.postedAtUtc.length > 64))) return failure('INVALID_REQUEST');
    const local = resolveLocal({ text: payload.tweetText, postedAtUtc: payload.postedAtUtc as string | undefined });
    if (local.status !== 'ambiguous' || JSON.stringify(payload.expression) !== JSON.stringify(local.expression) || JSON.stringify(payload.candidates) !== JSON.stringify(local.candidates)) return failure('INVALID_REQUEST');
    // Rebuild rather than forwarding arbitrary fields from a content-script payload.
    const safe: ResolveMessage['payload'] = { tweetText: payload.tweetText, postedAtUtc: payload.postedAtUtc as string | undefined,
      expression: local.expression, candidates: local.candidates };
    const flightKey = JSON.stringify([sender.tab.id, safe.tweetText, safe.postedAtUtc]);
    const existing = flights.get(flightKey);
    if (existing) return existing.result;
    if (flights.size >= 8) return failure('JEV_UNAVAILABLE');
    const controller = new AbortController();
    const revision = keyRevision;
    const result = (async (): Promise<WorkerReply> => {
      const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS);
      try {
        await ready;
        const key: unknown = (await storage.get('apiKey')).apiKey;
        if (typeof key !== 'string' || !key) return failure('KEY_NOT_SET');
        if (controller.signal.aborted || revision !== keyRevision) return failure('JEV_UNAVAILABLE');
        const choice = await requestJev(safe, key, controller.signal, fetcher);
        if (controller.signal.aborted || revision !== keyRevision) return failure('JEV_UNAVAILABLE');
        return { ok: true, result: choice };
      } catch { return failure('JEV_UNAVAILABLE'); }
      finally { clearTimeout(timer); if (flights.get(flightKey)?.controller === controller) flights.delete(flightKey); }
    })();
    flights.set(flightKey, { result, controller });
    return result;
  }
  return { handle };
}
