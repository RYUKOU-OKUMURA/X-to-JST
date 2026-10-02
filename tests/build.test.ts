import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, access } from 'node:fs/promises';
import { expect, it } from 'vitest';
it('builds a complete local Manifest V3 extension with only necessary permissions', async () => {
  await promisify(execFile)(process.execPath, ['scripts/build.mjs']);
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  expect(manifest.manifest_version).toBe(3); expect(manifest.permissions).toEqual(['storage']);
  await Promise.all([manifest.background.service_worker, manifest.options_ui.page, ...manifest.content_scripts.flatMap((s: { js: string[] }) => s.js), 'options/index.js', 'options/options.css'].map(file => access(`dist/${file}`)));
  const content = await readFile('dist/content.js', 'utf8');
  expect(content).not.toContain('Bearer'); expect(content).not.toContain('api.typesafe.ai');
});
