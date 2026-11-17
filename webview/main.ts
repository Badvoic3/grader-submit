/*
 * Grader sidebar webview. Plain DOM, no framework.
 *
 * Security: every string that may come from the grader is inserted with
 * textContent / attributes only, never innerHTML. The webview has no network
 * access (CSP default-src 'none'); all actions are postMessage'd to the host.
 */
import './lang'; // first: sets the display language before anything below builds elements
import { applyLook } from './look';
import { W } from '../src/shared/strings';
import { type SectionId, visibleSections } from '../src/shared/layout';
import { el } from './dom';
import { PANEL } from '../src/shared/constants';
import type { ToWebview, ViewState } from '../src/shared/messages';
import { loginPass, loginUser, renderAccount, sAccount, setServerOpen, setShowLoginForm, showLoginForm } from './panel/account';
import { banner, crashBar, promptBar, promptNearSubmit, renderBanner, renderCrash, renderPrompt, revealedPrompt, setRevealedPrompt } from './panel/bars';
import { renderTrophies, sTrophies } from './panel/celebrate';
import { closePicker, openPicker, pickerList, pickerOpen, pickerSearch, renderCurrent, renderPickerList, sCurrent } from './panel/current';
import { renderHistory, sHistory } from './panel/history';
import { lastRowClickAt, problemFilter, problemHits, problemList, renderProblems, sProblems, syncProblemList } from './panel/problems';
import { renderResult, sResult } from './panel/result';
import { app, hooks, saveUi, section, send, setState, state, tooltip, ui } from './panel/shared';
import { legendOpen } from './panel/verdicts';

app.append(banner, crashBar, promptBar, sAccount.details, sCurrent.details, sResult.details, sHistory.details, sProblems.details);
// ---------------------------------------------------------------- wiring


/**
 * Sections re-render only when their own data changed, so the element under
 * the cursor (and its tooltip) isn't recreated by unrelated state pushes
 * (polling, history loading, …).
 */
const lastKeys = new Map<string, string>();
function sectionKeys(s: ViewState): Record<string, string> {
  const j = JSON.stringify;
  const pid = s.problem?.id ?? null;
  return {
    banner: j([s.connection, s.problems.loaded, s.history.items.length > 0]),
    crash: j(s.crash),
    prompt: j([s.prompt, promptNearSubmit(s)]),
    account: j([s.account, s.baseUrl, showLoginForm]),
    current: j([promptNearSubmit(s) ? s.prompt : null, s.notLinked, s.linkedNotice, s.linkedFiles, s.file, s.problem, s.languages, s.submit, s.matching, s.testcases, s.gradingElsewhere, s.folder, s.folderMode, s.attachment, s.runTests, pickerOpen, pickerOpen ? s.problems : s.problems.loaded]),
    result: j([s.result, s.celebrate ?? null, legendOpen === 'result', s.problem?.score.rawSum]),
    trophies: j(s.trophies ?? null),
    history: j([pid, s.history, legendOpen === 'history', s.problem?.score.rawSum]),
    problems: problemsKey(s),
  };
}
function problemsKey(s: ViewState): string {
  return JSON.stringify([{ ...s.problems, items: s.problems.items.length }, problemHits(s).length, ui.filter, s.attachment]);
}

/** Panel layout settings: which sections, in which order, and compact mode. */
let compactOn = false;
let sectionOrderKey = '';
function applyLayout(s: ViewState): void {
  applyLook(s.layout?.look);
  const compact = !!s.layout?.compact;
  if (compact !== compactOn) {
    compactOn = compact;
    document.body.classList.toggle('compact', compact);
    lastKeys.delete('problems');
  }
  // Trophies only while the fun extras are on.
  const order = visibleSections(s.layout?.sections ?? [], s.account.status === 'logged-in').filter((id) => id !== 'trophies' || !!s.trophies);
  const key = order.join(',');
  if (key === sectionOrderKey) return;
  sectionOrderKey = key;
  const all: Record<SectionId, ReturnType<typeof section>> = { account: sAccount, current: sCurrent, result: sResult, history: sHistory, trophies: sTrophies, problems: sProblems };
  for (const [id, sec] of Object.entries(all) as [SectionId, ReturnType<typeof section>][]) {
    sec.details.hidden = !order.includes(id);
    // No line above the first visible section (the hidden banner / prompt come first, so :first-child never matches).
    sec.details.classList.toggle('first-visible', id === order[0]);
  }
  // Move only when the order changed (existing elements are moved, nothing is rebuilt).
  app.append(banner, crashBar, promptBar, ...order.map((id) => all[id].details), ...(Object.keys(all) as SectionId[]).filter((id) => !order.includes(id)).map((id) => all[id].details));
}

function render(): void {
  if (!state) {
    sAccount.body.replaceChildren(el('p', { class: 'muted' }, W.loading));
    return;
  }
  applyLayout(state);
  const active = document.activeElement;
  const pageScroll = document.scrollingElement?.scrollTop ?? 0;
  const keys = sectionKeys(state);
  const renderers: Record<string, (s: ViewState) => void> = {
    banner: renderBanner,
    crash: renderCrash,
    prompt: renderPrompt,
    account: renderAccount,
    current: renderCurrent,
    result: renderResult,
    history: renderHistory,
    trophies: renderTrophies,
    problems: renderProblems,
  };
  for (const [name, fn] of Object.entries(renderers)) {
    if (lastKeys.get(name) === keys[name]) continue;
    lastKeys.set(name, keys[name]);
    fn(state);
  }
  syncProblemList(state);
  // Persistent inputs survive re-render; restore focus if it was on one of them.
  if (active instanceof HTMLInputElement && document.body.contains(active) && document.activeElement !== active) active.focus();
  // A re-render never moves the panel, except to show a new question above Submit.
  if (document.scrollingElement && document.scrollingElement.scrollTop !== pageScroll) document.scrollingElement.scrollTop = pageScroll;
  const nearSubmit = promptNearSubmit(state) ? state.prompt : null;
  if (nearSubmit && revealedPrompt !== nearSubmit.id) document.getElementById('submit-prompt')?.scrollIntoView?.({ block: 'nearest' });
  setRevealedPrompt(nearSubmit?.id ?? null);
  tooltip.refresh();
}

/** Re-render everything (local UI changes such as opening the picker or the legend). */
function forceRender(): void {
  lastKeys.clear();
  render();
}

pickerSearch.addEventListener('input', () => state && renderPickerList(state));
pickerSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    pickerSearch.value = ''; // Escape cancels the search too
    closePicker(true);
  } else if (e.key === 'Enter') {
    pickerList.querySelector<HTMLButtonElement>('.problem-main:not([disabled])')?.click();
  }
});
problemFilter.addEventListener('input', () => {
  ui.filter = problemFilter.value;
  saveUi();
  if (state) {
    renderProblems(state);
    lastKeys.set('problems', problemsKey(state)); // drawn now: the next push needn't draw it again
    problemList.scrollTop = 0; // new search: start at the top of the results
    problemFilter.focus();
  }
});

hooks.render = render;
hooks.forceRender = forceRender;

window.addEventListener('message', (ev: MessageEvent<ToWebview>) => {
  const m = ev.data;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'state') {
    if (state && state.account.status !== 'logged-in' && m.state.account.status === 'logged-in') {
      setShowLoginForm(false);
      setServerOpen(false);
    }
    const prevPid = state?.problem?.id ?? null;
    setState(m.state);
    render();
    const pid = m.state.problem?.id ?? null;
    // The active problem changed because the user opened a file themselves: show its row
    // with a minimal scroll. Never after a click in the list (the list stays where it is).
    if (pid !== null && pid !== prevPid && Date.now() - lastRowClickAt > PANEL.rowClickWindowMs) problemList.revealNearest(String(pid));
  } else if (m.type === 'focus') {
    if (m.target === 'login') {
      setShowLoginForm(true);
      ui.collapsed.account = false;
      sAccount.details.open = true;
      render();
      (loginUser.value ? loginPass : loginUser).focus();
    } else if (m.target === 'problem-search') {
      openPicker();
    } else if (m.target === 'result') {
      // Grading finished: show the Result section without taking keyboard focus from the editor.
      if (sResult.details.hidden) return; // hidden by cedtGrader.panel.sections
      ui.collapsed.result = false;
      sResult.details.open = true;
      sResult.details.scrollIntoView?.({ block: 'nearest' });
    } else if (m.target === 'trophies') {
      if (sTrophies.details.hidden) return; // fun extras off, or hidden by cedtGrader.panel.sections
      ui.collapsed.trophies = false;
      sTrophies.details.open = true;
      saveUi();
      sTrophies.details.scrollIntoView?.({ block: 'nearest' });
    } else {
      document.getElementById('submit-btn')?.focus();
    }
  }
});

render();
send({ type: 'ready' });
