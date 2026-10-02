import { isRecord } from '../types/messages';
import { MAX_RESEARCH_BATCH, MAX_RESEARCH_BATCH_CHARS, type ResearchPost } from '../core/research';
import { collectResearchPosts } from './research-collector';
import { ARTICLE_SELECTOR, extractTweetContext } from './x-dom';

type Send = (message: unknown) => Promise<unknown>;
type Author = { name: string; handle: string; avatar?: string };
const CSS = `:host{display:block;color:var(--foreground,#e7e9ea);background:var(--surface,#000);font:15px/1.65 system-ui,-apple-system,sans-serif}:host([hidden]){display:none!important}*{box-sizing:border-box}[hidden]{display:none!important}.controls{padding:22px 24px 18px;border-bottom:1px solid #53647155}h2{display:inline;font-size:18px;margin:0;font-weight:700}.tag{font-size:11px;color:#71767b;margin-left:8px}form{display:flex;gap:10px;margin-top:16px}input,button{font:inherit}input{flex:1;min-width:0;padding:12px 14px;border:1px solid #536471;border-radius:8px;background:transparent;color:inherit}button{cursor:pointer;border:0;border-radius:8px;background:transparent;color:#1d9bf0;padding:6px 0}button.primary{background:#1d9bf0;color:white;font-weight:700;padding:10px 22px;flex-shrink:0}button:disabled{opacity:.55;cursor:default}button:focus-visible,input:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #1d9bf0;outline-offset:3px}p{margin:8px 0}.small{font-size:12px;color:#71767b}.scope{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 24px;border-bottom:1px solid #53647155;flex-wrap:wrap}.scope p{margin:0}.actions{display:flex;gap:16px;align-items:center;flex-wrap:wrap}#results:empty{display:none}article{display:flex;gap:12px;padding:24px;border-bottom:1px solid #53647155}article img{width:40px;height:40px;object-fit:cover;border-radius:50%;flex-shrink:0}.body{min-width:0;flex:1}.meta{display:flex;gap:7px;align-items:baseline;flex-wrap:wrap}.meta strong{font-size:15px}.meta span{font-size:13px;color:#71767b}.text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.7;margin:8px 0 12px}a{color:#1d9bf0;text-decoration:none}a:hover{text-decoration:underline}.empty{padding:24px}details{font-size:13px}summary{cursor:pointer;color:#71767b}.supplement{margin-top:10px;display:flex;gap:16px;align-items:center}.error{color:inherit}@media(max-width:500px){.controls{padding:18px 16px}.scope{padding:16px}article{padding:20px 16px}form{gap:8px}button.primary{padding:10px 14px}.text{font-size:15px}}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
}
function button(text: string, action: () => void) {
  const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node;
}
function source() {
  const primary = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!primary) return;
  const bookmarkInput = primary.querySelector<HTMLInputElement>('input[placeholder="ブックマークを検索"],input[placeholder="Search Bookmarks"],input[aria-label="ブックマークを検索"]');
  const selected = [...primary.querySelectorAll('[role="tab"][aria-selected="true"]')].map(node => node.textContent?.trim() ?? '').join('|');
  const bookmarks = location.pathname.startsWith('/i/bookmarks') || location.pathname === '/i/history' && (!!bookmarkInput || /^(ブックマーク|Bookmarks)$/i.test(selected));
  if (!bookmarks && location.pathname !== '/search') return;
  const searchInput = bookmarkInput ?? primary.querySelector<HTMLInputElement>('input[data-testid="SearchBox_Search_Input"],input[aria-label="検索クエリ"]');
  const region = primary.querySelector<HTMLElement>('section[role="region"]');
  return region ? { primary, region, key: `${location.href}|${selected}|${searchInput?.value ?? ''}`, label: bookmarks ? 'ブックマーク' : 'X検索結果' } : undefined;
}

function createSurface(current: NonNullable<ReturnType<typeof source>>, send: Send) {
  const { region, key, label } = current;
  const host = el('div'); host.dataset.xInlineResearchHost = 'true';
  const shadow = host.attachShadow({ mode: 'open' });
  const section = el('section'); section.setAttribute('role', 'region'); section.setAttribute('aria-label', '目的で探す');
  const controls = el('div'); controls.className = 'controls';
  const tag = el('span', '拡張機能'); tag.className = 'tag'; controls.append(el('h2', '目的で探す'), tag);
  const form = el('form'); const input = el('input'); input.type = 'search'; input.maxLength = 1000; input.setAttribute('aria-label', '探したいこと'); input.placeholder = '例：Google Workspaceで議事録を自動化したい';
  const search = el('button', '探す'); search.type = 'submit'; search.className = 'primary'; form.append(input, search);
  const help = el('p', `${label}の表示本文から探します。「探す」でJevへ送信します。`); help.className = 'small';
  const disclosure = el('p', '「探す」は目的・本文・投稿日時をJevへ送信します。画像・動画・リンク先は対象外です。'); disclosure.className = 'small';
  const status = el('p'); status.id = 'status'; status.className = 'small'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const supplement = el('div'); supplement.className = 'supplement';
  const local = button('文字で探す', () => void find(false));
  const cancel = button('中断', () => { reset(); status.textContent = '判定を中断しました。'; }); cancel.hidden = true;
  const options = button('APIキー設定', () => { void send({ type: 'OPEN_OPTIONS' }).catch(() => { status.textContent = 'APIキーの設定画面を開けませんでした。'; }); }); options.hidden = true;
  const info = el('details'); info.append(el('summary', '検索について'), disclosure);
  supplement.append(local, cancel, options, info); controls.append(form, help, status, supplement);
  const scope = el('div'); scope.className = 'scope'; scope.hidden = true;
  const count = el('p'); const actions = el('div'); actions.className = 'actions';
  const more = button('さらに読み込む', () => { invalidate(false); showNative(); status.textContent = 'Xの一覧を手動でスクロールし、もう一度「探す」を押してください。'; });
  const back = button('通常表示に戻る', () => { reset(); input.focus(); }); actions.append(more, back); scope.append(count, actions);
  const results = el('div'); results.id = 'results'; results.setAttribute('aria-label', '目的検索の候補');
  section.append(controls, scope, results); shadow.append(el('style', CSS), section);
  const color = getComputedStyle(current.primary).color; if (color) host.style.setProperty('--foreground', color);
  const background = getComputedStyle(document.body).backgroundColor; if (background && background !== 'rgba(0, 0, 0, 0)') host.style.setProperty('--surface', background);
  region.before(host);

  let posts: ResearchPost[] = []; const authors = new Map<string, Author>();
  let stopCollect: (() => void) | undefined; let collectionStarted = false; let stopReason = '';
  let generation = 0; let runningId: string | undefined; let active = false;
  let previousHidden: HTMLElement['hidden'] | undefined; let sourceScroll = 0; let lastCandidates = 0; let judgedTotal: number | undefined;
  let previousDisplay = ''; let previousDisplayPriority = '';
  const stillCurrent = () => host.isConnected && source()?.key === key && source()?.region === region;
  const updateCount = () => { count.textContent = judgedTotal === undefined ? `読み込んだ${posts.length}件` : `判定対象${judgedTotal}件から候補${lastCandidates}件`; };
  function invalidate(clearResults = true) {
    generation++; active = false;
    if (runningId) void send({ type: 'RESEARCH_CANCEL', requestId: runningId }).catch(() => undefined);
    runningId = undefined; search.disabled = false; cancel.hidden = true;
    judgedTotal = undefined;
    if (clearResults) { results.replaceChildren(); lastCandidates = 0; } updateCount();
  }
  function showNative() {
    if (previousHidden !== undefined) { region.hidden = previousHidden; region.style.setProperty('display', previousDisplay, previousDisplayPriority); previousHidden = undefined; window.scrollTo(0, sourceScroll); }
    results.hidden = true;
  }
  function reset() {
    invalidate(); showNative(); stopCollect?.(); stopCollect = undefined; collectionStarted = false;
    posts = []; authors.clear(); scope.hidden = true; status.textContent = ''; options.hidden = true; stopReason = '';
  }
  function collectAuthors() {
    for (const article of region.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR)) {
      const url = extractTweetContext(article)?.url;
      const post = posts.find(item => item.url === url); if (!post || authors.has(post.id)) continue;
      const handle = `@${new URL(post.url).pathname.split('/')[1]}`;
      const user = article.querySelector('[data-testid="User-Name"]');
      const name = user?.querySelector('a')?.textContent?.trim() || handle;
      const raw = article.querySelector<HTMLImageElement>('[data-testid^="UserAvatar-Container"] img')?.src;
      let avatar: string | undefined;
      if (raw) try { const url = new URL(raw); if (url.origin === 'https://pbs.twimg.com' && url.pathname.startsWith('/profile_images/') && !url.username && !url.password) { url.search = ''; url.hash = ''; avatar = url.href; } } catch { /* Omit an invalid avatar. */ }
      authors.set(post.id, { name, handle, avatar });
    }
  }
  function startCollection() {
    if (collectionStarted) return;
    collectionStarted = true; scope.hidden = false; sourceScroll = window.scrollY;
    stopCollect = collectResearchPosts(region, (next, skipped, reason) => {
      if (!stillCurrent()) return;
      posts = next; stopReason = reason?.startsWith('収集上限') ? 'この検索の取得上限（200件・2MiB）に達しました。通常表示に戻って検索し直せます。' : reason ?? ''; collectAuthors(); updateCount();
      if (!active && judgedTotal === undefined) status.textContent = stopReason || `スクロールで追加できます。取得できなかった要素：${skipped}。投稿はこの検索中だけ保持します。`;
    });
  }
  function showResults(matches: { post: ResearchPost; score: number }[]) {
    lastCandidates = matches.length; updateCount(); results.replaceChildren(); results.hidden = false;
    if (previousHidden === undefined) { sourceScroll = window.scrollY; previousHidden = region.hidden; previousDisplay = region.style.getPropertyValue('display'); previousDisplayPriority = region.style.getPropertyPriority('display'); }
    region.hidden = true; region.style.setProperty('display', 'none', 'important');
    for (const { post } of matches.sort((a,b) => b.score-a.score)) {
      const card = el('article'); card.dataset.postId = post.id;
      const author = authors.get(post.id); if (author?.avatar) { const img = el('img'); img.src = author.avatar; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; card.append(img); }
      const body = el('div'); body.className = 'body'; const meta = el('div'); meta.className = 'meta';
      meta.append(el('strong', author?.name ?? '元の投稿'));
      if (author && author.handle !== author.name) meta.append(el('span', author.handle));
      meta.append(el('span', post.postedAtUtc ? new Date(post.postedAtUtc).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '投稿日時不明'));
      const preview = el('p', post.text.length > 220 ? `${post.text.slice(0,220)}…` : post.text); preview.className = 'text';
      body.append(meta, preview);
      if (post.text.length > 220) { const detail = el('details'); const full = el('p', post.text); full.className = 'text'; detail.append(el('summary', '全文を読む'), full); body.append(detail); }
      const link = el('a', '元の投稿を開く'); link.href = post.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; body.append(link);
      card.append(body); results.append(card);
    }
    if (!matches.length) { const empty = el('p', '目的に近い候補は見つかりませんでした。検索語や目的を変えるか、Xの一覧をさらに読み込んでください。'); empty.className = 'empty'; results.append(empty); }
  }
  async function find(useJev: boolean) {
    invalidate(); options.hidden = true; const revision = generation;
    const purpose = input.value.trim();
    if (!purpose) { status.textContent = '探したいことを入力してください。'; input.focus(); return; }
    if (!stillCurrent()) return;
    startCollection(); const candidates = posts.map(post => ({ ...post })); judgedTotal = candidates.length; updateCount();
    if (!candidates.length) { status.textContent = '読み込まれた本文がありません。Xの検索やスクロールで投稿を表示してください。'; return; }
    if (!useJev) {
      const matches = candidates.filter(post => post.text.toLocaleLowerCase().includes(purpose.toLocaleLowerCase())).map(post => ({ post, score: 1 }));
      showResults(matches); status.textContent = '文字列検索です。Jevへの送信はありません。'; return;
    }
    active = true; search.disabled = true; cancel.hidden = false;
    let processed = 0; const matches: { post: ResearchPost; score: number }[] = [];
    status.textContent = `0 / ${candidates.length}件を判定中…`;
    try {
      while (processed < candidates.length) {
        const batch: ResearchPost[] = []; let chars = purpose.length;
        for (const post of candidates.slice(processed, processed + MAX_RESEARCH_BATCH)) {
          if (batch.length && chars + post.text.length > MAX_RESEARCH_BATCH_CHARS) break;
          batch.push(post); chars += post.text.length;
        }
        runningId = crypto.randomUUID();
        const response = await send({ type: 'RESEARCH_JUDGE', payload: { mode: 'search', query: purpose, posts: batch, includeNotes: false, requestId: runningId } });
        if (revision !== generation || !stillCurrent()) return;
        if (!isRecord(response) || response.ok !== true) {
          const error = isRecord(response) && isRecord(response.error) ? response.error : undefined;
          if (error?.code === 'KEY_NOT_SET') options.hidden = false;
          throw new Error(typeof error?.message === 'string' ? error.message : 'Jev判定を取得できませんでした。');
        }
        if (!Array.isArray(response.results) || response.results.length !== batch.length) throw new Error('判定結果を確認できませんでした。');
        const seen = new Set<string>(); const batchMatches: typeof matches = [];
        for (const result of response.results) {
          if (!isRecord(result) || typeof result.id !== 'string' || seen.has(result.id) || typeof result.score !== 'number' || !Number.isFinite(result.score) || result.score < 0 || result.score > 1) throw new Error('判定結果を確認できませんでした。');
          const post = batch.find(post => post.id === result.id); if (!post) throw new Error('判定対象が一致しません。');
          seen.add(result.id); if (result.score >= .5) batchMatches.push({ post, score: result.score });
        }
        matches.push(...batchMatches); processed += batch.length; status.textContent = `${processed} / ${candidates.length}件を判定済み`;
      }
      showResults(matches); status.textContent = '目的に近い候補です。内容は元の投稿で確認できます。';
    } catch (error) {
      if (revision === generation && stillCurrent()) { showResults(matches); status.textContent = `${processed}件判定済み・${candidates.length-processed}件未判定。${(error as Error).message}「文字で探す」も使えます。`; }
    } finally {
      if (revision === generation) { active = false; runningId = undefined; search.disabled = false; cancel.hidden = true; if (stopReason) status.append(document.createTextNode(` ${stopReason}`)); }
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void find(true); });
  input.addEventListener('input', () => { reset(); status.textContent = '目的を変更しました。「探す」で探し直せます。'; });
  shadow.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape') { event.preventDefault(); reset(); input.focus(); } });
  return { host, region, key, toggle() { host.hidden = !host.hidden; if (host.hidden) reset(); else input.focus(); }, dispose() { reset(); host.remove(); } };
}

export function installInlineResearch(send: Send = message => chrome.runtime.sendMessage(message)) {
  let surface: ReturnType<typeof createSurface> | undefined;
  let queued = false; let disposed = false;
  function sync() {
    if (disposed) return;
    const current = source();
    if (surface && (!current || current.key !== surface.key || current.region !== surface.region || !surface.host.isConnected)) { surface.dispose(); surface = undefined; }
    if (!surface && current) surface = createSurface(current, send);
  }
  function schedule() { if (!queued) { queued = true; queueMicrotask(() => { queued = false; sync(); }); } }
  const observer = new MutationObserver(schedule); observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'placeholder'] });
  const timer = setInterval(sync, 300);
  document.addEventListener('input', schedule, true); document.addEventListener('change', schedule, true);
  sync();
  return { toggle() { sync(); if (!surface) return false; surface.toggle(); return true; }, dispose() { disposed = true; observer.disconnect(); clearInterval(timer); document.removeEventListener('input', schedule, true); document.removeEventListener('change', schedule, true); surface?.dispose(); surface = undefined; } };
}
