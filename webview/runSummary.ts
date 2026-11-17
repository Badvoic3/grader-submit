import type { RunSummary } from '../src/runner/types';
import { W } from '../src/shared/strings';
import { el, icon } from './dom';

type Pill = { text: string; tone: 'quiet' | 'busy' | 'bad' | 'good' };

/** The summary pill, the same in the main panel and the Test view. After an edit it turns grey with a clock, and its tooltip says why. */
export function summaryPill(s: RunSummary): Pill & { edited: boolean } {
  const p = pillOf(s);
  const edited = (s.kind === 'done' || s.kind === 'compile-error') && !!s.edited;
  return edited ? { ...p, tone: 'quiet', edited } : { ...p, edited };
}

/** The pill as a run left it. */
function pillOf(s: RunSummary): Pill {
  switch (s.kind) {
    case 'no-cases':
      return { text: W.runNoCases, tone: 'quiet' };
    case 'not-run':
      return { text: W.runNotRun, tone: 'quiet' };
    case 'compiling':
      return { text: W.runCompiling, tone: 'busy' };
    case 'running':
      return { text: W.runRunning(s.done, s.total), tone: 'busy' };
    case 'compile-error':
      return { text: W.runCompileError, tone: 'bad' };
    case 'done':
      return { text: W.runPassed(s.passed, s.total), tone: s.passed === s.total ? 'good' : 'bad' };
  }
}

/** The pill element: text, and after an edit a clock icon and a tooltip that says why. */
export function pillElement(s: RunSummary): HTMLElement {
  const p = summaryPill(s);
  return p.edited
    ? el('span', { class: 'pill run-pill quiet edited', title: W.runEdited, role: 'img', 'aria-label': `${p.text}. ${W.runEdited}` }, icon('history'), ' ', p.text)
    : el('span', { class: `pill run-pill ${p.tone}` }, p.text);
}
