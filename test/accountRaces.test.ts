/**
 * Work that outlives its account (v1.1.2 review, group A): a login finishing after Log out, a problem list
 * arriving after a switch, a web login the website refused, and Submit pressed twice.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ window: { showInformationMessage: vi.fn() }, ProgressLocation: { Notification: 15 } }));

import { GraderClient, LoginSupersededError, type StoredToken } from '../src/grader';
import { RequestCache } from '../src/data/cache';
import { DataService } from '../src/data/dataService';
import { SubmitFlow } from '../src/flows/submit';
import { FakeGrader } from './fakeServer';

/** A fetch that can hold back one kind of request until released. */
function gated(server: FakeGrader, match: (method: string, path: string) => boolean) {
  let release: () => void = () => {};
  let held: Promise<void> | null = null;
  const hold = () => { held = new Promise<void>((r) => (release = r)); };
  const fetch = async (input: string, init: RequestInit = {}) => {
    const path = new URL(input).pathname;
    if (held && match(init.method ?? 'GET', path)) await held;
    return server.fetch(input, init);
  };
  return { fetch, hold, release: () => { held = null; release(); } };
}

function makeClient(server: FakeGrader, fetch: (input: string, init?: RequestInit) => Promise<Response>) {
  let saved: StoredToken | undefined;
  const creds = { username: 'student', password: 'pw' };
  const client = new GraderClient({
    baseUrl: 'https://grader.test',
    getStoredCredentials: async () => creds,
    tokenStore: { load: async () => saved, save: async (t) => void (saved = t) },
    fetch: fetch as never,
    sleep: async () => {},
  });
  return { client, creds, saved: () => saved };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('a login that finishes after Log out', () => {
  it('saves no token and leaves the client logged out', async () => {
    const server = new FakeGrader();
    const g = gated(server, (m, p) => m === 'POST' && p === '/api/v1/auth/login');
    const { client, creds, saved } = makeClient(server, g.fetch);
    g.hold();
    const login = client.login(creds);
    await settle();
    await client.logout();
    g.release();
    await expect(login).rejects.toBeInstanceOf(LoginSupersededError);
    expect(saved()).toBeUndefined();
    expect(client.isLoggedIn).toBe(false);
  });

  it('a late "wrong password" is dropped, so it can\'t delete the next account\'s saved password', async () => {
    const server = new FakeGrader();
    server.password = 'other';
    const g = gated(server, (m, p) => m === 'POST' && p === '/api/v1/auth/login');
    const { client, creds } = makeClient(server, g.fetch);
    g.hold();
    const login = client.login(creds);
    await settle();
    await client.logout();
    g.release();
    await expect(login).rejects.toBeInstanceOf(LoginSupersededError);
  });

  it('a login started after Log out is not cut short by the old one', async () => {
    const server = new FakeGrader();
    const g = gated(server, (m, p) => m === 'POST' && p === '/api/v1/auth/login');
    const { client, creds, saved } = makeClient(server, g.fetch);
    g.hold();
    const first = client.login(creds);
    await settle();
    await client.logout();
    g.release();
    const second = client.login(creds);
    await expect(first).rejects.toBeInstanceOf(LoginSupersededError);
    await expect(second).resolves.toMatchObject({ login: 'student' });
    expect(client.isLoggedIn).toBe(true);
    expect(saved()?.token).toBeTruthy();
  });
});

describe('a web login the website refused', () => {
  it('is not tried again by the problem list or a refresh, only by the next API login', async () => {
    const server = new FakeGrader();
    let refuse = true;
    const fetch = async (input: string, init: RequestInit = {}) => {
      if (refuse && new URL(input).pathname === '/login/login') {
        const form = Object.fromEntries(new URLSearchParams(String(init.body)));
        return server.fetch(input, { ...init, body: new URLSearchParams({ ...form, password: 'nope' }) });
      }
      return server.fetch(input, init);
    };
    const { client, creds } = makeClient(server, fetch);
    await client.login(creds);
    expect(server.count('POST', '/login/login')).toBe(1);
    const list = await client.listProblems();
    await client.listProblems();
    expect(list.listStatus).toBe('no-web-session');
    expect(server.count('POST', '/login/login')).toBe(1); // never again on its own
    await expect(client.problemLimits(201)).rejects.toThrow();
    expect(server.count('POST', '/login/login')).toBe(1);
    refuse = false;
    await client.logout();
    await client.login(creds); // an API login tries the website once more
    expect(server.count('POST', '/login/login')).toBe(2);
    expect((await client.listProblems()).listStatus).toBe('loaded');
  });
});

describe('work started for the previous account', () => {
  it('a request that started before clear() never fills the cache', async () => {
    const cache = new RequestCache(() => 0);
    let resolve: (v: string) => void = () => {};
    const p = cache.get('problems', { kind: 'session' } as never, () => new Promise<string>((r) => (resolve = r)));
    cache.clear();
    resolve('account A');
    await p;
    expect(cache.peek('problems')).toBeUndefined();
  });

  it('a problem list arriving after the switch is not saved, shown or reported', async () => {
    const server = new FakeGrader();
    const g = gated(server, (m, p) => m === 'GET' && p === '/api/v1/problems');
    const { client, creds } = makeClient(server, g.fetch);
    await client.login(creds);
    const saved = vi.fn();
    const data = new DataService({ client: () => client, canFetch: () => true, persist: { load: () => undefined, save: saved } });
    const loaded = vi.fn(), errors = vi.fn();
    data.onProblemsLoaded = loaded;
    data.onError = errors;
    data.setVisible(true);
    g.hold();
    const load = data.loadProblems(true);
    await settle();
    data.clear(); // the account changed
    g.release();
    expect(await load).toBeUndefined();
    expect(data.problemList()).toBeUndefined();
    expect(saved).not.toHaveBeenCalled();
    expect(loaded).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('a failed load that falls back to the cached list is not treated as a new list', async () => {
    const server = new FakeGrader();
    const { client, creds } = makeClient(server, server.fetch as never);
    await client.login(creds);
    const data = new DataService({ client: () => client, canFetch: () => true });
    data.setVisible(true);
    await data.loadProblems(true);
    const loaded = vi.fn();
    data.onProblemsLoaded = loaded;
    server.networkFailures = 1;
    await data.loadProblems(true);
    expect(loaded).not.toHaveBeenCalled();
  });
});

describe('Submit pressed twice', () => {
  it('the second press does nothing while the first is still checking', async () => {
    let let_go: (ok: boolean) => void = () => {};
    const ensureLoggedIn = vi.fn(() => new Promise<boolean>((r) => (let_go = r)));
    const host = { fileUri: { path: '/a.cpp', fsPath: '/a.cpp', toString: () => 'file:///a.cpp' }, ensureLoggedIn };
    const flow = new SubmitFlow(host as never);
    const first = flow.submit();
    const second = flow.submit();
    await second;
    expect(ensureLoggedIn).toHaveBeenCalledTimes(1);
    let_go(false);
    await first;
    const third = flow.submit(); // the lock is released afterwards
    let_go(false);
    await third;
    expect(ensureLoggedIn).toHaveBeenCalledTimes(2);
  });
});
