/**
 * Network and edge cases from the v1.1.2 review (group B): a body that times out after the headers, Retry-After on
 * downloads, a Windows drive root as the workspace, a damaged test case cache, Cancel, and the after-submit refresh
 * while the panel is hidden.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelledError, GraderClient, NetworkError } from '../src/grader';
import { DataService } from '../src/data/dataService';
import { TestcaseStore } from '../src/data/testcaseStore';
import { isInside, remapPath } from '../src/mapping/paths';
import { noteRecent, rememberNewest } from '../src/shared/lru';
import { FakeGrader } from './fakeServer';

function client(fetch: (input: string, init?: RequestInit) => Promise<Response>, waits: number[] = []) {
  return new GraderClient({
    baseUrl: 'https://grader.test',
    getStoredCredentials: async () => ({ username: 'student', password: 'pw' }),
    fetch: fetch as never,
    sleep: async (ms) => void waits.push(ms),
  });
}

describe('a body that fails after the headers', () => {
  it('is a connection problem (the banner), not "Unexpected error"', async () => {
    const server = new FakeGrader();
    const c = client(async (input, init) => {
      if (new URL(input).pathname === '/api/v1/problems') {
        const body = new ReadableStream({ start: (s) => s.error(Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })) });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return server.fetch(input, init);
    });
    await c.login({ username: 'student', password: 'pw' });
    const err = await c.listProblems().catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).kind).toBe('timeout');
  });
});

describe('downloads honour Retry-After', () => {
  it('the statement PDF waits as long as the server asks', async () => {
    const server = new FakeGrader();
    const waits: number[] = [];
    let busy = 1;
    const c = client(async (input, init) => {
      if (/\/files\/pdf$/.test(new URL(input).pathname) && busy-- > 0) return new Response('', { status: 503, headers: { 'retry-after': '7' } });
      return server.fetch(input, init);
    }, waits);
    await c.login({ username: 'student', password: 'pw' });
    const r = await c.getStatementPdf(201);
    expect(r.status).toBe(200);
    expect(waits).toContain(7000);
  });
});

describe('a Windows drive root as the workspace folder', () => {
  it('has the files on that drive inside it', () => {
    expect(isInside('D:\\a.cpp', 'D:\\', true)).toBe(true);
    expect(isInside('D:\\week1\\a.cpp', 'D:\\', true)).toBe(true);
    expect(isInside('E:\\a.cpp', 'D:\\', true)).toBe(false);
    expect(isInside('D:\\', 'D:\\', true)).toBe(false);
    expect(remapPath('D:\\week1\\a.cpp', 'D:\\', 'E:\\', true)).toBe('E:\\week1\\a.cpp');
  });
});

describe('the test case cache', () => {
  let dir = '';
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('a damaged file is a cache miss, never a crash', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cedt-tc-'));
    const server = new FakeGrader();
    const c = client(server.fetch as never);
    await c.login({ username: 'student', password: 'pw' });
    await mkdir(join(dir, 'testcases', 'grader.test'), { recursive: true });
    await writeFile(join(dir, 'testcases', 'grader.test', '201.json'), '{}');
    const store = new TestcaseStore(dir, () => c);
    const r = await store.get(201);
    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.fromCache).toBe(false);
  });

  it('Cancel stops the download with a CancelledError (shown as nothing)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cedt-tc-'));
    const server = new FakeGrader();
    const c = client(server.fetch as never);
    await c.login({ username: 'student', password: 'pw' });
    const abort = new AbortController();
    abort.abort();
    await expect(new TestcaseStore(dir, () => c).get(201, { signal: abort.signal })).rejects.toBeInstanceOf(CancelledError);
  });
});

describe('the refresh after a submit while the panel is hidden', () => {
  it('runs API-only when the panel shows again (no /main/list)', async () => {
    const server = new FakeGrader();
    const c = client(server.fetch as never);
    await c.login({ username: 'student', password: 'pw' });
    const data = new DataService({ client: () => c, canFetch: () => true });
    data.setVisible(true);
    await data.loadProblems(true);
    data.setVisible(false);
    server.requests = [];
    await data.afterSubmit(201);
    expect(server.requests).toHaveLength(0);
    data.setVisible(true);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(server.count('GET', '/api/v1/problems')).toBe(1);
    expect(server.count('GET', '/main/list')).toBe(0);
  });

  it('a full load already waiting stays full', async () => {
    const server = new FakeGrader();
    const c = client(server.fetch as never);
    await c.login({ username: 'student', password: 'pw' });
    const data = new DataService({ client: () => c, canFetch: () => true });
    await data.loadProblems(true); // hidden: waits as a full load
    await data.afterSubmit(201);
    const list = vi.spyOn(c, 'listProblems');
    data.setVisible(true);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0]?.penalties).not.toBe(false); // with the list page
  });
});

describe('sources kept for open diffs', () => {
  it('keeps the newest few, oldest out first, a repeat moving to the end', () => {
    const m = new Map<number, string>();
    for (const id of [1, 2, 3]) rememberNewest(m, id, `s${id}`, 2);
    expect([...m.keys()]).toEqual([2, 3]);
    rememberNewest(m, 2, 's2b', 2);
    rememberNewest(m, 4, 's4', 2);
    expect([...m.entries()]).toEqual([[2, 's2b'], [4, 's4']]);
  });
});

describe('recently opened', () => {
  it('writes nothing for a re-check of the newest within the resolution; otherwise moves it to the front', () => {
    const all = { 1: 1000, 2: 5000 };
    expect(noteRecent(all, 2, 5000 + 30_000, 60_000, 50)).toBeNull();
    expect(noteRecent(all, 2, 5000 + 61_000, 60_000, 50)).toEqual({ 2: 66_000, 1: 1000 });
    expect(noteRecent(all, 1, 6000, 60_000, 50)).toEqual({ 1: 6000, 2: 5000 }); // not the newest: written
    expect(noteRecent({}, 7, 10, 60_000, 50)).toEqual({ 7: 10 });
    expect(Object.keys(noteRecent({ 1: 1, 2: 2, 3: 3 }, 4, 4, 60_000, 2)!)).toEqual(['3', '4']);
  });
});
