import type { TweetContext } from '../types/messages';
import { validTimestamp } from '../core/parser';
export const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const TEXT_SELECTOR = '[data-testid="tweetText"]';
const QUOTE_SELECTOR = '[data-testid="quoteTweet"], [data-testid="quotedTweet"]';
function owned(article: HTMLElement, selector: string): HTMLElement[] {
  return [...article.querySelectorAll<HTMLElement>(selector)].filter(node => node.closest(ARTICLE_SELECTOR) === article && !node.closest(QUOTE_SELECTOR));
}
export function extractTweetContext(article: HTMLElement): TweetContext | undefined {
  const texts = owned(article, TEXT_SELECTOR);
  // Unknown quote markup must fail rather than mix text and timestamps.
  if (texts.length !== 1 || !texts[0]?.textContent?.trim()) return;
  const times = owned(article, 'time[datetime]');
  const timestamp = times.length === 1 ? times[0]!.getAttribute('datetime') ?? undefined : undefined;
  const link = times.length === 1 ? times[0]!.closest<HTMLAnchorElement>('a[href]') : undefined;
  const url = link?.href.startsWith('https://x.com/') ? link.href : undefined;
  return { text: texts[0]!.textContent!.trim(), postedAtUtc: validTimestamp(timestamp) ? timestamp : undefined, url, lang: texts[0]!.getAttribute('lang') ?? undefined };
}
