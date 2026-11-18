// @vitest-environment node
/**
 * The webviews switch language with `setWebLanguage`, which covers only `W`, `W_SOURCE`, `HOW_LINKED` and `G`.
 * So no webview may read the host's own tables (`S`, `PICK_HOW`, `MATCH_SOURCE`): one that did would stay English
 * in Thai, and carry every host text in its bundle. Each webview is built here (production settings, in memory)
 * and searched for those texts, in English and in Thai.
 */
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage, setWebLanguage } from '../src/shared/i18n';
import { EN, G, S, W } from '../src/shared/strings';
import { TH } from '../src/shared/strings.th';

const ENTRIES = ['webview/main.ts', 'webview/tests.ts', 'webview/statement.ts', 'webview/break/main.ts'];

/** Every plain text of a table (functions are skipped: their text is built at call time). */
const leaves = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(leaves) : []);
const shared = new Set([...leaves(EN.W), ...leaves(EN.W_SOURCE), ...leaves(EN.HOW_LINKED), ...leaves(EN.G), ...leaves(TH.W), ...leaves(TH.W_SOURCE), ...leaves(TH.HOW_LINKED), ...leaves(TH.G)]);
/** Host-only texts long enough not to occur by chance, and not inside any text a webview table has. */
const hostOnly = [EN.S, EN.PICK_HOW, EN.MATCH_SOURCE, TH.S, TH.PICK_HOW, TH.MATCH_SOURCE].flatMap(leaves).filter((t) => t.length >= 20 && !/^\$\(/.test(t) && ![...shared].some((w) => w.includes(t)));

const bundles: Record<string, string> = {};
beforeAll(async () => {
  for (const e of ENTRIES) {
    const out = await build({ entryPoints: [resolve(__dirname, '..', e)], bundle: true, minify: true, write: false, charset: 'utf8', format: e.endsWith('statement.ts') ? 'esm' : 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent', external: ['*.mjs'] });
    bundles[e] = out.outputFiles[0].text;
  }
}, 120_000);

describe('webview bundles hold only the texts the webviews show', () => {
  it('no host-only text, English or Thai', () => {
    expect(hostOnly.length).toBeGreaterThan(100);
    for (const [e, js] of Object.entries(bundles)) expect(hostOnly.filter((t) => js.includes(t)), e).toEqual([]);
  });

  it('the sidebar still carries its own texts in both languages', () => {
    expect(bundles['webview/main.ts']).toContain(EN.W.sectionCurrent);
    expect(bundles['webview/main.ts']).toContain(TH.W.sectionCurrent);
    expect(bundles['webview/main.ts']).toContain(TH.G.rawSumTip);
  });
});

describe('setWebLanguage', () => {
  it('switches the webview tables, and dates follow', async () => {
    const { dateLocale } = await import('../src/shared/i18n');
    setWebLanguage('th');
    expect(W.sectionCurrent).toBe(TH.W.sectionCurrent);
    expect(G.rawSumTip).toBe(TH.G.rawSumTip);
    expect(dateLocale()).toBe('th-TH-u-ca-gregory');
    setWebLanguage('en');
    expect(W.sectionCurrent).toBe(EN.W.sectionCurrent);
    expect(dateLocale()).toBeUndefined();
    setLanguage('en');
    expect(S.runner.noFile).toBe(EN.S.runner.noFile);
  });
});
