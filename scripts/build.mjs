import { context, build } from 'esbuild';
import { mkdir, copyFile, rm, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = {
  absWorkingDir: root,
  entryPoints: { content: 'src/content/index.ts', background: 'src/background/index.ts', 'options/index': 'src/options/index.ts' },
  outdir: 'dist', bundle: true, format: 'iife', target: 'chrome120',
  sourcemap: false, legalComments: 'none', minify: true,
  plugins: [{ name: 'static-files', setup(api) {
    api.onLoad({ filter: /index\.ts$/ }, async args => {
      if (args.path !== resolve(root, 'src/options/index.ts')) return;
      return { contents: await readFile(args.path, 'utf8'), loader: 'ts',
        watchFiles: ['manifest.json', 'src/options/index.html', 'src/options/options.css'].map(file => resolve(root, file)) };
    });
    api.onEnd(copyStatic);
  } }],
};
async function copyStatic() {
  await mkdir(resolve(root, 'dist/options'), { recursive: true });
  await copyFile(resolve(root, 'manifest.json'), resolve(root, 'dist/manifest.json'));
  for (const file of ['index.html', 'options.css']) await copyFile(resolve(root, `src/options/${file}`), resolve(root, `dist/options/${file}`));
}
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await copyStatic();
if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching source files. Reload the extension and X after changes.');
} else await build(options);
