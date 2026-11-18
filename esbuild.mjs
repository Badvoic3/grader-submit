// Bundles the extension host (dist/extension.js) and the sidebar webview
// (media/dist/webview.js + css + codicons). Usage: node esbuild.mjs [--watch] [--production]
import { context } from 'esbuild';
import { copyFile, cp, mkdir, readFile, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

// Production (the .vsix): start from empty output folders, so no source maps or
// other leftovers of a dev build are packaged (.vscodeignore re-includes all of media/dist).
if (production) {
  await rm('dist', { recursive: true, force: true });
  await rm('media/dist', { recursive: true, force: true });
}

// pdf.js legacy build for "Load sample cases" in the extension host: its library,
// imported at runtime on first use (src/data/pdfSamples.ts), so it never weighs on activation.
// Its worker is the statement viewer's (media/dist/pdfjs, the same legacy build): packed once.
const copyHostPdfjs = {
  name: 'copy-host-pdfjs',
  setup(build) {
    build.onEnd(async () => {
      await mkdir('dist/pdfjs', { recursive: true });
      await copyFile('node_modules/pdfjs-dist/legacy/build/pdf.min.mjs', 'dist/pdfjs/pdf.min.mjs');
      // The grammar engine's regex library for the break tab's colours (src/ui/textmatePaint.ts).
      await copyFile('node_modules/vscode-oniguruma/release/onig.wasm', 'dist/onig.wasm');
    });
  },
};

const copyAssets = {
  name: 'copy-webview-assets',
  setup(build) {
    build.onEnd(async () => {
      await mkdir('media/dist', { recursive: true });
      await copyFile('node_modules/@vscode/codicons/dist/codicon.css', 'media/dist/codicon.css');
      await copyFile('node_modules/@vscode/codicons/dist/codicon.ttf', 'media/dist/codicon.ttf');
      await copyFile('webview/style.css', 'media/dist/webview.css');
      await copyFile('webview/statement.css', 'media/dist/statement.css');
      await copyFile('webview/tests.css', 'media/dist/tests.css');
      await copyFile('webview/break.css', 'media/dist/break.css');
      // pdf.js assets for the statement viewer (bundled; never loaded from a CDN). The legacy build,
      // like the host's: this worker also serves "Load sample cases" (src/data/pdfSamples.ts).
      const pdfjs = 'node_modules/pdfjs-dist';
      await mkdir('media/dist/pdfjs', { recursive: true });
      await copyFile(`${pdfjs}/legacy/build/pdf.worker.min.mjs`, 'media/dist/pdfjs/pdf.worker.min.mjs');
      await copyFile(`${pdfjs}/legacy/web/pdf_viewer.css`, 'media/dist/pdfjs/pdf_viewer.css');
      // Only the icons pdf_viewer.css uses (pdf.js 6 ships 83, the stylesheet names 32).
      await mkdir('media/dist/pdfjs/images', { recursive: true });
      const css = await readFile(`${pdfjs}/legacy/web/pdf_viewer.css`, 'utf8');
      for (const name of new Set([...css.matchAll(/images\/([\w.-]+)/g)].map((m) => m[1]))) {
        await copyFile(`${pdfjs}/legacy/web/images/${name}`, `media/dist/pdfjs/images/${name}`);
      }
      // No CMaps (pdf.js character maps, ~1 MB): only PDFs with non-embedded CJK fonts need them; course
      // statements embed their fonts (decided 2026-11-04).
      await cp(`${pdfjs}/standard_fonts`, 'media/dist/pdfjs/standard_fonts', { recursive: true });
      // pdf.js 6 decodes JPEG 2000 and JBIG2 images and ICC colours with WebAssembly (the statement viewer's
      // wasmUrl / iccUrl). Not packed: the no-WebAssembly fallbacks and quickjs (PDF scripting, never enabled).
      await mkdir('media/dist/pdfjs/wasm', { recursive: true });
      for (const f of ['openjpeg.wasm', 'jbig2.wasm', 'qcms_bg.wasm', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_JBIG2', 'LICENSE_PDFJS_JBIG2', 'LICENSE_QCMS', 'LICENSE_PDFJS_QCMS']) {
        await copyFile(`${pdfjs}/wasm/${f}`, `media/dist/pdfjs/wasm/${f}`);
      }
      await cp(`${pdfjs}/iccs`, 'media/dist/pdfjs/iccs', { recursive: true });
    });
  },
};

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info',
};

const host = await context({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  // Node reads the bundle as UTF-8: keep the Thai texts as they are (\uXXXX escapes made it 60 KB larger).
  charset: 'utf8',
  plugins: [copyHostPdfjs],
});

const webview = await context({
  ...common,
  entryPoints: ['webview/main.ts'],
  outfile: 'media/dist/webview.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  // Thai as it is, not \uXXXX escapes (about 48 KB less): the page declares <meta charset="UTF-8">, and a classic
  // script with no charset of its own is decoded with the page's encoding.
  charset: 'utf8',
  plugins: [copyAssets],
});

const statement = await context({
  ...common,
  entryPoints: ['webview/statement.ts'],
  outfile: 'media/dist/statement.js',
  platform: 'browser',
  format: 'esm',
  // A module script is always decoded as UTF-8.
  charset: 'utf8',
  target: 'es2022',
});

const tests = await context({
  ...common,
  entryPoints: ['webview/tests.ts'],
  outfile: 'media/dist/tests.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  charset: 'utf8', // as the sidebar's: the page is UTF-8
});

// The break tab (src/ui/breakPanel.ts).
const breakTab = await context({
  ...common,
  entryPoints: ['webview/break/main.ts'],
  outfile: 'media/dist/break.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
});

const all = [host, webview, statement, tests, breakTab];
if (watch) {
  await Promise.all(all.map((c) => c.watch()));
} else {
  await Promise.all(all.map((c) => c.rebuild()));
  await Promise.all(all.map((c) => c.dispose()));
}
