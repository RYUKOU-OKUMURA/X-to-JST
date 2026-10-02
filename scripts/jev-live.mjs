// Optional, explicit, paid verification. Never part of CI or npm run check.
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error('Set TYPESAFE_API_KEY to run one explicit TypeSafe request.');
const temporary = await mkdtemp(resolve(tmpdir(), 'x-to-jst-jev-'));
try {
  const outfile = resolve(temporary, 'adapter.mjs');
  await build({ stdin: { contents: "export { requestJev } from './src/background/jev-client'; export { resolveLocal } from './src/core/resolver';", resolveDir: process.cwd() }, outfile, bundle: true, platform: 'node', format: 'esm' });
  const { requestJev, resolveLocal } = await import(pathToFileURL(outfile).href);
  const tweetText = 'Tomorrow at 10am PST'; const postedAtUtc = '2026-10-02T02:14:00Z';
  const local = resolveLocal({ text: tweetText, postedAtUtc });
  if (local.status !== 'ambiguous') throw new Error('Expected two precomputed candidates.');
  const result = await requestJev({ tweetText, postedAtUtc, expression: local.expression, candidates: local.candidates }, key, AbortSignal.timeout(8_000));
  console.log(JSON.stringify({ result: 'passed', choice: result.choice, confidence: result.confidence }));
} catch { throw new Error('TypeSafe verification failed. Check API access, account/model availability, and the documented contract.'); }
finally { await rm(temporary, { recursive: true, force: true }); }
