/**
 * The decisions inside the panel's ViewState (GraderController.state()), kept pure so they are tested without
 * VS Code: when Submit is allowed and why not, a problem row, and the note about penalties.
 */
import { type Problem, type ProblemList, problemStatus, summarize } from '../grader';
import { cleanName } from '../mapping/match';
import type { ProblemView } from '../shared/messages';
import { S } from '../shared/strings';

export interface SubmitGateInput {
  busy: boolean;
  hasFile: boolean;
  loggedIn: boolean;
  hasSavedPassword: boolean;
  hasProblem: boolean;
  unavailable: boolean;
  /** The file's language, when the problem doesn't accept it. */
  mismatch: { wanted: string } | null;
  languagesError: string | null;
}

/** Whether Submit can be pressed, and the first reason it can't (shown in its tooltip). */
export function submitGate(s: SubmitGateInput): { enabled: boolean; reason: string | null } {
  let reason: string | null = null;
  if (s.busy) reason = null;
  else if (!s.hasFile) reason = S.submit.openToSubmit;
  else if (!s.loggedIn && !s.hasSavedPassword) reason = S.submit.logInFirst;
  else if (!s.hasProblem) reason = S.submit.chooseProblemForFile;
  else if (s.unavailable) reason = S.submit.unavailable;
  else if (s.mismatch) reason = S.submit.notAccepted(s.mismatch.wanted);
  else if (s.languagesError) reason = s.languagesError;
  const enabled = !s.busy && s.hasFile && s.hasProblem && (s.loggedIn || s.hasSavedPassword) && !s.mismatch && !s.unavailable;
  return { enabled, reason };
}

/** One problem as the panel shows it. `opened`: when each problem was last worked on ("Recently opened"). */
export function problemView(p: Problem, mappedIds: ReadonlySet<number>, opened: Readonly<Record<string, number>>): ProblemView {
  return {
    id: p.id,
    name: cleanName(p.name),
    fullName: cleanName(p.fullName),
    score: summarize(p),
    hasFile: mappedIds.has(p.id),
    hasTestcase: p.hasTestcase,
    hasAttachment: p.hasAttachment,
    status: problemStatus(p),
    tags: p.tags ?? [],
    lastSubmissionTime: p.lastSubmissionTime,
    lastOpened: opened[p.id] ?? null,
  };
}

/** Why the scores carry no penalties, when the list page couldn't be read. */
export function penaltyNote(list: Pick<ProblemList, 'listStatus'> | undefined): string | null {
  if (!list || list.listStatus === 'loaded') return null;
  return list.listStatus === 'no-web-session' ? S.penaltyNote.noWebSession : S.penaltyNote.unreadable;
}
