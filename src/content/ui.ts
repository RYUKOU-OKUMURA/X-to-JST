import { isRecord, type ResolveMessage, type Resolution, type TimeCandidate, type TweetContext } from '../types/messages';
import { copyText, formatJst } from '../core/formatter';
import { chooseCandidate, resolveLocal, CONFIDENCE_THRESHOLD, PROBABILITY_GAP } from '../core/resolver';
import { validateChoice } from '../background/jev-client';
import { extractTweetContext } from './x-dom';
type SendMessage = (message: unknown) => Promise<unknown>;
const controls = new WeakMap<HTMLElement, () => void>();
export function refreshUi(article: HTMLElement) { controls.get(article)?.(); }
const CSS = `:host{display:block;flex:0 0 100%;min-width:0;margin:8px 0;color-scheme:light dark}*{box-sizing:border-box}section{font:13px/1.5 system-ui,sans-serif;color:CanvasText;text-align:left}button{font:inherit;padding:3px 8px;border:1px solid #6c8090;border-radius:12px;background:Canvas;color:CanvasText;cursor:pointer}.trigger{border:0;padding:3px 0}button:focus-visible,summary:focus-visible{outline:3px solid #1d9bf0;outline-offset:2px}button:disabled{opacity:.6;cursor:wait}.result{border-top:1px solid #6c8090;padding-top:6px;margin-top:4px;overflow-wrap:anywhere}p{margin:4px 0}.candidate{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;padding:4px 0}.time{font-size:14px;font-weight:600}.label{font-size:12px}details{margin-top:4px}summary{cursor:pointer;width:fit-content}`;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}
export async function resolveWithJev(context: TweetContext, send: SendMessage): Promise<Resolution> {
  const local = resolveLocal(context);
  if (local.status !== 'ambiguous') return local;
  const message: ResolveMessage = { type: 'RESOLVE_TIME_AMBIGUITY', payload: {
    tweetText: context.text, postedAtUtc: context.postedAtUtc, expression: local.expression, candidates: local.candidates,
  } };
  try {
    const reply = await send(message);
    if (isRecord(reply) && reply.ok === true) {
      const choice = validateChoice(reply.result, local.candidates.map(candidate => candidate.id));
      if (choice) {
        const candidate = chooseCandidate(choice, local.candidates);
        if (candidate) return { status: 'resolved', expression: local.expression, candidate, jev: choice };
        return { ...local, jev: choice, warning: '時刻表記に曖昧さがあります。候補を確認してください。' };
      }
    }
    const unset = isRecord(reply) && isRecord(reply.error) && reply.error.code === 'KEY_NOT_SET';
    return { ...local, warning: unset ? 'TypeSafe APIキーは未設定です。計算済みの候補を表示します。' : 'Jev判定を取得できませんでした。計算済みの候補を表示します。' };
  } catch { return { ...local, warning: 'Jev判定を取得できませんでした。計算済みの候補を表示します。' }; }
}
export function attachUi(article: HTMLElement, send: SendMessage = message => chrome.runtime.sendMessage(message)) {
  const host = element('div');
  host.dataset.xToJstHost = 'true';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = element('style', CSS);
  const section = element('section');
  section.setAttribute('aria-label', '日本時間への変換');
  const button = element('button', '🇯🇵 日本時間');
  button.type = 'button';
  button.className = 'trigger';
  const result = element('div');
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');
  section.append(button, result);
  shadow.append(style, section);
  // X articles are flex rows; keep the control and results on their own full-width row.
  article.style.flexWrap = 'wrap';
  article.append(host);
  let lastContext = JSON.stringify(extractTweetContext(article));
  controls.set(article, () => {
    const current = JSON.stringify(extractTweetContext(article));
    if (current !== lastContext) {
      lastContext = current;
      result.className = '';
      result.replaceChildren();
    }
  });
  function candidateCard(candidate: TimeCandidate, timezoneToken: string) {
    const card = element('div'); card.className = 'candidate';
    const time = element('span', formatJst(candidate)); time.className = 'time';
    const label = element('span', candidate.sourceZone.includes('/') ? '現地時間' : `${timezoneToken}固定`); label.className = 'label';
    card.append(time, label);
    const copy = element('button', 'コピー'); copy.type = 'button';
    copy.setAttribute('aria-label', `${formatJst(candidate)}をコピー`);
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(copyText(candidate)); copy.textContent = 'コピーしました'; }
      catch { copy.textContent = 'コピーできませんでした'; }
    });
    card.append(copy);
    return card;
  }
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true; button.textContent = '変換しています…';
    result.className = 'result'; result.replaceChildren(element('p', '日本時間を確認しています…'));
    const context = extractTweetContext(article);
    lastContext = JSON.stringify(context);
    try {
      const resolution = context ? await resolveWithJev(context, send) : { status: 'unsupported' as const, reason: 'ポスト本文を取得できませんでした。引用ポストを単独で開いてお試しください。' };
      if (!article.isConnected) return;
      if (context && JSON.stringify(extractTweetContext(article)) !== JSON.stringify(context)) {
        result.replaceChildren(element('p', 'ポストが更新されました。もう一度変換してください。')); return;
      }
      result.replaceChildren();
      if (resolution.status === 'unsupported') result.append(element('p', resolution.reason));
      else {
        const candidates = resolution.status === 'resolved' ? [resolution.candidate] : resolution.candidates;
        if (resolution.status === 'ambiguous') result.append(element('p', `⚠️ ${candidates.length}候補・未確定`));
        candidates.forEach(candidate => { result.append(candidateCard(candidate, resolution.expression.timezoneToken)); });
        const details = element('details'); details.append(element('summary', '詳細'));
        if (resolution.status === 'ambiguous' && resolution.warning) details.append(element('p', resolution.warning));
        candidates.forEach(candidate => {
          details.append(element('p', `${formatJst(candidate)} — ${candidate.reason}`));
          if (candidate.warning) details.append(element('p', `⚠️ ${candidate.warning}`));
        });
        if (resolution.jev) {
          const jev = resolution.jev;
          const selected = candidates.find(candidate => candidate.id === jev.choice);
          details.append(element('p', 'TypeSafe / Jev：応答確認済み'),
            element('p', `判定：${selected ? formatJst(selected) : '未確定'}・確信度 ${(jev.confidence * 100).toFixed(1)}%`),
            element('p', `自動確定の条件：確信度${CONFIDENCE_THRESHOLD * 100}%以上・上位差${PROBABILITY_GAP * 100}ポイント以上`));
        }
        details.append(element('p', `抽出した表現：${resolution.expression.raw}`));
        if (resolution.status === 'ambiguous' && !resolution.jev) {
          const options = element('button', 'APIキー設定'); options.type = 'button';
          options.addEventListener('click', () => { void send({ type: 'OPEN_OPTIONS' }).catch(() => { options.textContent = '拡張機能の設定を開いてください'; }); });
          details.append(options);
        }
        result.append(details);
      }
    } catch { result.replaceChildren(element('p', '変換できませんでした。もう一度お試しください。')); }
    finally { button.disabled = false; button.textContent = '🇯🇵 日本時間'; }
  });
  return host;
}
