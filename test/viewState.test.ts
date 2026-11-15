/** The decisions inside the panel's ViewState, without VS Code (src/flows/viewState.ts). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { penaltyNote, problemView, submitGate, type SubmitGateInput } from '../src/flows/viewState';
import { S } from '../src/shared/strings';

const ready: SubmitGateInput = { busy: false, hasFile: true, loggedIn: true, hasSavedPassword: false, hasProblem: true, unavailable: false, mismatch: null, languagesError: null };

describe('submit gate', () => {
  it('is open with a file, a problem and a login (or a saved password)', () => {
    expect(submitGate(ready)).toEqual({ enabled: true, reason: null });
    expect(submitGate({ ...ready, loggedIn: false, hasSavedPassword: true })).toEqual({ enabled: true, reason: null });
  });

  it('gives the first reason it is closed, in order', () => {
    expect(submitGate({ ...ready, hasFile: false, hasProblem: false })).toEqual({ enabled: false, reason: S.submit.openToSubmit });
    expect(submitGate({ ...ready, loggedIn: false, hasProblem: false })).toEqual({ enabled: false, reason: S.submit.logInFirst });
    expect(submitGate({ ...ready, hasProblem: false })).toEqual({ enabled: false, reason: S.submit.chooseProblemForFile });
    expect(submitGate({ ...ready, unavailable: true, mismatch: { wanted: 'Go' } })).toEqual({ enabled: false, reason: S.submit.unavailable });
    expect(submitGate({ ...ready, mismatch: { wanted: 'Go' } })).toEqual({ enabled: false, reason: S.submit.notAccepted('Go') });
  });

  it('while grading: closed, with no reason (the button says it is grading)', () => {
    expect(submitGate({ ...ready, busy: true })).toEqual({ enabled: false, reason: null });
  });

  it('a languages error is said but doesn\'t close it', () => {
    expect(submitGate({ ...ready, languagesError: 'boom' })).toEqual({ enabled: true, reason: 'boom' });
  });
});

describe('problem rows and the penalty note', () => {
  it('a row carries its link, last opened time and a clean name', () => {
    const p = { id: 5, name: 'lab_5 ', fullName: 'Lab 5', tags: ['loops'], bestScore: 40, lastScore: 40, submissionCount: 1, lastSubmissionId: 1, list: null, hasTestcase: true, hasAttachment: false, lastSubmissionTime: null } as never;
    const v = problemView(p, new Set([5]), { 5: 123 });
    expect(v).toMatchObject({ id: 5, hasFile: true, lastOpened: 123, tags: ['loops'], status: 'inprogress' });
    expect(problemView(p, new Set(), {}).lastOpened).toBeNull();
  });

  it('penalties: nothing when the list page was read, otherwise why not', () => {
    expect(penaltyNote(undefined)).toBeNull();
    expect(penaltyNote({ listStatus: 'loaded' })).toBeNull();
    expect(penaltyNote({ listStatus: 'no-web-session' })).toBe(S.penaltyNote.noWebSession);
    expect(penaltyNote({ listStatus: 'failed' })).toBe(S.penaltyNote.unreadable);
  });

  it('has no vscode import', () => {
    expect(readFileSync(join(__dirname, '../src/flows/viewState.ts'), 'utf8')).not.toMatch(/from 'vscode'/);
  });
});
