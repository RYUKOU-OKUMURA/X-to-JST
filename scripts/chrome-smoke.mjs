import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const profile = await mkdtemp(resolve(tmpdir(), 'x-to-jst-chrome-'));
const extension = resolve('dist');
const realExtension = process.argv.includes('--extension');
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--no-sandbox', '--enable-unsafe-extension-debugging'],
});
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
    await context.exposeBinding('fixtureRuntimeMessage', async (_source, message) => {
      if (message.type === 'SAVE_API_KEY') { key = message.key; return { ok: true }; }
      if (message.type === 'DELETE_API_KEY') { key = undefined; return { ok: true }; }
      if (message.type === 'GET_KEY_STATUS') return { ok: true, configured: !!key };
      return { ok: false, error: { code: 'KEY_NOT_SET' } };
    });
    await context.addInitScript(() => { globalThis.chrome = { runtime: { sendMessage: message => globalThis.fixtureRuntimeMessage(message) } }; });
    await context.route('https://extension.test/**', async route => {
      const filename = new URL(route.request().url()).pathname.split('/').pop();
      const contentType = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html';
      await route.fulfill({ contentType, body: await readFile(resolve(extension, 'options', filename)) });
    });
    optionsUrl = 'https://extension.test/options/index.html';
  }
  await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ja"><head><meta charset="UTF-8"></head><body><main id="feed"><article data-testid="tweet"><div data-testid="tweetText">Tomorrow at 10am PT</div><a href="https://x.com/author/status/1"><time datetime="2026-10-02T02:14:00Z"></time></a></article></main></body></html>' }));
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
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/chrome-light.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/chrome-dark.png', fullPage: true });
  const report = { browser: context.browser()?.version(), date: new Date().toISOString(), result: 'passed', mode: realExtension ? 'real-extension-with-X-fixture' : 'compiled-UI-with-mocked-runtime',
    checks: ['unique JST rendering', 'key save/reload/delete', 'unset-key fallback', 'SPA/additional-post injection', 'copy', 'no key in X DOM', ...(realExtension ? ['MV3 load', 'real content-script storage denial'] : [])],
    limitations: ['X page is a deterministic fixture; live X DOM is not tested.', 'No paid TypeSafe request is made.', ...(!realExtension ? ['Chrome runtime is mocked; MV3 loading and real storage isolation are not verified.'] : [])] };
  await writeFile(`test-results/${realExtension ? 'chrome' : 'browser'}-smoke.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
