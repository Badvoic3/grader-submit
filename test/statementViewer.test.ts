// @vitest-environment node
/**
 * The statement viewer webview in jsdom, with pdf.js replaced by fakes (esbuild plugin): which PDF wins when two
 * load at once, that a replaced document is destroyed, that closing saves the view at once, and that a failed
 * worker download is tried again by the next statement.
 */
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';

const FAKE_PDFJS = `
  const docs = [];
  const loads = [];
  const params = [];
  globalThis.__pdf = { docs, loads, params };
  export const GlobalWorkerOptions = {};
  // pdf.js 6: a document has no destroy() of its own; its loading task frees it.
  export function getDocument(src) {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    const doc = { tag: new TextDecoder().decode(src.data), numPages: 2, destroyed: false };
    docs.push(doc);
    params.push({ ...src, data: undefined });
    loads.push(() => resolve(doc));
    return { promise, destroy() { doc.destroyed = true; return Promise.resolve(); } };
  }
  export const pdfjsLib = { GlobalWorkerOptions, getDocument };
`;
const FAKE_VIEWER = `
  export class EventBus { constructor() { this.h = {}; } on(n, f) { (this.h[n] ??= []).push(f); } dispatch(n, e) { for (const f of this.h[n] ?? []) f(e); } }
  export class PDFLinkService { setDocument() {} setViewer() {} }
  export class PDFFindController {}
  export class PDFViewer {
    constructor() { this.shown = []; this.currentPageNumber = 1; this.currentScaleValue = 'page-width'; this.pagesCount = 2; globalThis.__viewer = this; }
    setDocument(d) { this.shown.push(d?.tag ?? null); }
  }
`;

let bundle = '';
beforeAll(async () => {
  const out = await build({
    entryPoints: [resolve(__dirname, '../webview/statement.ts')],
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent',
    plugins: [{
      name: 'fake-pdfjs',
      setup(b) {
        b.onResolve({ filter: /pdfjs-global$/ }, () => ({ path: 'pdfjs', namespace: 'fake' }));
        b.onResolve({ filter: /^pdfjs-dist\/legacy\/web\/pdf_viewer\.mjs$/ }, () => ({ path: 'viewer', namespace: 'fake' }));
        b.onLoad({ filter: /^pdfjs$/, namespace: 'fake' }, () => ({ contents: FAKE_PDFJS, loader: 'js' }));
        b.onLoad({ filter: /^viewer$/, namespace: 'fake' }, () => ({ contents: FAKE_VIEWER, loader: 'js' }));
      },
    }],
  });
  bundle = out.outputFiles[0].text;
}, 60_000);

const settle = async (w: Window) => {
  for (let i = 0; i < 10; i++) await new Promise((r) => w.setTimeout(r, 0));
};

function boot(worker: () => Promise<Response>) {
  const dom = new JSDOM('<!DOCTYPE html><html lang="en"><body data-worker="w.js" data-fonts="f/" data-wasm="m/wasm/" data-icc="m/iccs/"><div id="app"></div></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window as unknown as Window & typeof globalThis & { __pdf: { docs: { tag: string; destroyed: boolean }[]; loads: (() => void)[]; params: Record<string, unknown>[] }; __viewer: { shown: (string | null)[] } };
  const sent: { type: string; problemId?: number }[] = [];
  let workerFetches = 0;
  Object.assign(w, {
    acquireVsCodeApi: () => ({ postMessage: (m: { type: string }) => sent.push(m), setState() {}, getState: () => undefined }),
    ResizeObserver: class { observe() {} disconnect() {} },
    Worker: class {},
    fetch: async () => { workerFetches++; return worker(); },
  });
  w.URL.createObjectURL = () => 'blob:x';
  dom.window.eval(bundle);
  const post = (data: unknown) => w.dispatchEvent(new w.MessageEvent('message', { data }));
  const pdf = (problemId: number, tag: string) => post({ type: 'pdf', title: `P${problemId}`, problemId, name: `p${problemId}`, data: new TextEncoder().encode(tag) });
  return { w, sent, pdf, post, workerFetches: () => workerFetches };
}

const ok = async () => new Response('/* worker */', { status: 200 });

describe('statement viewer', () => {
  it('the newest statement wins when an older PDF finishes loading last', async () => {
    const { w, pdf } = boot(ok);
    pdf(1, 'A');
    await settle(w);
    pdf(2, 'B');
    await settle(w);
    const [loadA, loadB] = w.__pdf.loads;
    loadB();
    await settle(w);
    loadA();
    await settle(w);
    expect(w.__viewer.shown).toEqual(['B']);
    expect(w.__pdf.docs[0].destroyed).toBe(true); // A, dropped
    expect(w.__pdf.docs[1].destroyed).toBe(false);
  });

  it('a PDF still loading never replaces a statement shown after it', async () => {
    const { w, pdf, post } = boot(ok);
    pdf(1, 'A');
    await settle(w);
    post({ type: 'html', title: 'P2', problemId: 2, name: 'p2', html: '<p>two</p>' });
    w.__pdf.loads[0]();
    await settle(w);
    expect(w.__viewer?.shown ?? []).toEqual([]);
  });

  it('pdf.js gets the fonts, the image decoders and the colour profiles from the media folder', async () => {
    const { w, pdf } = boot(ok);
    pdf(1, 'A');
    await settle(w);
    expect(w.__pdf.params[0]).toMatchObject({ standardFontDataUrl: 'f/', wasmUrl: 'm/wasm/', iccUrl: 'm/iccs/' });
    expect(w.__pdf.params[0]).not.toHaveProperty('isEvalSupported');
  });

  it('the document it replaces is destroyed', async () => {
    const { w, pdf } = boot(ok);
    pdf(1, 'A');
    await settle(w);
    w.__pdf.loads[0]();
    await settle(w);
    pdf(2, 'B');
    await settle(w);
    w.__pdf.loads[1]();
    await settle(w);
    expect(w.__viewer.shown).toEqual(['A', 'B']);
    expect(w.__pdf.docs.map((d) => d.destroyed)).toEqual([true, false]);
  });

  it('closing the tab saves the view at once', async () => {
    const { w, pdf, sent } = boot(ok);
    pdf(1, 'A');
    await settle(w);
    w.__pdf.loads[0]();
    await settle(w);
    sent.length = 0;
    w.dispatchEvent(new w.Event('beforeunload'));
    expect(sent.some((m) => m.type === 'viewState' && m.problemId === 1)).toBe(true);
  });

  it('a failed worker download is tried again by the next statement', async () => {
    let fail = true;
    const { w, pdf, workerFetches } = boot(async () => (fail ? new Response('', { status: 404 }) : ok()));
    pdf(1, 'A');
    await settle(w);
    expect(w.document.body.textContent).toContain('pdf.js worker: HTTP 404');
    fail = false;
    pdf(1, 'A');
    await settle(w);
    w.__pdf.loads[0]();
    await settle(w);
    expect(workerFetches()).toBe(2);
    expect(w.__viewer.shown).toEqual(['A']);
  });
});
