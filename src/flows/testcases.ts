import * as vscode from 'vscode';
import { readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Pdfjs, readSampleTables, SampleReadLimitError } from '../data/pdfSamples';
import type { SampleTable } from '../data/sampleTables';
import { stripGraderKey, TestcaseStore } from '../data/testcaseStore';
import { CancelledError, classifyConnectionError, type Problem } from '../grader';
import { problemSubtitle } from '../mapping/match';
import { sampleCasesToImport } from '../mapping/sampleImport';
import type { GraderCase } from '../mapping/testCases';
import type { LoadNotice } from '../shared/messages';
import { S } from '../shared/strings';
import type { Host } from './host';
import { ownerKey } from './runner';

/**
 * Loading test cases for the current problem: the grader's ("Load test cases")
 * and the statement's samples ("Load samples"), both into the runner's list.
 */
export class TestCases {
  busy = false;
  samplesBusy = false;
  /** The cached statement of the current problem is not a PDF (no "Load samples" button). Unknown = false. */
  statementNoPdf = false;
  /** The last Load result and whose list it is about; the Test view shows it while that list is shown. */
  private notice: (LoadNotice & { key: string }) | null = null;
  private noticeSeq = 0;

  constructor(
    private readonly host: Host,
    private readonly store: TestcaseStore,
    /** pdf.js (legacy build, dist/pdfjs) for "Load sample cases": imported on first use only. */
    private readonly pdfjs: () => Promise<Pdfjs>,
  ) {}

  /** The notice for the list the Test view shows (`key`: the runner's owner key). */
  noticeFor(key: string | null): LoadNotice | null {
    if (!this.notice || this.notice.key !== key) return null;
    const { key: _, ...n } = this.notice;
    return n;
  }

  dismissNotice(id: number): void {
    if (this.notice?.id !== id) return;
    this.notice = null;
    this.host.emit();
  }

  /** The notice's button: Open statement, or Download again. */
  async noticeAction(id: number): Promise<void> {
    const n = this.notice;
    if (n?.id !== id || !n.action) return;
    if (n.action === 'openStatement') {
      const p = this.host.currentProblem();
      if (p) await this.host.openStatement(p.id);
    } else await this.loadTestcases(true);
  }

  /** A new Load starts: the last one's notice goes. */
  private clearNotice(): void {
    if (!this.notice) return;
    this.notice = null;
    this.host.emit();
  }

  /**
   * One Load result, said once: in the Test view when it is on screen; otherwise a toast for good news,
   * and inline in the sidebar (a toast when that is hidden) for problems. Returns the toast's button.
   */
  private async say(tone: LoadNotice['tone'], text: string, action: LoadNotice['action'] = null, err: unknown = null): Promise<string | undefined> {
    const h = this.host;
    const owner = h.runner.owner();
    if (h.testsShowing() && owner) {
      this.notice = { id: ++this.noticeSeq, key: ownerKey(owner), tone, text, action };
      h.emit();
      return undefined;
    }
    if (tone === 'warn') {
      await h.tellInline(err, text);
      return undefined;
    }
    return vscode.window.showInformationMessage(text, ...(action === 'downloadAgain' ? [S.testcases.downloadAgain] : []));
  }

  /** The active file changed: what the card needs to know without a request. */
  async onActiveFile(problem: Problem | null): Promise<void> {
    const h = this.host;
    this.statementNoPdf = problem ? (await h.statementStore.cachedKind(problem.id)) === 'other' : false;
  }

  /** "Load samples" is hidden only when the cache says the statement is not a PDF (no request to find out). */
  async refreshStatementKind(): Promise<void> {
    const h = this.host;
    const id = h.problem?.id;
    const noPdf = id ? (await h.statementStore.cachedKind(id)) === 'other' : false;
    if (noPdf === this.statementNoPdf || id !== h.problem?.id) return;
    this.statementNoPdf = noPdf;
    h.emit();
  }

  /**
   * Download the grader's test cases (one at a time, cached in globalStorage)
   * into the runner's list, which they merge with.
   */
  async loadTestcases(refresh = false): Promise<void> {
    const h = this.host;
    const problem = h.currentProblem();
    if (!problem || !h.fileUri || this.busy) return;
    const file = h.folder.runUri() ?? h.fileUri;
    this.clearNotice();
    if (!problem.hasTestcase) {
      void this.say('info', S.testcases.none(problem.name));
      return;
    }
    // Writing test cases for a guess: ask once (yes confirms the link).
    if (!(await h.links.confirmSuggestedFor(h.fileUri, problem, S.testcases.suggestedQ(problem.name, problemSubtitle(problem.name, problem.fullName) ?? ''), S.testcases.load))) return;
    if (!(await h.ensureLoggedIn())) return;
    this.busy = true;
    h.emit();
    // The spinner is for the download only; the questions and the final notification
    // (which stays open until dismissed) come after it.
    const downloaded = () => {
      if (!this.busy) return;
      this.busy = false;
      h.emit();
    };
    try {
      const res = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: S.testcases.progressTitle(problem.name), cancellable: true },
        async (progress, token) => {
          const abort = new AbortController();
          token.onCancellationRequested(() => abort.abort());
          let last = 0;
          return this.store.get(problem.id, {
            refresh,
            signal: abort.signal,
            onProgress: (done, total) => {
              progress.report({ message: S.testcases.downloadProgress(done, total), increment: total ? ((done - last) / total) * 100 : 0 });
              last = done;
            },
          });
        },
      );
      h.connectionOk();
      downloaded();
      if (res.status === 'not-available') {
        void this.say('info', S.testcases.notAllowed(problem.name));
        return;
      }
      const { set } = res;
      const total = set.cases.length + set.truncated.length;
      const programText = await this.programText(file);
      const { cases, key } = stripGraderKey(set.cases, programText);
      const keyNote = key ? S.testcases.keyRemoved : '';
      const pick = await this.intoList(problem, cases, 'grader', (added, kept) => S.testcases.loaded(added, kept, total - set.cases.length) + keyNote, res.fromCache ? 'downloadAgain' : null);
      if (pick === S.testcases.downloadAgain) await this.loadTestcases(true);
    } catch (err) {
      if (err instanceof CancelledError) return; // the user pressed Cancel: nothing to say
      if (classifyConnectionError(err)) h.reportError(err, () => this.loadTestcases(refresh));
      else void this.say('warn', S.testcases.failed(h.describe(err)), null, err);
    } finally {
      downloaded();
    }
  }

  /**
   * "Load sample cases": the example input/output table of the problem's
   * statement PDF, read in the host (src/data/pdfSamples.ts). The PDF comes
   * from the statement cache; when it isn't cached it is fetched once with the
   * same request as opening the statement (and cached).
   */
  async loadSampleCases(): Promise<void> {
    const h = this.host;
    const problem = h.currentProblem();
    if (!problem || !h.fileUri || this.samplesBusy) return;
    this.clearNotice();
    if (!(await h.links.confirmSuggestedFor(h.fileUri, problem, S.samples.suggestedQ(problem.name, problemSubtitle(problem.name, problem.fullName) ?? ''), S.samples.load))) return;
    this.samplesBusy = true;
    h.emit();
    let tables: SampleTable[];
    try {
      let st = await h.statementStore.cached(problem.id);
      if (!st) {
        if (!(await h.ensureLoggedIn())) return;
        st = await h.statementStore.get(problem.id);
        h.connectionOk();
      }
      if (st.kind !== 'pdf') {
        this.statementNoPdf = true; // the button goes away (and stays away for this problem while cached)
        void this.say('warn', S.samples.noPdf, 'openStatement');
        return;
      }
      tables = await readSampleTables(st.bytes, await this.pdfjs());
    } catch (err) {
      if (classifyConnectionError(err)) h.reportError(err, () => this.loadSampleCases());
      else if (err instanceof SampleReadLimitError) void this.say('warn', S.samples.tooLong); // nothing written
      else void this.say('warn', S.samples.failed(h.describe(err)), null, err);
      return;
    } finally {
      this.samplesBusy = false;
      h.emit();
    }
    const found = tables.flatMap((t) => t.cases);
    if (!found.length) {
      void this.say('warn', S.samples.none, 'openStatement');
      return;
    }
    // A sample table with rows that couldn't be read is an incomplete read: load nothing rather than
    // part of the cases. Misread text that still looks like a case
    // can't be detected; the tooltip asks to check the cases.
    const skipped = tables.reduce((n, t) => n + (t.skipped ?? 0), 0);
    if (skipped) {
      void this.say('warn', S.samples.incomplete(skipped), 'openStatement');
      return;
    }
    const annotated = found.filter((c) => c.annotated).length;
    const cases = sampleCasesToImport(found);
    const note = annotated ? S.samples.annotated(annotated) : '';
    try {
      await this.intoList(problem, cases, 'sample', (added, kept) => S.samples.loaded(added, kept) + note, null);
    } catch (err) {
      void this.say('warn', S.samples.failed(h.describe(err)), null, err);
    }
  }

  /** What the key line is checked against: the program, or with no Runs file yet, every file of the folder. */
  private async programText(file: vscode.Uri): Promise<string> {
    const h = this.host;
    const link = h.folder.link;
    const paths = link && !h.folder.runUri() ? (await h.folder.sources(link.fsPath)).map((f) => join(link.fsPath, ...f.split('/'))) : [file.fsPath];
    return (await Promise.all(paths.map((p) => fsReadFile(p, 'utf8').catch(() => '')))).join('\n');
  }

  /** Merge into the problem's list, carrying over cases written before the file was linked. */
  private async intoList(problem: Problem, cases: GraderCase[], source: 'grader' | 'sample', message: (added: number, kept: number) => string, action: LoadNotice['action']): Promise<string | undefined> {
    const h = this.host;
    const { added, kept } = await h.cases.merge(
      problem.id,
      cases.map((c) => ({ input: c.input, expected: c.output, ...(source === 'grader' ? { testcaseId: c.testcaseId } : {}) })),
      source,
    );
    await h.runner.onActiveFile();
    return this.say('ok', message(added, kept), action);
  }
}
