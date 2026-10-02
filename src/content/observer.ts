import { ARTICLE_SELECTOR } from './x-dom';
import { attachUi, refreshUi } from './ui';
const active = new WeakMap<HTMLElement, () => void>();
export function observePosts(root: HTMLElement = document.body, attach = attachUi): () => void {
  const existing = active.get(root);
  if (existing) return existing;
  const pending = new Set<HTMLElement>();
  let scheduled = false;
  let stopped = false;
  function add(article: HTMLElement) {
    const already = [...article.children].some(node => node instanceof HTMLElement && node.dataset.xToJstHost);
    if (!already && article.isConnected) attach(article);
    else if (already) refreshUi(article);
  }
  function collect(node: Node) {
    if (!(node instanceof HTMLElement)) return;
    const owner = node.closest<HTMLElement>(ARTICLE_SELECTOR);
    if (owner) pending.add(owner);
    if (node.matches(ARTICLE_SELECTOR)) pending.add(node);
    node.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR).forEach(article => pending.add(article));
  }
  collect(root); pending.forEach(add); pending.clear();
  const observer = new MutationObserver(records => {
    records.forEach(record => {
      record.addedNodes.forEach(collect);
      if (record.removedNodes.length) collect(record.target);
      if (record.type === 'characterData' && record.target.parentNode) collect(record.target.parentNode);
    });
    if (scheduled || !pending.size) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!stopped) pending.forEach(add); pending.clear(); });
  });
  observer.observe(root, { childList: true, characterData: true, subtree: true });
  const stop = () => { stopped = true; observer.disconnect(); pending.clear(); active.delete(root); };
  active.set(root, stop);
  return stop;
}
