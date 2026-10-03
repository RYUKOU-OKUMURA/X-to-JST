import { ARTICLE_SELECTOR, extractTweetContext } from './x-dom';
import { makePost, MAX_RESEARCH_BYTES, MAX_RESEARCH_POSTS, postBytes, type ResearchPost } from '../core/research';

export function researchSource(path = location.pathname): ResearchPost['source'] {
  const bookmarks = path.startsWith('/i/bookmarks') || (path === '/i/history' && [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].some(tab => /^(ブックマーク|Bookmarks)$/i.test(tab.textContent?.trim() ?? '')));
  return bookmarks ? 'bookmarks' : /\/status\/\d+/.test(path) ? 'post' : path === '/home' ? 'timeline' : 'other';
}
export function collectResearchPosts(root: HTMLElement, onChange: (posts: ResearchPost[], skipped: number, stopped?: string) => void) {
  const posts = new Map<string, ResearchPost>();
  const rejected = new WeakSet<HTMLElement>();
  const startUrl = location.href;
  const source = researchSource();
  let skipped = 0;
  let stopped = false;
  let scheduled = false;
  let bytes = 0;
  let notified = '';
  function stop(reason = '収集を停止しました。') {
    if (stopped) return;
    stopped = true; observer.disconnect(); clearInterval(routeTimer);
    onChange([...posts.values()], skipped, reason);
  }
  function scan() {
    if (stopped) return;
    if (location.href !== startUrl || researchSource() !== source) { stop('ページが変わったため収集を停止しました。'); return; }
    for (const article of root.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR)) {
      const context = extractTweetContext(article);
      const post = context && makePost(context, source);
      if (!post) { if (!rejected.has(article)) { rejected.add(article); skipped++; } continue; }
      const previous = posts.get(post.id);
      // Keep the first displayed snapshot; a language change can be recollected explicitly.
      if (previous) continue;
      if (posts.size >= MAX_RESEARCH_POSTS || bytes + postBytes(post) > MAX_RESEARCH_BYTES) {
        stop('収集上限に達しました。選んだ投稿を保存してから、次の収集を始めてください。'); return;
      }
      posts.set(post.id, post);
      bytes += postBytes(post);
    }
    const next = `${posts.size}:${skipped}`;
    if (next !== notified) { notified = next; onChange([...posts.values()], skipped); }
  }
  const observer = new MutationObserver(() => {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; scan(); });
  });
  const routeTimer = setInterval(() => { if (location.href !== startUrl || researchSource() !== source) stop('ページが変わったため収集を停止しました。'); }, 300);
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['datetime', 'href', 'lang'] });
  scan();
  return () => stop();
}
