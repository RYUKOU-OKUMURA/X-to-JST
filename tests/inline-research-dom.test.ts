// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installInlineResearch } from '../src/content/inline-research';
import type { ResearchJudge } from '../src/core/research';
const cleanups: (() => void)[] = [];
const flush = () => new Promise(resolve => setTimeout(resolve, 20));
function fixture(path = '/i/bookmarks') {
  const url = new URL(path, 'https://x.com');
  vi.stubGlobal('location', { pathname: url.pathname, href: url.href, search: url.search });
  const primary = document.createElement('main'); primary.dataset.testid = 'primaryColumn';
  const feed = document.createElement('section'); feed.setAttribute('role', 'region'); feed.setAttribute('aria-label', 'Timeline: Bookmarks');
  primary.append(feed); document.body.append(primary);
  addPost(feed, '1', 'AIで議事録を自動化する方法'); addPost(feed, '2', '今日の昼ごはん');
  return { primary, feed };
}
function addPost(feed: HTMLElement, id: string, text: string) {
  const article = document.createElement('article'); article.dataset.testid = 'tweet';
  const body = document.createElement('div'); body.dataset.testid = 'tweetText'; body.textContent = text;
  const link = document.createElement('a'); link.href = `https://x.com/author/status/${id}`;
  const time = document.createElement('time'); time.dateTime = '2026-10-02T00:00:00Z'; link.append(time);
  article.append(body, link); feed.append(article);
}
function root(primary: HTMLElement): ShadowRoot {
  const shadow = primary.querySelector<HTMLElement>('[data-x-inline-research-host]')?.shadowRoot;
  if (!shadow) throw new Error('Inline research shadow root missing'); return shadow;
}
function button(shadow: ShadowRoot, text: string): HTMLButtonElement {
  const node = [...shadow.querySelectorAll('button')].find(node => node.textContent === text);
  if (!node) throw new Error(`Missing button: ${text}`); return node;
}
function purpose(shadow: ShadowRoot, value: string) {
  const input = shadow.querySelector<HTMLInputElement>('[aria-label="探したいこと"]')!;
  input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
}
function submit(shadow: ShadowRoot, text = '探す') { button(shadow, text).click(); }
function judgeMessages(send: ReturnType<typeof vi.fn>) { return send.mock.calls.map(call => call[0] as { type: string; payload?: ResearchJudge }).filter(value => value.type === 'RESEARCH_JUDGE'); }
beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined); });
afterEach(() => { cleanups.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('mounts within the central column and makes no request on mount or toggle', async () => {
  const { primary } = fixture(); const send = vi.fn(async () => ({ ok: true }));
  const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  inline.toggle(); inline.toggle(); await flush();
  expect(root(primary).querySelector('[aria-label="探したいこと"]')).not.toBeNull();
  expect(send).not.toHaveBeenCalled();
});
it('uses bounded batches without notes and displays only relevant original posts', async () => {
  const { primary, feed } = fixture();
  for (let index = 3; index <= 21; index++) addPost(feed, String(index), `読み込んだ投稿${index}`);
  const send = vi.fn(async (message: unknown) => {
    const value = message as { type: string; payload?: ResearchJudge };
    return { ok: true, results: value.payload?.posts.map(post => ({ id: post.id, score: post.id === '1' ? 1 : 0, confidence: 1 })) };
  });
  const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  const shadow = root(primary); purpose(shadow, '議事録の自動化'); submit(shadow); await flush();
  const calls = judgeMessages(send); expect(calls).toHaveLength(2);
  expect(calls.map(value => value.payload!.posts.length)).toEqual([20, 1]);
  expect(calls.every(value => value.payload!.includeNotes === false && value.payload!.mode === 'search')).toBe(true);
  expect(send.mock.calls.every(call => ['RESEARCH_JUDGE', 'RESEARCH_CANCEL'].includes((call[0] as { type: string }).type))).toBe(true);
  expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(1);
  expect(shadow.querySelector('[data-post-id="1"]')!.textContent).toContain('AIで議事録');
  expect(shadow.querySelector<HTMLAnchorElement>('[data-post-id="1"] a')!.href).toBe('https://x.com/author/status/1');
  expect(feed.hidden).toBe(true);
  submit(shadow, '通常表示に戻る'); expect(feed.hidden).toBe(false); expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(0);
});
it('leaves unrelated native posts hidden when no semantic candidate matches', async () => {
  const { primary, feed } = fixture();
  const send = vi.fn(async (message: unknown) => ({ ok: true, results: (message as { payload: ResearchJudge }).payload.posts.map(post => ({ id: post.id, score: 0, confidence: 1 })) }));
  const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  const shadow = root(primary); purpose(shadow, '該当しない目的'); submit(shadow); await flush();
  expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(0); expect(feed.hidden).toBe(true);
});
it('supports explicit local text search without background messages', async () => {
  const { primary, feed } = fixture(); const send = vi.fn();
  const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  const shadow = root(primary); purpose(shadow, '議事録'); submit(shadow, '文字で探す'); await flush();
  expect(send).not.toHaveBeenCalled(); expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(1); expect(feed.hidden).toBe(true);
});
it('cancels a changed purpose and discards a late judgment', async () => {
  const { primary } = fixture(); let finish!: (value: unknown) => void;
  const send = vi.fn(async (message: unknown) => (message as { type: string }).type === 'RESEARCH_JUDGE' ? new Promise(resolve => { finish = resolve; }) : { ok: true });
  const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  const shadow = root(primary); purpose(shadow, '議事録'); submit(shadow); await flush();
  const first = judgeMessages(send)[0]!; purpose(shadow, '別の目的');
  finish({ ok: true, results: first.payload!.posts.map(post => ({ id: post.id, score: 1, confidence: 1 })) }); await flush();
  expect(send).toHaveBeenCalledWith({ type: 'RESEARCH_CANCEL', requestId: first.payload!.requestId });
  expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(0);
});
it('collects additional manually loaded posts only after showing the native feed again', async () => {
  const { primary, feed } = fixture(); const send = vi.fn();
  const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  const shadow = root(primary); purpose(shadow, '議事録'); submit(shadow, '文字で探す'); await flush();
  submit(shadow, 'さらに読み込む'); expect(feed.hidden).toBe(false);
  addPost(feed, '3', '議事録を別の方法で自動化'); await flush();
  submit(shadow, '文字で探す'); await flush();
  expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(2); expect(send).not.toHaveBeenCalled();
});
it('invalidates results when the bookmark history tab changes at the same URL', async () => {
  const { primary, feed } = fixture('/i/history');
  const tab = document.createElement('button'); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', 'true'); tab.textContent = 'ブックマーク'; primary.prepend(tab);
  const inline = installInlineResearch(vi.fn()); cleanups.push(inline.dispose); await flush();
  const shadow = root(primary); purpose(shadow, '議事録'); submit(shadow, '文字で探す'); await flush();
  expect(feed.hidden).toBe(true);
  tab.textContent = 'いいね'; await new Promise(resolve => setTimeout(resolve, 350));
  expect(feed.hidden).toBe(false); expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(0);
});
it('invalidates an active search when its X search keyword changes', async () => {
  const { primary, feed } = fixture('/search?q=AI'); let finish!: (value: unknown) => void;
  const nativeQuery = document.createElement('input'); nativeQuery.setAttribute('aria-label', '検索クエリ'); nativeQuery.dataset.testid = 'SearchBox_Search_Input'; nativeQuery.value = 'AI'; primary.prepend(nativeQuery);
  const send = vi.fn(async (message: unknown) => (message as { type: string }).type === 'RESEARCH_JUDGE' ? new Promise(resolve => { finish = resolve; }) : { ok: true });
  const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  const shadow = root(primary); purpose(shadow, '自動化'); submit(shadow); await flush();
  const first = judgeMessages(send)[0]!;
  nativeQuery.value = '別キーワード'; nativeQuery.dispatchEvent(new Event('input', { bubbles: true }));
  finish({ ok: true, results: first.payload!.posts.map(post => ({ id: post.id, score: 1, confidence: 1 })) }); await flush();
  expect(send).toHaveBeenCalledWith({ type: 'RESEARCH_CANCEL', requestId: first.payload!.requestId });
  expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(0); expect(feed.hidden).toBe(false);
});
it.each([
  { id: '1', score: 1, confidence: 1 },
  { id: '2', score: NaN, confidence: 1 },
  { id: '999', score: 1, confidence: 1 },
])('does not expose a partially accepted malformed batch (%j)', async invalid => {
  const { primary } = fixture();
  const send = vi.fn(async () => ({ ok: true, results: [{ id: '1', score: 1, confidence: 1 }, invalid] }));
  const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  const shadow = root(primary); purpose(shadow, '議事録'); submit(shadow); await flush();
  expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(0);
  expect(shadow.querySelector('#status')!.textContent).toContain('0件判定済み・2件未判定');
});
it('restores the native feed on explicit cancellation and discards the late batch', async () => {
  const { primary, feed } = fixture(); let finish!: (value: unknown) => void;
  const send = vi.fn(async (message: unknown) => (message as { type: string }).type === 'RESEARCH_JUDGE' ? new Promise(resolve => { finish = resolve; }) : { ok: true });
  const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  const shadow = root(primary); purpose(shadow, '議事録'); submit(shadow, '文字で探す'); await flush();
  expect(feed.hidden).toBe(true);
  submit(shadow); await flush(); const first = judgeMessages(send)[0]!;
  submit(shadow, '中断');
  expect(feed.hidden).toBe(false); expect(window.scrollTo).toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith({ type: 'RESEARCH_CANCEL', requestId: first.payload!.requestId });
  finish({ ok: true, results: first.payload!.posts.map(post => ({ id: post.id, score: 1, confidence: 1 })) }); await flush();
  expect(feed.hidden).toBe(false); expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(0);
  expect(shadow.querySelector('#status')!.textContent).toContain('判定を中断しました');
});
it('keeps the judged snapshot count fixed when more native posts arrive after results', async () => {
  const { primary, feed } = fixture();
  const send = vi.fn(async (message: unknown) => ({ ok: true, results: (message as { payload: ResearchJudge }).payload.posts.map(post => ({ id: post.id, score: post.id === '1' ? 1 : 0, confidence: 1 })) }));
  const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  const shadow = root(primary); purpose(shadow, '議事録'); submit(shadow); await flush();
  expect(shadow.textContent).toContain('判定対象2件から候補1件');
  addPost(feed, '3', '新しく読み込まれた議事録の投稿'); await flush();
  expect(shadow.textContent).toContain('判定対象2件から候補1件');
  expect(shadow.textContent).not.toContain('判定対象3件');
  expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(1);
  expect(judgeMessages(send)).toHaveLength(1);
});
it.each([['', ''], ['flex', ''], ['flex', 'important']])('hides X flex feeds and restores their original display value/priority (%s/%s)', async (display, priority) => {
  const { primary, feed } = fixture();
  const style = document.createElement('style'); style.textContent = 'section[role="region"] { display: flex; }'; document.body.append(style);
  feed.style.setProperty('display', display, priority);
  const send = vi.fn(); const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  expect(getComputedStyle(feed).display).toBe('flex');
  const shadow = root(primary); purpose(shadow, '議事録'); submit(shadow, '文字で探す'); await flush();
  expect(getComputedStyle(feed).display).toBe('none');
  expect(feed.style.getPropertyValue('display')).toBe('none');
  expect(feed.style.getPropertyPriority('display')).toBe('important');
  submit(shadow, '通常表示に戻る');
  expect(getComputedStyle(feed).display).toBe('flex');
  expect(feed.style.getPropertyValue('display')).toBe(display);
  expect(feed.style.getPropertyPriority('display')).toBe(priority);
  expect(feed.hidden).toBe(false); expect(send).not.toHaveBeenCalled();
});
it('exposes unset-key status and falls back to local search without another request', async () => {
  const { primary } = fixture();
  const send = vi.fn(async () => ({ ok: false, error: { code: 'KEY_NOT_SET', message: 'TypeSafe APIキーを設定してください。' } }));
  const inline = installInlineResearch(send); cleanups.push(inline.dispose); await flush();
  const shadow = root(primary); purpose(shadow, '議事録'); submit(shadow); await flush();
  expect(shadow.querySelector('#status')!.textContent).toContain('0件判定済み・2件未判定');
  expect(shadow.querySelector('#status')!.textContent).toContain('TypeSafe APIキーを設定してください');
  expect(button(shadow, 'APIキー設定').hidden).toBe(false);
  expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(0);
  expect(judgeMessages(send)).toHaveLength(1);
  submit(shadow, '文字で探す'); await flush();
  expect(shadow.querySelectorAll('[data-post-id]')).toHaveLength(1);
  expect(shadow.querySelector('[data-post-id="1"]')).not.toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
});
