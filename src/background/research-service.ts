import { isRecord } from '../types/messages';
import { decodeJudge, decodeRecords, RESEARCH_PREFIX, validatePost, type ResearchPost } from '../core/research';
import { JEV_TIMEOUT_MS } from './jev-client';
import { requestResearchJev } from './research-jev';
type Storage = Pick<chrome.storage.LocalStorageArea, 'get' | 'set' | 'remove'>;
export function createResearchService(storage: Storage, fetcher: typeof fetch = fetch) {
  let queue: Promise<unknown> = Promise.resolve();
  let revision = 0;
  const flights = new Map<string, AbortController>();
  function cancelAll() { revision++; for (const controller of flights.values()) controller.abort(); flights.clear(); }
  const failure = (code: string) => ({ ok: false, error: { code, message: ({ INVALID_REQUEST: '調べものの入力を確認してください。', STORAGE_ERROR: '保存を完了できませんでした。既存データは削除していません。', LIMIT_EXCEEDED: '保存上限（200件・本文とメモ2MiB）を超えます。', POST_CHANGED: '本文が変わっています。更新するか選んでください。', KEY_NOT_SET: 'TypeSafe APIキーを設定してください。', CANCELLED: '判定を中断しました。', JEV_UNAVAILABLE: 'Jev判定を取得できませんでした。' } as Record<string, string>)[code] ?? '調べものを完了できませんでした。' } });
  async function list(): Promise<ResearchPost[]> {
    const stored = await storage.get(null);
    const entries = Object.entries(stored).filter(([key]) => key.startsWith(RESEARCH_PREFIX));
    const posts = decodeRecords(entries.map(([, value]) => value));
    if (!posts || entries.some(([key, value]) => key !== RESEARCH_PREFIX + (value as ResearchPost).id)) throw new Error('STORAGE_ERROR');
    return posts.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async function judge(payload: ReturnType<typeof decodeJudge> & {}, tab: number) {
    const flightKey = `${tab}:${payload.requestId}`;
    flights.get(flightKey)?.abort();
    if (flights.size >= 8 && !flights.has(flightKey)) return failure('JEV_UNAVAILABLE');
    const controller = new AbortController(); flights.set(flightKey, controller);
    const startRevision = revision;
    const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS);
    try {
      const key: unknown = (await storage.get('apiKey')).apiKey;
      if (controller.signal.aborted || startRevision !== revision) return failure('CANCELLED');
      if (typeof key !== 'string' || !key) return failure('KEY_NOT_SET');
      const result = await requestResearchJev(payload, key, controller.signal, fetcher);
      return controller.signal.aborted || startRevision !== revision ? failure('CANCELLED') : { ok: true, ...result };
    } catch { return failure(controller.signal.aborted ? 'CANCELLED' : 'JEV_UNAVAILABLE'); }
    finally { clearTimeout(timer); if (flights.get(flightKey) === controller) flights.delete(flightKey); }
  }
  async function operation(value: Record<string, unknown>) {
    const posts = await list();
    if (value.type === 'RESEARCH_LIST') return { ok: true, posts };
    if (value.type === 'RESEARCH_EXPORT') return { ok: true, backup: { version: 1, posts } };
    if (value.type === 'RESEARCH_DELETE') {
      if (typeof value.id !== 'string' || !/^[1-9]\d{0,24}$/.test(value.id)) return failure('INVALID_REQUEST');
      cancelAll(); await storage.remove(RESEARCH_PREFIX + value.id);
    } else if (value.type === 'RESEARCH_CLEAR') {
      cancelAll(); await storage.remove(posts.map(post => RESEARCH_PREFIX + post.id));
    } else if (value.type === 'RESEARCH_SAVE') {
      const post = validatePost(value.post);
      if (!post || (value.update !== undefined && typeof value.update !== 'boolean')) return failure('INVALID_REQUEST');
      const old = posts.find(item => item.id === post.id);
      if (old && (old.text !== post.text || old.url !== post.url || old.postedAtUtc !== post.postedAtUtc || old.lang !== post.lang) && value.update !== true) return { ...failure('POST_CHANGED'), existing: old };
      const saved = old ? { ...post, savedAt: old.savedAt, note: value.update === true && old.text !== post.text ? old.note : post.note } : post;
      if (!decodeRecords([...posts.filter(item => item.id !== post.id), saved])) return failure('LIMIT_EXCEEDED');
      cancelAll(); await storage.set({ [RESEARCH_PREFIX + post.id]: saved });
    } else if (value.type === 'RESEARCH_IMPORT') {
      if (!isRecord(value.backup) || value.backup.version !== 1) return failure('INVALID_REQUEST');
      const imported = decodeRecords(value.backup.posts);
      if (!imported) return failure('INVALID_REQUEST');
      const merged = new Map(posts.map(post => [post.id, post]));
      const additions = imported.filter(post => !merged.has(post.id));
      for (const post of additions) merged.set(post.id, post);
      if (!decodeRecords([...merged.values()])) return failure('LIMIT_EXCEEDED');
      cancelAll(); await storage.set(Object.fromEntries(additions.map(post => [RESEARCH_PREFIX + post.id, post])));
    } else return failure('INVALID_REQUEST');
    return { ok: true, posts: await list() };
  }
  async function handle(value: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
    if (!isRecord(value) || sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id)) return failure('INVALID_REQUEST');
    try { if (new URL(sender.url ?? '').origin !== 'https://x.com') return failure('INVALID_REQUEST'); } catch { return failure('INVALID_REQUEST'); }
    if (value.type === 'RESEARCH_CANCEL') {
      const requestId = value.requestId ?? (isRecord(value.payload) ? value.payload.requestId : undefined);
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId)) return failure('INVALID_REQUEST');
      flights.get(`${sender.tab!.id}:${requestId}`)?.abort(); return { ok: true };
    }
    if (value.type === 'RESEARCH_JUDGE') {
      const payload = decodeJudge(value.payload);
      return payload ? judge(payload, sender.tab!.id!) : failure('INVALID_REQUEST');
    }
    const result = queue.then(() => operation(value)).catch(() => failure('STORAGE_ERROR'));
    queue = result;
    return result;
  }
  return { handle, cancelAll };
}
