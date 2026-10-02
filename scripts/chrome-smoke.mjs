import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const profile = await mkdtemp(resolve(tmpdir(), 'x-to-jst-chrome-'));
const extension = resolve('dist');
const realExtension = process.argv.includes('--extension');
const launchOptions = {
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--no-sandbox', '--enable-unsafe-extension-debugging'],
};
let context = await chromium.launchPersistentContext(profile, launchOptions);
try {
  let optionsUrl;
  let id;
  if (realExtension) {
    const browserSession = await context.browser().newBrowserCDPSession();
    await browserSession.send('Extensions.loadUnpacked', { path: extension });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    id = worker.url().split('/')[2];
    optionsUrl = `chrome-extension://${id}/options/index.html`;
  } else {
    let key;
    const researchPosts = new Map();
    await context.exposeBinding('fixtureRuntimeMessage', async (_source, message) => {
      if (message.type === 'SAVE_API_KEY') { key = message.key; return { ok: true }; }
      if (message.type === 'DELETE_API_KEY') { key = undefined; return { ok: true }; }
      if (message.type === 'GET_KEY_STATUS') return { ok: true, configured: !!key };
      if (message.type === 'RESEARCH_LIST') return { ok: true, posts: [...researchPosts.values()] };
      if (message.type === 'RESEARCH_SAVE') { researchPosts.set(message.post.id, message.post); return { ok: true, posts: [...researchPosts.values()] }; }
      if (message.type === 'RESEARCH_EXPORT') return { ok: true, backup: { version: 1, posts: [...researchPosts.values()] } };
      if (message.type === 'RESEARCH_IMPORT') { for (const post of message.backup.posts) if (!researchPosts.has(post.id)) researchPosts.set(post.id, post); return { ok: true, posts: [...researchPosts.values()] }; }
      if (message.type === 'RESEARCH_DELETE') { researchPosts.delete(message.id); return { ok: true, posts: [...researchPosts.values()] }; }
      if (message.type === 'RESEARCH_CLEAR') { researchPosts.clear(); return { ok: true, posts: [] }; }
      if (message.type === 'RESEARCH_JUDGE') return { ok: true, results: message.payload.posts.map(post => ({ id: post.id, score: 0, confidence: 1 })), usage: { input_tokens: 20, output_tokens: 5 } };
      if (message.type === 'RESEARCH_CANCEL') return { ok: true };
      return { ok: false, error: { code: 'KEY_NOT_SET' } };
    });
    await context.addInitScript(() => { globalThis.chrome = { runtime: { sendMessage: message => globalThis.fixtureRuntimeMessage(message), onMessage: { addListener: listener => { globalThis.fixtureRuntimeListener = listener; } } } }; });
    await context.route('https://extension.test/**', async route => {
      const filename = new URL(route.request().url()).pathname.split('/').pop();
      const contentType = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html';
      await route.fulfill({ contentType, body: await readFile(resolve(extension, 'options', filename)) });
    });
    optionsUrl = 'https://extension.test/options/index.html';
  }
  const routeXFixture = () => context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ja"><head><meta charset="UTF-8"></head><body><main id="feed"><article data-testid="tweet"><div data-testid="tweetText">Tomorrow at 10am PT</div><a href="https://x.com/author/status/1"><time datetime="2026-10-02T02:14:00Z"></time></a></article></main></body></html>' }));
  await routeXFixture();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const session = await context.newCDPSession(page);
  const worlds = [];
  session.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world));
  await session.send('Runtime.enable');
  await page.goto('https://x.com/home');
  if (!realExtension) await page.addScriptTag({ path: resolve(extension, 'content.js') });
  await page.getByRole('button', { name: '🇯🇵 日本時間', exact: true }).waitFor();
  await page.getByRole('button', { name: '🇯🇵 日本時間', exact: true }).click();
  await page.getByText('2026年10月3日（土）02:00 JST', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-x-to-jst-host]').count(), 1);
  const options = await context.newPage();
  await options.goto(optionsUrl);
  await options.getByText('APIキーは未設定です。', { exact: true }).waitFor();
  await options.getByLabel('新しいAPIキー').fill('chrome-smoke-test-key');
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await options.getByText('APIキーを保存しました。', { exact: true }).waitFor();
  await options.reload();
  await options.getByText('APIキーを保存済みです。', { exact: true }).waitFor();
  assert.equal(await options.getByLabel('新しいAPIキー').inputValue(), '');
  if (realExtension) {
    const world = worlds.find(world => world.origin === `chrome-extension://${id}` || world.name === 'X to JST');
    assert.ok(world, 'Extension isolated world missing');
    const access = await session.send('Runtime.evaluate', { contextId: world.id, expression: "chrome.storage.local.get('apiKey').then(() => 'accessible', () => 'denied')", awaitPromise: true, returnByValue: true });
    assert.equal(access.result.value, 'denied', 'Content scripts must not have access to local storage');
  }
  await options.getByRole('button', { name: '削除', exact: true }).click();
  await options.getByText('APIキーを削除しました。', { exact: true }).waitFor();
  await page.evaluate(() => {
    document.querySelector('[data-testid="tweetText"]').textContent = 'Tomorrow at 10am PST';
  });
  await page.getByRole('button', { name: '🇯🇵 日本時間', exact: true }).click();
  await page.getByText('2026年10月3日（土）03:00 JST', { exact: true }).waitFor();
  assert.ok(await page.getByText(/APIキーは未設定/).count());
  await page.evaluate(() => {
    history.pushState({}, '', '/author');
    const post = document.querySelector('article').cloneNode(true);
    post.querySelector('[data-x-to-jst-host]').remove();
    document.querySelector('#feed').append(post);
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-x-to-jst-host]').length === 2);
  await page.getByRole('button', { name: '🇯🇵 日本時間', exact: true }).nth(1).click();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://x.com' });
  await page.getByRole('button', { name: '2026年10月3日（土）03:00 JSTをコピー', exact: true }).nth(1).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-x-to-jst-host]')].some(host => host.shadowRoot.textContent.includes('コピーしました')));
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '日本時間 2026年10月3日（土）03:00 JST');
  assert.equal(await page.evaluate(() => document.body.textContent.includes('chrome-smoke-test-key')), false);
  const toggleResearch = async () => {
    if (realExtension) {
      await context.serviceWorkers()[0].evaluate(async () => {
        const tabs = await chrome.tabs.query({});
        await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_RESEARCH' }).catch(() => undefined)));
      });
    } else await page.evaluate(() => globalThis.fixtureRuntimeListener({ type: 'TOGGLE_RESEARCH' }));
  };
  await toggleResearch();
  const research = page.getByRole('dialog', { name: 'X 調べもの', exact: true });
  await research.waitFor();
  await research.getByRole('button', { name: '拾う', exact: true }).click();
  await research.getByRole('button', { name: '収集を開始', exact: true }).click();
  const researchCard = research.locator('article[data-post-id="1"]');
  const openMemo = async (card = researchCard) => {
    const summary = card.locator('details.post-details:not([open]) > summary');
    if (await summary.count()) await summary.click();
  };
  await researchCard.waitFor();
  await researchCard.getByRole('checkbox').check();
  await research.getByRole('button', { name: '選んだ投稿を保存', exact: true }).click();
  await research.getByText('1件を保存しました。', { exact: true }).waitFor();
  await research.getByRole('button', { name: '収集を停止', exact: true }).click();
  await research.getByRole('button', { name: '探す', exact: true }).click();
  assert.equal(await researchCard.getByRole('textbox', { name: '投稿1の気になった理由', exact: true }).isVisible(), false);
  await openMemo();
  await researchCard.getByRole('textbox', { name: '投稿1の気になった理由', exact: true }).fill('smoke: remember this workflow');
  await researchCard.getByRole('button', { name: 'メモを保存', exact: true }).click();
  await research.getByText('メモを保存しました。', { exact: true }).waitFor();
  await page.reload();
  if (!realExtension) await page.addScriptTag({ path: resolve(extension, 'content.js') });
  await page.getByRole('button', { name: '🇯🇵 日本時間', exact: true }).waitFor();
  await toggleResearch();
  await researchCard.waitFor();
  await openMemo();
  await researchCard.getByRole('textbox', { name: '投稿1の気になった理由', exact: true }).waitFor();
  assert.equal(await researchCard.getByRole('textbox', { name: '投稿1の気になった理由', exact: true }).inputValue(), 'smoke: remember this workflow');
  assert.equal(await researchCard.getByRole('link', { name: '元の投稿', exact: true }).getAttribute('href'), 'https://x.com/author/status/1');
  assert.equal(await researchCard.getByText('Tomorrow at 10am PST', { exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => document.body.textContent.includes('chrome-smoke-test-key')), false);
  const downloaded = page.waitForEvent('download');
  await research.getByText('バックアップ・管理', { exact: true }).click();
  await research.getByRole('button', { name: '書き出し', exact: true }).click();
  const download = await downloaded;
  const backupText = await readFile(await download.path(), 'utf8');
  const backup = JSON.parse(backupText);
  assert.equal(backup.version, 1);
  assert.equal(backup.posts.length, 1);
  assert.equal(backup.posts[0].text, 'Tomorrow at 10am PST');
  assert.equal(backup.posts[0].note, 'smoke: remember this workflow');
  assert.equal(backupText.includes('chrome-smoke-test-key'), false);
  assert.equal(backupText.includes('apiKey'), false);
  await research.locator('input[type=file]').setInputFiles({ name: 'smoke-backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
  await research.getByText('未登録の投稿を復元しました。既存の本文とメモは保持しています。', { exact: true }).waitFor();
  await openMemo();
  assert.equal(await researchCard.getByRole('textbox', { name: '投稿1の気になった理由', exact: true }).inputValue(), 'smoke: remember this workflow');
  for (const all of [false, true]) {
    page.once('dialog', dialog => dialog.accept());
    await (all ? research.getByRole('button', { name: '保存を全件削除', exact: true }) : researchCard.getByRole('button', { name: '削除', exact: true })).click();
    await research.getByText('保存投稿を削除しました。', { exact: true }).waitFor();
    assert.equal(await researchCard.count(), 0, 'Deleted fixture post must be absent before restore');
    await research.locator('input[type=file]').setInputFiles({ name: 'smoke-backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
    await research.getByText('未登録の投稿を復元しました。既存の本文とメモは保持しています。', { exact: true }).waitFor();
    await openMemo();
    assert.equal(await researchCard.getByRole('textbox', { name: '投稿1の気になった理由', exact: true }).inputValue(), 'smoke: remember this workflow');
    assert.equal(await researchCard.getByText('Tomorrow at 10am PST', { exact: true }).count(), 1);
    assert.equal(await researchCard.getByRole('link', { name: '元の投稿', exact: true }).getAttribute('href'), 'https://x.com/author/status/1');
  }
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  if (!realExtension) {
    await research.getByRole('textbox', { name: '探したいこと', exact: true }).fill('YouTubeショート動画の再生数を伸ばすコツ');
    await research.getByRole('button', { name: 'Jevで探す', exact: true }).click();
    await research.getByText('候補0件。目的に近い候補は見つかりませんでした。', { exact: true }).waitFor();
    assert.equal(await research.locator('#results > article').count(), 0);
    assert.equal(await researchCard.isVisible(), false, 'Unmatched post must be folded by default');
    await research.getByText('バックアップ・管理', { exact: true }).click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await research.screenshot({ path: 'test-results/research-empty-fixture.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await research.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844);
    await research.screenshot({ path: 'test-results/research-narrow-fixture.png' });
    await research.getByText('その他の投稿（1件）', { exact: true }).click();
    await researchCard.waitFor();
    await openMemo();
    assert.equal(await researchCard.getByRole('textbox', { name: '投稿1の気になった理由', exact: true }).inputValue(), 'smoke: remember this workflow');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.emulateMedia({ colorScheme: 'light' });
  }
  await page.screenshot({ path: 'test-results/chrome-light.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/chrome-dark.png', fullPage: true });
  await context.route('https://x.com/i/bookmarks*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ja"><head><meta charset="UTF-8"></head><body><main data-testid="primaryColumn"><section role="region" aria-label="Timeline: Bookmarks"><article data-testid="tweet"><div data-testid="tweetText">AIで議事録を自動化する方法</div><a href="https://x.com/author/status/10"><time datetime="2026-10-02T00:00:00Z"></time></a></article><article data-testid="tweet"><div data-testid="tweetText">今日の昼ごはん</div><a href="https://x.com/author/status/11"><time datetime="2026-10-02T00:00:00Z"></time></a></article></section></main></body></html>' }));
  const inlinePage = await context.newPage();
  inlinePage.on('pageerror', error => errors.push(error.message));
  await inlinePage.goto('https://x.com/i/bookmarks');
  if (!realExtension) await inlinePage.addScriptTag({ path: resolve(extension, 'content.js') });
  const inlineHost = inlinePage.locator('[data-x-inline-research-host]');
  await inlineHost.waitFor();
  if (!realExtension) {
    await inlinePage.evaluate(() => globalThis.fixtureRuntimeListener({ type: 'TOGGLE_RESEARCH' }));
    assert.equal(await inlineHost.evaluate(node => getComputedStyle(node).display), 'none');
    await inlinePage.evaluate(() => globalThis.fixtureRuntimeListener({ type: 'TOGGLE_RESEARCH' }));
    assert.equal(await inlineHost.evaluate(node => getComputedStyle(node).display), 'block');
  }
  await inlineHost.getByRole('searchbox', { name: '探したいこと', exact: true }).fill('議事録');
  await inlineHost.getByRole('button', { name: '文字で探す', exact: true }).click();
  await inlineHost.locator('[data-post-id="10"]').waitFor();
  assert.equal(await inlineHost.locator('[data-post-id]').count(), 1);
  assert.equal(await inlineHost.locator('[data-post-id="10"] a').first().getAttribute('href'), 'https://x.com/author/status/10');
  assert.equal(await inlinePage.locator('main > section[role=region]').evaluate(node => node.hidden), true);
  await inlineHost.getByRole('button', { name: '通常表示に戻る', exact: true }).click();
  assert.equal(await inlinePage.locator('main > section[role=region]').evaluate(node => node.hidden), false);
  assert.equal(await inlineHost.locator('[data-post-id]').count(), 0);
  await inlineHost.getByRole('searchbox', { name: '探したいこと', exact: true }).fill('存在しないキーワード');
  await inlineHost.getByRole('button', { name: '文字で探す', exact: true }).click();
  assert.equal(await inlineHost.locator('[data-post-id]').count(), 0);
  assert.equal(await inlinePage.locator('main > section[role=region]').evaluate(node => node.hidden), true);
  await inlinePage.close();
  assert.deepEqual(errors, []);
  if (realExtension) {
    await context.close();
    context = await chromium.launchPersistentContext(profile, launchOptions);
    const restartedSession = await context.browser().newBrowserCDPSession();
    await restartedSession.send('Extensions.loadUnpacked', { path: extension });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    assert.equal(worker.url().split('/')[2], id, 'Extension identity must survive restart');
    await routeXFixture();
    const restartedPage = await context.newPage();
    restartedPage.on('pageerror', error => errors.push(error.message));
    await restartedPage.goto('https://x.com/home');
    await restartedPage.getByRole('button', { name: '🇯🇵 日本時間', exact: true }).waitFor();
    await toggleResearch();
    const restartedCard = restartedPage.getByRole('dialog', { name: 'X 調べもの', exact: true }).locator('article[data-post-id="1"]');
    await restartedCard.waitFor();
    await openMemo(restartedCard);
    await restartedCard.getByRole('textbox', { name: '投稿1の気になった理由', exact: true }).waitFor();
    assert.equal(await restartedCard.getByRole('textbox', { name: '投稿1の気になった理由', exact: true }).inputValue(), 'smoke: remember this workflow');
    assert.equal(await restartedCard.getByText('Tomorrow at 10am PST', { exact: true }).count(), 1);
    assert.equal(await restartedCard.getByRole('link', { name: '元の投稿', exact: true }).getAttribute('href'), 'https://x.com/author/status/1');
    assert.deepEqual(errors, []);
  }
  const report = { browser: context.browser()?.version(), date: new Date().toISOString(), result: 'passed', mode: realExtension ? 'real-extension-with-X-fixture' : 'compiled-UI-with-mocked-runtime',
    checks: ['unique JST rendering', 'key save/reload/delete', 'unset-key fallback', 'SPA/additional-post injection', 'copy', 'no key in X DOM', 'research panel open', 'explicit collection and selection save', 'research memo save', 'research post and memo persist across page reload', 'backup download version/post/memo and no API key', 'same-backup restore preserves memo', 'central inline bookmark local search/filter/return and empty-result native hiding', 'single post delete and backup restore preserve text/memo/URL', 'clear saved posts and backup restore preserve text/memo/URL', ...(!realExtension ? ['inline mock toggle hides and restores host computed display'] : []), ...(realExtension ? ['MV3 load', 'real content-script storage denial', 'research post and memo persist across browser restart with same profile'] : [])],
    limitations: ['X page is a deterministic fixture; live X DOM is not tested.', 'No paid TypeSafe request is made.', ...(!realExtension ? ['Mock persistence is checked across page reload, not browser restart.'] : []), 'Panel opening uses its runtime toggle message; a toolbar action click is not simulated.', ...(!realExtension ? ['Chrome runtime and research storage are mocked in memory; MV3 loading and real storage persistence/isolation are not verified.'] : [])] };
  if (!realExtension) report.checks.push('zero-candidate search folds unmatched posts', '390px research panel stays within viewport', 'folded posts retain original memo');
  await writeFile(`test-results/${realExtension ? 'chrome' : 'browser'}-smoke.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
