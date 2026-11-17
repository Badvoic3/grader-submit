import { createHash } from 'node:crypto';
import { RUNNER } from '../shared/constants';
import type { CaseList, CaseRun, CompileFailure, RunnerCase, RunSummary } from './types';

/** One list's run, in memory: after a restart it reads "Not run". */
export interface RunState {
  phase: 'idle' | 'compiling' | 'running';
  runs: Map<string, CaseRun>;
  failure: CompileFailure | null;
  /** Folder mode: files with their own `main()` that weren't compiled. */
  leftOut: string[];
  warnings: string;
  /** What the last run was built from: path key → hash of the file's text. */
  builtFrom: Map<string, string>;
  /** Of those, the files whose text in the editor differs now. Undoing back to the same text takes one out. */
  changed: Set<string>;
  /** Results that the last run didn't replace come from older code (it ran some cases after an edit). */
  olderResults: boolean;
}

export const emptyState = (): RunState => ({ phase: 'idle', runs: new Map(), failure: null, leftOut: [], warnings: '', builtFrom: new Map(), changed: new Set(), olderResults: false });

const textHash = (text: string): string => createHash('sha1').update(text).digest('hex');

/** The results describe code that has changed since. */
export const isEdited = (s: RunState): boolean => s.changed.size > 0 || s.olderResults;

/**
 * A run starts, built from `texts` (path key → text). `replacesAll`: it runs every case that has a result,
 * so nothing older stays; otherwise results kept from before an edit stay marked.
 */
export function startBuild(s: RunState, texts: ReadonlyMap<string, string>, replacesAll: boolean): void {
  s.olderResults = !replacesAll && s.runs.size > 0 && isEdited(s);
  s.builtFrom = new Map([...texts].map(([p, t]) => [p, textHash(t)]));
  s.changed.clear();
}

/** A file's text now (the editor's). Returns true when the results' "edited" mark changed. */
export function noteText(s: RunState, key: string, text: string): boolean {
  const built = s.builtFrom.get(key);
  if (built === undefined) return false;
  const was = isEdited(s);
  if (textHash(text) === built) s.changed.delete(key);
  else s.changed.add(key);
  return was !== isEdited(s);
}

/** The pill: what a list's run says now. Cases added since the last run count as not passed. */
export function summarize(cases: readonly Pick<RunnerCase, 'id'>[], s: RunState): RunSummary {
  if (s.phase === 'compiling') return { kind: 'compiling' };
  const runs = cases.flatMap((c) => s.runs.get(c.id) ?? []);
  if (s.phase === 'running') {
    const active = runs.filter((r) => r.state !== 'stopped');
    return { kind: 'running', done: active.filter((r) => r.state === 'done').length, total: active.length };
  }
  const edited = isEdited(s) ? { edited: true as const } : {};
  if (s.failure) return { kind: 'compile-error', ...edited };
  if (!cases.length) return { kind: 'no-cases' };
  const done = runs.filter((r) => r.state === 'done');
  if (!done.length) return { kind: 'not-run' };
  return { kind: 'done', passed: done.filter((r) => r.verdict === 'AC').length, total: cases.length, ...edited };
}

/** Every case passed: Run tests leaves the split closed. */
export function allPassed(s: RunSummary): boolean {
  return s.kind === 'done' && s.passed === s.total;
}

type Tip = CaseList['sampleTip'];
type Results = ReadonlyMap<string, CaseRun>;

/** Something failed, and every failing case came from the statement's PDF. */
function onlySamplesFail(cases: readonly RunnerCase[], runs: Results): boolean {
  const failing = cases.filter((c) => {
    const r = runs.get(c.id);
    return r?.state === 'done' && r.verdict !== 'AC';
  });
  return failing.length > 0 && failing.every((c) => c.source === 'sample');
}

/** After a run: count runs in a row where only PDF samples fail. */
export function nextSampleTip(tip: Tip, cases: readonly RunnerCase[], runs: Results): NonNullable<Tip> {
  return { dismissed: tip?.dismissed ?? false, failedRuns: onlySamplesFail(cases, runs) ? (tip?.failedRuns ?? 0) + 1 : 0 };
}

/** "PDF samples can be misread": never beside a failing Grader or Custom case. */
export function sampleTipShown(tip: Tip, cases: readonly RunnerCase[], runs: Results): boolean {
  return !tip?.dismissed && (tip?.failedRuns ?? 0) >= RUNNER.sampleTipRuns && onlySamplesFail(cases, runs);
}
