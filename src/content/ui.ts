import { isRecord, type ResolveMessage, type Resolution, type TimeCandidate, type TweetContext } from '../types/messages';
import { copyText, formatJst } from '../core/formatter';
import { chooseCandidate, resolveLocal } from '../core/resolver';
import { validateChoice } from '../background/jev-client';
import { extractTweetContext } from './x-dom';
type SendMessage = (message: unknown) => Promise<unknown>;
const controls = new WeakMap<HTMLElement, () => void>();
export function refreshUi(article: HTMLElement) { controls.get(article)?.(); }
const CSS = `:host{display:block;flex:0 0 100%;min-width:0;margin:8px 0;color-scheme:light dark}*{box-sizing:border-box}section{font:14px/1.6 system-ui,sans-serif;color:CanvasText;text-align:left}button{font:inherit;padding:6px 12px;border:1px solid #6c8090;border-radius:16px;background:Canvas;color:CanvasText;cursor:pointer}button:focus-visible{outline:3px solid #1d9bf0;outline-offset:2px}button:disabled{opacity:.6;cursor:wait}.result{border:1px solid #6c8090;border-radius:12px;padding:12px;margin-top:8px;background:Canvas;color:CanvasText;overflow-wrap:anywhere}h3{font-size:16px;margin:0 0 8px}p{margin:4px 0 8px}.candidate{padding:8px 0}.time{font-size:17px;font-weight:700}.warning{font-size:13px}details{margin-top:8px}summary{cursor:pointer}`;
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
      const candidate = choice && chooseCandidate(choice, local.candidates);
      if (candidate) return { status: 'resolved', expression: local.expression, candidate };
      return { ...local, warning: '時刻表記に曖昧さがあります。候補を確認してください。' };
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
  function candidateCard(candidate: TimeCandidate) {
    const card = element('div'); card.className = 'candidate';
    const time = element('p', formatJst(candidate)); time.className = 'time';
    card.append(time, element('p', candidate.reason));
    if (candidate.warning) { const warning = element('p', `⚠️ ${candidate.warning}`); warning.className = 'warning'; card.append(warning); }
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
      result.replaceChildren(element('h3', '🇯🇵 日本時間'));
      if (resolution.status === 'unsupported') result.append(element('p', resolution.reason));
      else {
        if (resolution.status === 'resolved') result.append(candidateCard(resolution.candidate));
        else {
          result.append(element('p', resolution.warning ?? '⚠️ 複数の解釈があります。'));
          resolution.candidates.forEach(candidate => { result.append(candidateCard(candidate)); });
          const options = element('button', 'APIキー設定'); options.type = 'button';
          options.addEventListener('click', () => { void send({ type: 'OPEN_OPTIONS' }).catch(() => { options.textContent = '拡張機能の設定を開いてください'; }); });
          result.append(options);
        }
        const details = element('details'); details.append(element('summary', '原文'), element('p', resolution.expression.raw)); result.append(details);
      }
    } catch { result.replaceChildren(element('p', '変換できませんでした。もう一度お試しください。')); }
    finally { button.disabled = false; button.textContent = '🇯🇵 日本時間'; }
  });
  return host;
}
