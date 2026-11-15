/** Fixes from the v1.1.2 review of the files the first src review didn't reach. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { badgeView, scoreBadge, scoreColor } from '../src/mapping/explorerBadge';
import { entryPath, writeExtracted } from '../src/mapping/attachment';
import { remapPath } from '../src/mapping/paths';
import { parseLoginForm } from '../src/grader/providers/cafeGrader/parsers';
import { matchLanguages } from '../src/grader/languages';
import { sanitize } from '../src/shared/crashReport';
import { parseMappingFile } from '../src/migration/oldLinks';

describe('Explorer badge on a raw-sum problem', () => {
  it('is never "full": no ✓ and no solved colour, however high', () => {
    expect(scoreBadge(120, true)).toBe('120');
    expect(scoreColor(120, true)).not.toMatch(/solved/);
    expect(scoreBadge(100, false)).not.toBe('100');
    const p = { id: 7, name: 'sum', fullName: 'sum', tags: [], bestScore: 120, lastScore: 120, submissionCount: 1, lastSubmissionId: 9, list: { cost: 0, rawSum: true } } as never;
    expect(badgeView(p, 'chosen', 'score', true)!.badge).toBe('120');
  });
});

describe('zip entries named with two leading dots', () => {
  it('`..notes.txt` is a name, written like any other', async () => {
    expect(entryPath('..notes.txt')).toBe('..notes.txt');
    const dir = join(mkdtempSync(join(tmpdir(), 'cedt-zip-')), 'out');
    await expect(writeExtracted(dir, [{ rel: '..notes.txt', data: new Uint8Array([1]) }])).resolves.toBeUndefined();
    await expect(writeExtracted(`${dir}2`, [{ rel: '../x.txt', data: new Uint8Array([1]) }])).rejects.toThrow();
  });

  it('an old link\'s submit file `..helpers.h` is kept; `../x.h` is not', () => {
    const d = parseMappingFile(JSON.stringify({ version: 1, files: { pkg: { problemId: 1, name: 'p', baseUrl: 'https://g', folder: true, submitFile: '..helpers.h' }, pkg2: { problemId: 2, name: 'q', baseUrl: 'https://g', folder: true, submitFile: '../x.h' } } }));
    const entries = JSON.stringify(d);
    expect(entries).toContain('..helpers.h');
    expect(entries).not.toContain('../x.h');
  });
});

describe('small parsing and formatting fixes', () => {
  it('remapPath from `/` keeps every segment', () => {
    expect(remapPath('/a/b', '/', '/x', false)).toBe('/x/a/b');
  });

  it('the login form is found also when its action carries a query', () => {
    const html = '<form action="/login/login?locale=th" method="post"><input name="authenticity_token" value="T1"><input type="checkbox" name="agreement"></form>';
    const f = parseLoginForm(html);
    expect(f.present).toBe(true);
    expect(f.token).toBe('T1');
  });

  it('a server extension with a leading dot still matches exactly', () => {
    const langs = [{ id: 1, name: 'Snake', code: 'snake', ext: '.py' }];
    expect(matchLanguages('Python', langs as never)).toHaveLength(1);
  });

  it('a two-letter private term is removed from crash reports', () => {
    expect(sanitize('user nk failed', { terms: ['nk'] })).toBe('user <private> failed');
  });
});
