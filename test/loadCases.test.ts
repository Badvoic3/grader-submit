import { beforeEach, describe, expect, it, vi } from 'vitest';

const v = vi.hoisted(() => ({ info: [] as string[], pick: undefined as string | undefined }));

vi.mock('vscode', () => ({
  ProgressLocation: { Notification: 15 },
  commands: { executeCommand: async () => {} },
  workspace: { asRelativePath: (p: string) => p },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  window: {
    withProgress: async (_: unknown, task: (p: unknown, t: unknown) => Promise<unknown>) => task({ report: () => {} }, { onCancellationRequested: () => {} }),
    showInformationMessage: async (msg: string, ...items: string[]) => {
      v.info.push(msg);
      return items.find((i) => i === v.pick);
    },
    showErrorMessage: async (msg: string) => void v.info.push(msg),
  },
}));

import { TestCases } from '../src/flows/testcases';
import { S } from '../src/shared/strings';

const problem = { id: 7, name: 'P', fullName: 'P', hasTestcase: true, source: 'saved' };

describe('Load goes to the runner', () => {
  let merged: unknown[][];
  let store: { get: ReturnType<typeof vi.fn> };
  let moved: number;
  let roleAsked: number;
  let confirm: boolean;
  let showing: boolean;
  let opened: number[];
  const make = (over: Record<string, unknown> = {}) => {
    const host = {
      currentProblem: () => problem,
      fileUri: { fsPath: '/w/a.cpp' },
      folder: { link: null, runUri: () => null, askRole: async () => (roleAsked++, 'main.cpp') },
      links: { confirmSuggestedFor: async () => confirm },
      ensureLoggedIn: async () => true,
      emit: () => {},
      connectionOk: () => {},
      describe: String,
      tellInline: async (_: unknown, m: string) => void v.info.push(m),
      reportError: () => {},
      cases: {
        merge: async (...a: unknown[]) => {
          merged.push(a);
          return { added: 2, kept: 1, file: {} };
        },
      },
      runner: { onActiveFile: async () => void moved++, owner: () => ({ problemId: 7 }) },
      testsShowing: () => showing,
      openStatement: async (id: number) => void opened.push(id),
      statementStore: { cached: async () => ({ kind: 'pdf', bytes: new Uint8Array() }) },
      ...over,
    };
    return new TestCases(host as never, store as never, async () => ({}) as never);
  };

  beforeEach(() => {
    v.info = [];
    v.pick = undefined;
    merged = [];
    moved = 0;
    roleAsked = 0;
    confirm = true;
    showing = false;
    opened = [];
    store = {
      get: vi.fn(async () => ({ status: 'ok', fromCache: false, set: { cases: [{ testcaseId: 11, num: 1, input: '1\n', output: '2\n' }], truncated: [] } })),
    };
  });

  it('grader cases merge into the problem\'s list, and the view reloads', async () => {
    await make().loadTestcases();
    expect(merged).toEqual([[7, [{ input: '1\n', expected: '2\n', testcaseId: 11 }], 'grader']]);
    expect(moved).toBe(1);
    expect(v.info).toEqual([S.testcases.loaded(2, 1, 0)]);
  });

  it('says how many were too large', async () => {
    store.get.mockResolvedValue({ status: 'ok', fromCache: false, set: { cases: [{ testcaseId: 11, num: 1, input: '1\n', output: '2\n' }], truncated: [12, 13] } });
    await make().loadTestcases();
    expect(v.info).toEqual([S.testcases.loaded(2, 1, 2)]);
  });

  it('folder mode: the list belongs to the problem, so Load asks no Runs question', async () => {
    await make({ folder: { link: { fsPath: '/w' }, runUri: () => null, askRole: async () => (roleAsked++, 'x'), sources: async () => [] } }).loadTestcases();
    expect(roleAsked).toBe(0);
    expect(merged).toHaveLength(1);
  });

  it('a suggested problem is confirmed first; No loads nothing', async () => {
    confirm = false;
    await make().loadTestcases();
    expect(store.get).not.toHaveBeenCalled();
    expect(merged).toEqual([]);
  });

  it('Download Again from a cached set fetches once more', async () => {
    store.get.mockResolvedValueOnce({ status: 'ok', fromCache: true, set: { cases: [], truncated: [] } });
    v.pick = S.testcases.downloadAgain;
    await make().loadTestcases();
    expect(store.get).toHaveBeenCalledTimes(2);
    expect(store.get.mock.calls[1][1]).toMatchObject({ refresh: true });
  });

  describe('with the Test view on screen, the result is said there', () => {
    it('loaded: a notice for this list, no toast; another list doesn\'t show it', async () => {
      showing = true;
      const t = make();
      await t.loadTestcases();
      expect(v.info).toEqual([]);
      expect(t.noticeFor('problem:7')).toEqual({ id: 1, tone: 'ok', text: S.testcases.loaded(2, 1, 0), action: null });
      expect(t.noticeFor('problem:8')).toBeNull();
      expect(t.noticeFor(null)).toBeNull();
    });

    it('Dismiss takes it away; the next Load replaces it', async () => {
      showing = true;
      const t = make();
      await t.loadTestcases();
      t.dismissNotice(99); // another notice's id: nothing
      expect(t.noticeFor('problem:7')).not.toBeNull();
      t.dismissNotice(1);
      expect(t.noticeFor('problem:7')).toBeNull();
      await t.loadTestcases();
      expect(t.noticeFor('problem:7')?.id).toBe(2);
    });

    it('from the cache it offers Download again, which fetches once more', async () => {
      showing = true;
      store.get.mockResolvedValueOnce({ status: 'ok', fromCache: true, set: { cases: [], truncated: [] } });
      const t = make();
      await t.loadTestcases();
      const n = t.noticeFor('problem:7')!;
      expect(n.action).toBe('downloadAgain');
      await t.noticeAction(n.id);
      expect(store.get).toHaveBeenCalledTimes(2);
      expect(store.get.mock.calls[1][1]).toMatchObject({ refresh: true });
    });

    it('no sample table: a warning with Open statement, which opens it; nothing goes to the sidebar', async () => {
      showing = true;
      const t = make({ statementStore: { cached: async () => ({ kind: 'pdf', bytes: new Uint8Array() }) } });
      (t as unknown as { pdfjs: () => Promise<unknown> }).pdfjs = async () => ({ getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }), destroy: async () => {} }), GlobalWorkerOptions: {} });
      await t.loadSampleCases();
      const n = t.noticeFor('problem:7');
      expect(n).toMatchObject({ tone: 'warn', action: 'openStatement' });
      expect(v.info).toEqual([]);
      await t.noticeAction(n!.id);
      expect(opened).toEqual([7]);
    });

    it('a problem with no test cases says so there too', async () => {
      showing = true;
      const t = make({ currentProblem: () => ({ ...problem, hasTestcase: false }) });
      await t.loadTestcases();
      expect(t.noticeFor('problem:7')).toMatchObject({ tone: 'info', text: S.testcases.none('P') });
      expect(v.info).toEqual([]);
    });
  });

  it('nothing runs without a problem', async () => {
    await make({ currentProblem: () => null }).loadTestcases();
    expect(store.get).not.toHaveBeenCalled();
  });

  it('a statement that isn\'t a PDF says so, and writes nothing', async () => {
    const t = make({ statementStore: { cached: async () => ({ kind: 'html' }) } });
    await t.loadSampleCases();
    expect(t.statementNoPdf).toBe(true);
    expect(v.info).toEqual([S.samples.noPdf]);
    expect(merged).toEqual([]);
  });
});
