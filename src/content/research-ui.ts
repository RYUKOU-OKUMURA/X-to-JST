import { isRecord } from '../types/messages';
import { MAX_RESEARCH_BATCH, MAX_RESEARCH_BATCH_CHARS, validatePost, type ResearchPost } from '../core/research';
import { collectResearchPosts } from './research-collector';

type Send = (message: unknown) => Promise<unknown>;
type Judgment = { id: string; score?: number; relation?: string; confidence: number };
const RELATIONS: Record<string, string> = { followup: '続報の候補', change: '変更の候補', example: '具体例の候補', same: '同じ話の候補', unrelated: '無関係', unknown: '関係は不明' };
const CSS = `:host{all:initial;position:fixed;right:16px;top:70px;bottom:20px;width:min(420px,calc(100vw - 32px));z-index:2147483646;color-scheme:light dark}*{box-sizing:border-box}section{height:100%;display:flex;flex-direction:column;font:14px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText;border:1px solid #81919e;border-radius:16px;box-shadow:0 8px 32px #0004;overflow:hidden}header,.controls,footer{padding:12px;border-bottom:1px solid #81919e}header,.row,nav{display:flex;gap:8px;align-items:center;flex-wrap:wrap}h2{font-size:17px;margin:0;flex:1}button,input,textarea{font:inherit}button{cursor:pointer;border:1px solid #81919e;border-radius:8px;padding:5px 10px;background:Canvas;color:CanvasText}button:disabled{opacity:.5;cursor:default}button[aria-pressed=true]{background:#1d6f9b;color:white}input[type=text],textarea{width:100%;background:Canvas;color:CanvasText;border:1px solid #81919e;border-radius:6px;padding:7px}input[type=checkbox]{width:18px;height:18px}textarea{min-height:50px;resize:vertical}button:focus-visible,input:focus-visible,textarea:focus-visible,a:focus-visible{outline:3px solid #1d9bf0;outline-offset:2px}p{margin:6px 0}.small{font-size:12px;opacity:.85}#results{flex:1;overflow:auto;padding:12px}article{padding:10px 0;border-bottom:1px solid #81919e}article p{white-space:pre-wrap;overflow-wrap:anywhere}a{color:LinkText}footer{border-bottom:0;border-top:1px solid #81919e}details{margin-top:6px}nav{margin-bottom:8px}#anchor{max-height:110px;overflow:auto;border-left:3px solid #1d9bf0;padding-left:8px}#status{min-height:1.5em}@media(max-width:600px){:host{right:8px;top:48px;bottom:8px;width:calc(100vw - 16px)}}`;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
}
function button(text: string, action: () => void) { const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node; }

export function createResearchUi(send: Send = message => chrome.runtime.sendMessage(message)) {
  const host = el('div'); host.dataset.xResearchHost = 'true'; host.hidden = true;
  const shadow = host.attachShadow({ mode: 'open' });
  const section = el('section'); section.setAttribute('role', 'dialog'); section.setAttribute('aria-label', 'X 調べもの');
  const header = el('header'); const close = button('閉じる', () => setOpen(false)); header.append(el('h2', 'X 調べもの'), close);
  const controls = el('div'); controls.className = 'controls';
  const nav = el('nav'); nav.setAttribute('aria-label', '調べものの対象');
  let mode: 'collect' | 'saved' | 'relate' = 'saved';
  let collected: ResearchPost[] = []; let saved: ResearchPost[] = []; let anchor: ResearchPost | undefined;
  let judgments = new Map<string, Judgment>(); let checked = new Set<string>();
  let stopCollect: (() => void) | undefined; let collectionReason = '';
  let generation = 0; let runningId: string | undefined; let active = false; let loadRevision = 0;
  let previousFocus: HTMLElement | null = null;
  const cached = new Map<string, Record<string, unknown>>();
  let cacheContext = '';
  const query = el('input'); query.type = 'text'; query.maxLength = 1000; query.placeholder = '今、何を知りたい？'; query.setAttribute('aria-label', '探したいこと');
  const notesLabel = el('label'); const includeNotes = el('input'); includeNotes.type = 'checkbox'; notesLabel.className = 'small'; notesLabel.append(includeNotes, document.createTextNode('自分のメモもJevに送る'));
  const anchorView = el('p'); anchorView.id = 'anchor'; anchorView.hidden = true;
  const sourceStatus = el('p'); sourceStatus.className = 'small';
  const status = el('p'); status.id = 'status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const results = el('div'); results.id = 'results';
  const target = () => mode === 'collect' ? collected : saved.filter(post => mode !== 'relate' || post.id !== anchor?.id);
  const tabs = (['collect', 'saved', 'relate'] as const).map((value, i) => button(['拾う', '探す', 'つなげる'][i]!, () => {
    if (value !== 'collect') { stopCollect?.(); stopCollect = undefined; }
    cancel(); mode = value; judgments.clear(); checked.clear(); render(); results.scrollTop = 0;
    if (value !== 'collect') void loadSaved();
  })); nav.append(...tabs);
  const collect = button('収集を開始', () => {
    cancel(); judgments.clear(); checked.clear(); collected = []; collectionReason = '';
    stopCollect?.();
    stopCollect = collectResearchPosts(document.body, (posts, skipped, reason) => {
      collected = posts; collectionReason = reason ?? '';
      if (mode === 'collect') sourceStatus.textContent = `この画面から ${posts.length}件収集・取得不可 ${skipped}要素。${reason ?? 'スクロールして投稿を読み込めます。'}`;
      if (reason) { stopCollect = undefined; collect.textContent = '収集を開始'; }
      renderCards();
    });
    if (!collectionReason) collect.textContent = '収集し直す'; else stopCollect = undefined;
    render();
  });
  const stop = button('収集を停止', () => { stopCollect?.(); stopCollect = undefined; render(); });
  const search = button('Jevで探す', () => void judge());
  const localSearch = button('文字で探す', () => { cancel(); judgments.clear(); renderCards(query.value.trim()); results.scrollTop = 0; status.textContent = '文字列検索です。Jevへの送信はありません。'; });
  const cancelButton = button('中断', cancel);
  const searchRow = el('div'); searchRow.className = 'row'; searchRow.append(search, localSearch, cancelButton);
  const collectRow = el('div'); collectRow.className = 'row'; collectRow.append(collect, stop);
  const disclosure = el('p', 'Jevで探すと、目的と対象の表示本文・投稿日時をTypeSafeへ送ります。画像・動画・リンク先・未読の過去投稿は対象外です。'); disclosure.className = 'small';
  controls.append(nav, collectRow, sourceStatus, anchorView, query, notesLabel, searchRow, disclosure, status);
  const footer = el('footer');
  const selectAll = button('収集した全件を選ぶ', () => { checked = new Set(collected.map(post => post.id)); renderCards(); });
  const saveSelection = button('選んだ投稿を保存', () => void savePosts(target().filter(post => checked.has(post.id))));
  const backup = button('書き出し', () => void exportPosts());
  const restore = button('復元', () => importFile.click());
  const clear = button('保存を全件削除', () => {
    if (!confirm('保存投稿とメモを全件削除します。必要なら先に書き出してください。')) return;
    cancel(); void mutate({ type: 'RESEARCH_CLEAR' }, '保存投稿を削除しました。');
  });
  const importFile = el('input'); importFile.type = 'file'; importFile.accept = 'application/json,.json'; importFile.hidden = true;
  importFile.addEventListener('change', () => void importPosts());
  const footerRow = el('div'); footerRow.className = 'row'; footerRow.append(selectAll, saveSelection, backup, restore, clear, importFile);
  footer.append(footerRow, el('p', '保存はこのブラウザ内です。拡張を削除すると失われます。'), el('p', '保存本文は取得時点の表示内容です。')); footer.lastElementChild!.className = 'small';
  section.append(header, controls, results, footer); shadow.append(el('style', CSS + ':host([hidden]),[hidden]{display:none!important}'), section); document.body.append(host);
  query.addEventListener('input', () => { cancel(); judgments.clear(); renderCards(); });
  includeNotes.addEventListener('change', () => { cancel(); judgments.clear(); renderCards(); });
  shadow.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape') { event.preventDefault(); setOpen(false); } });

  async function request(message: unknown) {
    const response = await send(message);
    if (!isRecord(response) || response.ok !== true) {
      const error = isRecord(response) && isRecord(response.error) ? response.error : undefined;
      throw new Error(typeof error?.message === 'string' ? error.message : '処理できませんでした。もう一度お試しください。');
    }
    return response;
  }
  function cancel() {
    const wasActive = active;
    generation++; active = false;
    if (runningId) void send({ type: 'RESEARCH_CANCEL', requestId: runningId }).catch(() => undefined);
    runningId = undefined; search.disabled = false; cancelButton.disabled = true;
    if (wasActive) { status.textContent = `判定を中断しました。${judgments.size}件判定済み。`; renderCards(); }
  }
  async function loadSaved() {
    const revision = ++loadRevision;
    try {
      const response = await request({ type: 'RESEARCH_LIST' });
      if (revision !== loadRevision) return;
      if (!Array.isArray(response.posts)) throw new Error('保存データを確認できませんでした。');
      saved = response.posts.map(validatePost).filter((post): post is ResearchPost => !!post); render();
    } catch (error) { status.textContent = (error as Error).message; }
  }
  async function mutate(message: unknown, success: string) {
    try { await request(message); cached.clear(); judgments.clear(); checked.clear(); await loadSaved(); status.textContent = success; }
    catch (error) { status.textContent = (error as Error).message; }
  }
  async function savePosts(posts: ResearchPost[]) {
    cancel(); let count = 0;
    try {
      for (const post of posts) {
        const existing = saved.find(item => item.id === post.id);
        let update = false;
        if (existing && (existing.text !== post.text || existing.url !== post.url || existing.postedAtUtc !== post.postedAtUtc || existing.lang !== post.lang)) {
          if (!confirm(`保存済みの内容と違います。表示中の内容で更新しますか？\n\n保存済み：${existing.text.slice(0,180)}\n\n現在：${post.text.slice(0,180)}`)) continue;
          update = true;
        }
        await request({ type: 'RESEARCH_SAVE', post: { ...post, note: existing?.note ?? post.note }, update }); count++;
      }
      cached.clear(); await loadSaved(); status.textContent = `${count}件を保存しました。`;
    } catch (error) { await loadSaved(); status.textContent = `${count}件保存済み。${(error as Error).message}`; }
  }
  function render() {
    tabs.forEach((tab, index) => tab.setAttribute('aria-pressed', String((['collect','saved','relate'] as const)[index] === mode)));
    collectRow.hidden = mode !== 'collect'; saveSelection.hidden = mode !== 'collect'; selectAll.hidden = mode !== 'collect';
    stop.disabled = !stopCollect; search.textContent = mode === 'relate' ? 'Jevでつなげる' : 'Jevで探す';
    anchorView.hidden = mode !== 'relate'; anchorView.textContent = anchor ? `比較元：${anchor.text}` : '「これとつなげる」で比較元の投稿を選んでください。';
    query.hidden = mode === 'relate'; localSearch.hidden = mode === 'relate';
    if (mode !== 'collect') sourceStatus.textContent = `保存済み ${saved.length}件。選んだ範囲の全件を調べます。`;
    cancelButton.disabled = !active; renderCards();
  }
  function renderCards(localQuery?: string) {
    const focused = shadow.activeElement as HTMLElement | null;
    // Do not replace a card while its memo is being edited during collection.
    if (focused?.tagName === 'TEXTAREA') return;
    let posts = [...target()];
    if (localQuery) posts = posts.filter(post => `${post.text}\n${post.note}`.toLocaleLowerCase().includes(localQuery.toLocaleLowerCase()));
    const rank = (post: ResearchPost) => { const item = judgments.get(post.id); return mode === 'relate' ? !item ? -1 : item.relation === 'unrelated' || item.relation === 'unknown' ? 0 : item.confidence : item?.score ?? -1; };
    if (judgments.size) posts.sort((a,b) => rank(b) - rank(a));
    results.replaceChildren();
    if (!posts.length) { results.append(el('p', mode === 'collect' ? '収集を開始して、気になる投稿を保存してください。' : '対象の投稿がありません。')); return; }
    for (const post of posts) {
      const card = el('article'); card.dataset.postId = post.id;
      const row = el('div'); row.className = 'row';
      if (mode === 'collect') {
        const check = el('input'); check.type = 'checkbox'; check.checked = checked.has(post.id); check.setAttribute('aria-label', `${post.text.slice(0,40)}を保存対象にする`);
        check.addEventListener('change', () => { if (check.checked) checked.add(post.id); else checked.delete(post.id); }); row.append(check);
      }
      const link = el('a', '元の投稿'); link.href = post.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link);
      const date = el('span', post.postedAtUtc ? new Date(post.postedAtUtc).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '投稿日時不明'); date.className = 'small'; row.append(date);
      card.append(row, el('p', post.text));
      const judgment = judgments.get(post.id);
      if (judgment) {
        card.dataset.relevance = String(judgment.score ?? '');
        card.dataset.relationship = judgment.relation ?? '';
        const label = mode === 'relate' ? judgment.confidence < .6 ? '関連候補（関係は未確定）' : RELATIONS[judgment.relation ?? 'unknown'] ?? '関連候補' : (judgment.score ?? 0) >= .5 ? '目的に近い候補' : '目的との関連が弱い候補';
        card.append(el('p', label));
      } else if (active) card.append(el('p', '未判定'));
      const actions = el('div'); actions.className = 'row';
      actions.append(button('これとつなげる', () => { stopCollect?.(); stopCollect = undefined; cancel(); anchor = post; mode = 'relate'; judgments.clear(); void loadSaved(); render(); results.scrollTop = 0; }));
      const stored = saved.find(item => item.id === post.id);
      if (stored) {
        const memo = el('textarea'); memo.value = stored.note; memo.maxLength = 2000; memo.setAttribute('aria-label', `投稿${post.id}の気になった理由`); memo.placeholder = 'なぜ気になった？（任意）';
        card.append(memo);
        actions.append(button('メモを保存', () => { cancel(); void mutate({ type:'RESEARCH_SAVE', post: { ...stored, note:memo.value }, update:true }, 'メモを保存しました。'); }), button('削除', () => {
          if (!confirm('この保存投稿とメモを削除しますか？')) return;
          cancel(); void mutate({ type:'RESEARCH_DELETE', id:post.id }, '保存投稿を削除しました。');
        }));
      } else actions.append(button('保存', () => void savePosts([post])));
      card.append(actions); results.append(card);
    }
  }
  async function judge() {
    cancel(); const revision = generation; const candidates = target().map(post => ({ ...post }));
    const purpose = query.value.trim();
    if (!candidates.length || (mode !== 'relate' && !purpose) || (mode === 'relate' && !anchor)) { status.textContent = '対象の投稿と、探したいことを選んでください。'; return; }
    const context = JSON.stringify([mode, purpose, candidates, mode === 'relate' ? anchor : undefined, includeNotes.checked]);
    if (context !== cacheContext) { cached.clear(); cacheContext = context; }
    stopCollect?.(); stopCollect = undefined;
    judgments.clear(); active = true; search.disabled = true; cancelButton.disabled = false;
    const start = performance.now(); let processed = 0; let inputTokens = 0; let outputTokens = 0; let usageKnown = true;
    status.textContent = `0 / ${candidates.length}件を判定中…`; renderCards();
    results.scrollTop = 0;
    try {
      while (processed < candidates.length && revision === generation) {
        const batch: ResearchPost[] = []; let chars = purpose.length + (mode === 'relate' ? (anchor?.text.length ?? 0) + (includeNotes.checked ? anchor?.note.length ?? 0 : 0) : 0);
        for (const post of candidates.slice(processed, processed + MAX_RESEARCH_BATCH)) {
          const size = post.text.length + (includeNotes.checked ? post.note.length : 0);
          if (batch.length && chars + size > MAX_RESEARCH_BATCH_CHARS) break;
          batch.push(post); chars += size;
        }
        runningId = crypto.randomUUID();
        const payload = { mode:mode === 'relate' ? 'relate' : 'search', query:purpose, posts:batch, anchor:mode === 'relate' ? anchor : undefined, includeNotes:includeNotes.checked };
        const cacheKey = JSON.stringify(payload);
        const reused = cached.has(cacheKey);
        const response = reused ? cached.get(cacheKey)! : await request({ type:'RESEARCH_JUDGE', payload: { ...payload, requestId:runningId } });
        if (revision !== generation) return;
        if (!Array.isArray(response.results) || response.results.length !== batch.length) throw new Error('判定結果を確認できませんでした。');
        for (const raw of response.results) {
          if (!isRecord(raw) || typeof raw.id !== 'string' || !batch.some(post=>post.id === raw.id) || typeof raw.confidence !== 'number') throw new Error('判定結果を確認できませんでした。');
          judgments.set(raw.id, raw as unknown as Judgment);
        }
        cached.set(cacheKey, response);
        processed += batch.length;
        if (!reused) { if (isRecord(response.usage)) { inputTokens += Number(response.usage.input_tokens) || 0; outputTokens += Number(response.usage.output_tokens) || 0; } else usageKnown = false; }
        status.textContent = `${processed} / ${candidates.length}件を判定済み`; renderCards();
      }
      const relevant = [...judgments.values()].filter(item => mode === 'relate' ? item.relation !== 'unrelated' && item.relation !== 'unknown' : (item.score ?? 0) >= .5);
      status.textContent = `${processed}件判定・候補${relevant.length}件・${((performance.now()-start)/1000).toFixed(1)}秒（${usageKnown ? `入力${inputTokens} / 出力${outputTokens}トークン` : 'API使用量は未取得'}）。${relevant.length ? '' : '目的に近い候補は見つかりませんでした。'}`;
    } catch (error) { if (revision === generation) status.textContent = `${processed}件判定済み・${candidates.length-processed}件未判定。${(error as Error).message} 文字列検索も使えます。`; }
    finally { if (revision === generation) { active = false; runningId = undefined; search.disabled = false; cancelButton.disabled = true; renderCards(); } }
  }
  async function exportPosts() {
    try {
      const response = await request({ type:'RESEARCH_EXPORT' });
      const url = URL.createObjectURL(new Blob([JSON.stringify(response.backup, null, 2)], {type:'application/json'}));
      const link = el('a'); link.href = url; link.download = 'x-research-backup.json'; shadow.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
      status.textContent = '保存投稿を書き出しました。';
    } catch(error) { status.textContent = (error as Error).message; }
  }
  async function importPosts() {
    const file = importFile.files?.[0]; importFile.value = ''; if (!file) return;
    cancel();
    try {
      if (file.size > 4*1024*1024) throw new Error('復元ファイルが大きすぎます。');
      await mutate({type:'RESEARCH_IMPORT', backup:JSON.parse(await file.text())}, '未登録の投稿を復元しました。既存の本文とメモは保持しています。');
    } catch(error) { status.textContent = (error as Error).message; }
  }
  function setOpen(open: boolean) {
    if (open === !host.hidden) return;
    host.hidden = !open;
    if (open) { previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; query.focus(); void loadSaved(); }
    else { stopCollect?.(); stopCollect = undefined; cancel(); if (previousFocus?.isConnected) previousFocus.focus(); }
  }
  render();
  return { host, toggle: () => setOpen(Boolean(host.hidden)), open: () => setOpen(true), close: () => setOpen(false), dispose: () => { setOpen(false); host.remove(); } };
}
