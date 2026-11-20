// @vitest-environment node
/**
 * scripts/fake-grader.mjs (the development grader) through the extension's own GraderClient over real HTTP, so the
 * fake keeps the shapes the extension reads: login, the problem list with its /main/list page (topics, raw sum),
 * statements, attachments, test cases, a submission graded by polling, and the switches tests use.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraderClient } from '../src/grader';
// @ts-expect-error: a plain .mjs script without types
import { startFakeGrader } from '../scripts/fake-grader.mjs';

let g: { url: string; log: string[]; close(): Promise<void> };
// No real waits between polls (the client keeps at least 3 s otherwise).
const client = () => new GraderClient({ baseUrl: g.url, getStoredCredentials: async () => ({ username: 'demo', password: 'demo' }), sleep: async () => {} });

beforeAll(async () => {
  g = await startFakeGrader({ port: 0 });
});
afterAll(async () => g.close());

describe('the development fake grader', () => {
  it('logs in with the password demo and refuses another', async () => {
    await expect(client().login({ username: 'demo', password: 'nope' })).rejects.toThrow();
    const c = client();
    await c.login({ username: 'demo', password: 'demo' });
    expect(c.user?.fullName).toBe('Demo Student');
  });

  it('lists the problems with the list page: topics, raw sum, tags', async () => {
    const c = client();
    await c.login({ username: 'demo', password: 'demo' });
    const list = await c.listProblems({ penalties: true });
    expect(list.listStatus).toBe('loaded');
    expect(list.problems).toHaveLength(27);
    expect(list.topics?.map((t) => t.name)).toEqual(['Recursion', 'Loops']);
    const p1 = list.problems.find((p) => p.id === 41)!;
    expect(p1.name).toBe('hw_double');
    expect(p1.bestScore).toBe(70);
    expect(list.problems.find((p) => p.id === 47)!.list?.rawSum).toBe(true);
    expect(c.contestPage).toBe(false);
  });

  it('serves the statement PDF, a 403, test cases and the zip', async () => {
    const c = client();
    await c.login({ username: 'demo', password: 'demo' });
    const pdf = await c.getStatementPdf(41);
    expect(pdf.status).toBe(200);
    expect(new TextDecoder().decode((pdf as { bytes: Uint8Array }).bytes.slice(0, 5))).toBe('%PDF-');
    expect((await c.getStatementPdf(46)).status).toBe(403);
    const zip = await c.getAttachment(43);
    expect(zip.status).toBe(200);
    expect((zip as { filename: string | null }).filename).toBe('pkg_student.zip');
    const cases = await c.listTestcases(41);
    expect(cases).toHaveLength(4);
    expect((await c.getTestcaseFile(cases![0].id, 'sol')).text).toBe('2\n');
  });

  it('grades a submission by polling: * 2 scores 100, @ fails to compile', async () => {
    const c = client();
    await c.login({ username: 'demo', password: 'demo' });
    const ok = await c.submit(41, 2, 'int main() { int a; cin >> a; cout << a * 2; }', 'hw_double.cpp');
    const done = await c.pollSubmission(ok.id, { intervalMs: 10 });
    expect(done.points).toBe(100);
    const bad = await c.submit(41, 2, '@', 'hw_double.cpp');
    const ce = await c.pollSubmission(bad.id, { intervalMs: 10 });
    expect(ce.compileError).toBe(true);
    expect((await c.listSubmissions(41))[0].id).toBe(bad.id);
  });

  it('switches: an expired token is renewed once, exam mode shows on the list page', async () => {
    const c = client();
    await c.login({ username: 'demo', password: 'demo' });
    await fetch(`${g.url}/__expire`, { method: 'POST' });
    const before = g.log.filter((l) => l === 'POST /api/v1/auth/login').length;
    await c.listSubmissions(41);
    expect(g.log.filter((l) => l === 'POST /api/v1/auth/login').length).toBe(before + 1);
    await fetch(`${g.url}/__exam/on`, { method: 'POST' });
    const d = client();
    await d.login({ username: 'demo', password: 'demo' });
    await d.listProblems({ penalties: true });
    expect(d.contestPage).toBe(true);
    await fetch(`${g.url}/__exam/off`, { method: 'POST' });
  });
});
