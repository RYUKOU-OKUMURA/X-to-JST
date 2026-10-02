// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractTweetContext } from '../src/content/x-dom';
import { observePosts } from '../src/content/observer';
import { attachUi, resolveWithJev } from '../src/content/ui';
const POST = '2026-10-02T02:14:00Z';
const stops: (() => void)[] = [];
function article(text = 'Tomorrow at 10am PT') {
  const node = document.createElement('article'); node.dataset.testid = 'tweet';
  const p = document.createElement('div'); p.dataset.testid = 'tweetText'; p.textContent = text;
  const time = document.createElement('time'); time.setAttribute('datetime', POST);
  const a = document.createElement('a'); a.href = 'https://x.com/author/status/1'; a.append(time);
  node.append(p, a); document.body.append(node); return node;
}
async function flush() { await new Promise(resolve => setTimeout(resolve, 10)); }
afterEach(() => { stops.splice(0).forEach(stop => stop()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe('X DOM and result UI', () => {
  it('extracts only parent-owned text and timestamp', () => {
    const parent = article(); const nested = article('Tomorrow at 2pm ET'); parent.append(nested);
    expect(extractTweetContext(parent)).toMatchObject({ text: 'Tomorrow at 10am PT', postedAtUtc: POST });
    const quote = document.createElement('div'); quote.dataset.testid = 'quoteTweet'; quote.append(nested); parent.append(quote);
    expect(extractTweetContext(parent)?.text).toBe('Tomorrow at 10am PT');
  });
  it('rejects unknown quote markup and ambiguous ownership', () => {
    const node = article(); const extra = document.createElement('p'); extra.dataset.testid = 'tweetText'; extra.textContent = 'quoted'; node.append(extra);
    expect(extractTweetContext(node)).toBeUndefined();
  });
  it('keeps absolute-date text when timestamp is absent', () => {
    const node = article('2026-10-02 15:00 UTC'); node.querySelector('time')!.remove();
    expect(extractTweetContext(node)).toMatchObject({ text: '2026-10-02 15:00 UTC', postedAtUtc: undefined });
  });
  it('observes initial/added posts once, handles SPA, and does no API work before click', async () => {
    const first = article(); const send = vi.fn(); const attach = vi.fn((node: HTMLElement) => attachUi(node, send));
    const stop = observePosts(document.body, attach); stops.push(stop);
    expect(observePosts(document.body, attach)).toBe(stop);
    const second = article(); await flush(); second.append(document.createElement('span')); await flush();
    expect(attach).toHaveBeenCalledTimes(2); expect(first.querySelectorAll('[data-x-to-jst-host]')).toHaveLength(1);
    document.body.replaceChildren(); const third = article(); await flush();
    expect(third.querySelectorAll('[data-x-to-jst-host]')).toHaveLength(1); expect(send).not.toHaveBeenCalled();
  });
  it('renders a unique time and copies the displayed date without calling Jev', async () => {
    const writeText = vi.fn(async () => undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const node = article(); const send = vi.fn(); const root = attachUi(node, send).shadowRoot!;
    root.querySelector<HTMLButtonElement>('button')!.click(); await flush();
    expect(root.textContent).toContain('2026年10月3日（土）02:00 JST'); expect(send).not.toHaveBeenCalled();
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'コピー')!.click(); await flush();
    expect(writeText).toHaveBeenCalledWith('日本時間 2026年10月3日（土）02:00 JST');
  });
  it('restores the control when X reuses an article and removes its children', async () => {
    const post = article(); const attach = vi.fn((node: HTMLElement) => attachUi(node, vi.fn()));
    stops.push(observePosts(document.body, attach));
    post.replaceChildren(); const p = document.createElement('p'); p.dataset.testid = 'tweetText'; p.textContent = '2026-10-02 15:00 UTC'; post.append(p);
    await flush(); expect(post.querySelectorAll('[data-x-to-jst-host]')).toHaveLength(1);
    expect(attach).toHaveBeenCalledTimes(2);
  });
  it('retains both candidates when API is unavailable', async () => {
    const result = await resolveWithJev({ text: 'Tomorrow at 10am PST', postedAtUtc: POST }, vi.fn(async () => { throw new Error('offline'); }));
    expect(result).toMatchObject({ status: 'ambiguous', candidates: expect.any(Array), warning: expect.stringContaining('取得できません') });
    if (result.status === 'ambiguous') expect(result.candidates).toHaveLength(2);
  });
  it('converts an auto-translated post and its English original without changing the display language', async () => {
    const japanese = '明日午前10時PSTに、全有料ChatGPTアカウント向けのグローバルリセット着陸が行われます。現在は期待される速度で動作しています。';
    const node = article(japanese); const send = vi.fn(async () => ({ ok: false, error: { code: 'KEY_NOT_SET' } }));
    const root = attachUi(node, send).shadowRoot!;
    root.querySelector<HTMLButtonElement>('button')!.click(); await flush();
    expect(root.textContent).toContain('02:00 JST'); expect(root.textContent).toContain('03:00 JST');
    expect(node.querySelector('[data-testid="tweetText"]')!.textContent).toBe(japanese);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ tweetText: japanese }) }));
    node.querySelector('[data-testid="tweetText"]')!.textContent = "Global reset landing tomorrow 10am PST for all paid ChatGPT accounts. Apologies for the slow start with GPT-6.1 Sol, it's now back to running at expected speeds after the massive load spike in the first two days.";
    root.querySelector<HTMLButtonElement>('button')!.click(); await flush();
    expect(root.textContent).toContain('02:00 JST'); expect(root.textContent).toContain('03:00 JST');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it.each(['high', 'low', 'unresolved'])('renders the correct state for a %s-confidence Jev judgment', async state => {
    const send = vi.fn(async (message: unknown) => {
      const ids = (message as { payload: { candidates: { id: string }[] } }).payload.candidates.map(c => c.id);
      return { ok: true, result: { choice: state === 'unresolved' ? 'unresolved' : ids[0], confidence: state === 'low' ? .7 : .91,
        probabilities: state === 'unresolved' ? { [ids[0]!]: .1, [ids[1]!]: .1, unresolved: .8 } : { [ids[0]!]: .88, [ids[1]!]: .07, unresolved: .05 } } };
    });
    const result = await resolveWithJev({ text: 'Tomorrow at 10am PST', postedAtUtc: POST }, send);
    expect(result.status).toBe(state === 'high' ? 'resolved' : 'ambiguous');
    expect(result).toMatchObject({ jev: { confidence: state === 'low' ? .7 : .91 } });
  });
  it('does not claim a validated Jev response for a malformed success reply', async () => {
    const result = await resolveWithJev({ text: 'Tomorrow at 10am PST', postedAtUtc: POST }, vi.fn(async () => ({ ok: true, result: { choice: 'unresolved' } })));
    expect(result).toMatchObject({ status: 'ambiguous', warning: expect.stringContaining('取得できません') });
    expect(result).not.toHaveProperty('jev');
  });
  it('keeps candidates compact and puts explanations and the actual Jev answer in closed details', async () => {
    const node = article('Tomorrow at 10am PST');
    const send = vi.fn(async (message: unknown) => {
      const ids = (message as { payload: { candidates: { id: string }[] } }).payload.candidates.map(c => c.id);
      return { ok: true, result: { choice: 'unresolved', confidence: .91, probabilities: { [ids[0]!]: .1, [ids[1]!]: .1, unresolved: .8 } } };
    });
    const root = attachUi(node, send).shadowRoot!;
    root.querySelector<HTMLButtonElement>('button')!.click(); await flush();
    expect(root.querySelector('h3')).toBeNull();
    expect([...root.querySelectorAll('.candidate')].map(row => row.textContent)).toEqual([
      '2026年10月3日（土）02:00 JST現地時間コピー', '2026年10月3日（土）03:00 JSTPST固定コピー',
    ]);
    const details = root.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('TypeSafe / Jev：応答確認済み');
    expect(details.textContent).toContain('判定：未確定・確信度 91.0%');
    expect(details.textContent).toContain('この日の現地時間は');
    expect(root.textContent).not.toContain('APIキー設定');
  });
  it('handles unset key with an options link and preserves copyable candidates', async () => {
    const node = article('Tomorrow at 10am PST'); const send = vi.fn(async () => ({ ok: false, error: { code: 'KEY_NOT_SET' } }));
    const root = attachUi(node, send).shadowRoot!; root.querySelector<HTMLButtonElement>('button')!.click(); await flush();
    expect(root.textContent).toContain('02:00 JST'); expect(root.textContent).toContain('03:00 JST'); expect(root.textContent).toContain('未設定');
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'APIキー設定')!.click(); await flush();
    expect(send).toHaveBeenCalledWith({ type: 'OPEN_OPTIONS' });
  });
  it('treats an HTML-like expression as text, and reports clipboard failure', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    const node = article('Tomorrow at 10am PT <img src=x onerror=alert(1)>'); const root = attachUi(node, vi.fn()).shadowRoot!;
    root.querySelector<HTMLButtonElement>('button')!.click(); await flush();
    expect(root.querySelector('img')).toBeNull();
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'コピー')!.click(); await flush();
    expect(root.textContent).toContain('コピーできませんでした');
  });
  it('drops stale replies after a virtualized post changes', async () => {
    let reply!: (value: unknown) => void; const send = vi.fn(() => new Promise(resolve => { reply = resolve; }));
    const node = article('Tomorrow at 10am PST'); const root = attachUi(node, send).shadowRoot!;
    root.querySelector<HTMLButtonElement>('button')!.click(); root.querySelector<HTMLButtonElement>('button')!.click();
    node.querySelector('[data-testid="tweetText"]')!.textContent = 'different post';
    reply({ ok: false }); await flush();
    expect(root.textContent).toContain('更新されました'); expect(send).toHaveBeenCalledTimes(1);
  });
  it('removes a displayed result when the same article is reused for a different post', async () => {
    const post = article(); stops.push(observePosts(document.body));
    const root = post.querySelector<HTMLElement>('[data-x-to-jst-host]')!.shadowRoot!;
    root.querySelector<HTMLButtonElement>('button')!.click(); await flush();
    expect(root.querySelector('.time')?.textContent).toContain('02:00');
    post.querySelector('[data-testid="tweetText"]')!.firstChild!.nodeValue = 'Tomorrow at 2pm ET'; await flush();
    expect(root.querySelector('.time')).toBeNull();
  });
});
