/** Sidebar webview. The Current problem section: problem picker, header icons, score card, folder roles, Run tests row, Submit. Grader text goes in through textContent / attributes only (see main.ts). */
import '../lang'; // first: the display language is set before any element is built
import { HOW_LINKED, W, W_SOURCE } from '../../src/shared/strings';
import { scoreText } from '../../src/grader/score';
import { appendChildren, el, icon } from '../dom';
import { pillElement } from '../runSummary';
import { matches } from '../filters';
import type { ScoreView, ViewState } from '../../src/shared/messages';
import { fillPrompt, promptNearSubmit } from './bars';
import { problemRow } from './problems';
import { MenuItem, button, fmt, hooks, iconButton, outOf, scoreClass, section, send, state, titleParts, ui, withContextMenu } from './shared';

export const pickerSearch = el('input', { type: 'search', class: 'picker-search', placeholder: W.searchPlaceholder, 'aria-label': W.searchProblems, spellcheck: 'false' });
export const pickerList = el('div', { class: 'picker-list', role: 'listbox' });
// One persistent container: typing only re-renders the list, never moves the search box.
export const pickerBox = el('div', { class: 'picker' }, pickerSearch, pickerList);
export let pickerOpen = false;
export const setPickerOpen = (v: boolean) => { pickerOpen = v; };

export const sCurrent = section('current', W.sectionCurrent);
export function openPicker(): void {
  pickerOpen = true;
  if (state && !state.problems.loaded && !state.problems.loading) send({ type: 'refreshProblems' });
  ui.collapsed.current = false;
  sCurrent.details.open = true;
  hooks.render();
  pickerSearch.focus();
}

export function closePicker(refocus = false): void {
  pickerOpen = false;
  hooks.render();
  // The search box is gone: the keyboard goes back to the button that opened the list.
  if (refocus) (sCurrent.body.querySelector<HTMLElement>('.combo') ?? sCurrent.body.querySelector<HTMLElement>('button'))?.focus();
}

export function renderPickerList(s: ViewState): void {
  const q = pickerSearch.value.trim().toLowerCase();
  const hits = s.problems.items.filter((p) => matches(p, q));
  pickerList.replaceChildren();
  if (!s.problems.loaded) {
    appendChildren(pickerList, [
      el('div', { class: 'muted pad' }, s.problems.loading ? W.loadingProblems : W.problemListNotLoaded),
      !s.problems.loading && button(W.loadProblems, () => send({ type: 'refreshProblems' })),
    ]);
  } else if (hits.length === 0) {
    pickerList.append(el('div', { class: 'muted pad' }, W.noMatchingProblems));
  } else {
    const top = !q ? (s.matching.ambiguous ?? s.matching.suggestions) : [];
    if (top.length) {
      pickerList.append(el('div', { class: 'picker-group muted small' }, s.matching.ambiguous ? W.matchesForThisFile : W.suggestedForThisFile));
      for (const p of top) pickerList.append(problemRow(p, s, 'picker'));
      pickerList.append(el('div', { class: 'picker-group muted small' }, W.allProblems));
    }
    for (const p of hits) pickerList.append(problemRow(p, s, 'picker'));
  }
}

export function scoreCard(sc: ScoreView): HTMLElement {
  const card = el('div', { class: 'score-card' },
    el('div', { class: 'row score-row' },
      el('span', { class: 'muted small', title: sc.source === 'problem-list' ? `${W.countedScore} · ${W.penaltiesFromListTip}` : undefined }, W.countedScore),
      el('span', { class: 'grow' }),
      sc.source === 'problem-list' ? el('span', { class: 'muted small', title: W.penaltiesFromListTip }, W.fromProblemList) : null,
    ),
    (() => {
      const t = scoreText(sc.counted, sc.rawSum);
      return el('div', { class: `score ${scoreClass(sc.counted, sc.rawSum, outOf(sc))}`, title: (sc.counted === null ? W.notAttemptedYet : t.tip) ?? undefined }, sc.counted === null ? fmt(null) : t.text);
    })(),
    el('div', { class: 'score-facts small' },
      el('span', {}, W.best, ' ', el('strong', {}, fmt(sc.best))),
      el('span', {}, W.latest, ' ', el('strong', {}, fmt(sc.latest))),
      el('span', {}, W.attempts, ' ', el('strong', {}, String(sc.attempts))),
      sc.penaltyLabel ? el('span', { class: 'penalty' }, sc.penaltyLabel) : null,
      sc.rawSum ? el('span', { class: 'muted' }, W.rawSumScoring) : null,
    ),
  );
  if (sc.latestBelowCounted && sc.latest !== null && sc.counted !== null) {
    card.append(el('p', { class: 'hint' }, icon('info'), ' ', W.latestBelowBest(fmt(sc.latest), fmt(sc.counted))));
  }
  return card;
}

/** Run tests with its summary, then Open tests: for any open file, linked to a problem or not. */
export function runRows(r: NonNullable<ViewState['runTests']>): HTMLElement {
  const reason = r.running ? null : r.disabledReason;
  return el('div', { class: 'run-rows' },
    el('div', { class: 'row' },
      r.running
        ? button([icon('debug-stop'), ` ${W.stopTests}`], () => send({ type: 'stopTests' }), { title: W.stopTestsTip })
        : button([icon('play', 'run-icon'), ` ${W.runTests}`], () => send({ type: 'runTests' }), { disabled: !!reason, title: reason ? `${W.runTestsTip} (${reason})` : W.runTestsTip }),
      pillElement(r.summary),
    ),
    button([icon('beaker'), ` ${r.testsOpen ? W.closeTests : W.openTests}`], () => send({ type: 'openTests' }), { title: r.testsOpen ? W.closeTests : W.openTestsTip }),
  );
}

export function renderCurrent(s: ViewState): void {
  const b = sCurrent.body;
  b.replaceChildren();
  if (!s.file) {
    b.append(el('p', { class: 'muted' }, icon('file'), ' ', W.openFileToSubmit));
    return;
  }
  b.append(
    el('div', { class: 'row file', title: s.file.path },
      icon(s.file.supported ? 'file-code' : 'file'),
      el('span', { class: 'grow ellipsis' }, s.file.name),
      el('span', { class: 'muted small' }, s.file.languageGuess ?? W.unknownType),
    ),
  );

  const p = s.problem;
  const combo = el(
    'button',
    {
      class: 'combo',
      type: 'button',
      'aria-expanded': String(pickerOpen),
      title: p ? W.changeProblemTip(p.name, p.id) : W.chooseProblem,
      onclick: () => (pickerOpen ? closePicker() : openPicker()),
    },
    p
      ? el('span', { class: 'grow combo-text' },
          el('span', { class: 'ellipsis' }, el('strong', {}, p.name), el('span', { class: 'muted' }, ` #${p.id}`)),
          titleParts(p).subtitle ? el('span', { class: 'ellipsis muted small' }, titleParts(p).subtitle!) : null,
        )
      : el('span', { class: 'grow muted' }, W.chooseProblemEllipsis),
    icon(pickerOpen ? 'chevron-up' : 'chevron-down'),
  );
  b.append(
    withContextMenu(el('div', { class: 'field problem-field' },
      el('div', { class: 'field-label' }, W.problem,
        el('span', { class: 'grow' }),
        // All actions visible (as before the "…" menu); right-click offers the same.
        p ? iconButton('file-pdf', W.openStatement, () => send({ type: 'openStatement', problemId: p.id })) : null,
        p ? iconButton('copy', W.copyProblemName, () => send({ type: 'copyName', problemId: p.id })) : null,
        p ? iconButton('globe', W.openOnTheGraderWebsite, () => send({ type: 'openProblemInBrowser', problemId: p.id })) : null,
        // The website's "File": a template file or a zip package (only problems that have one).
        p?.hasAttachment
          ? iconButton('cloud-download', W.downloadAttachment, () => send({ type: 'downloadAttachment', problemId: p.id }), { disabledReason: s.attachment.busy === p.id ? W.downloading : null })
          : null,
        // Also with no problem yet: the picker opens and the folder is linked to the choice.
        s.folderMode
          ? iconButton(s.folderMode.on ? 'file' : 'folder', s.folderMode.on ? W.linkOnlyFile : W.linkFolder, () => send({ type: 'toggleFolderMode' }), { disabledReason: s.folderMode.disabledReason })
          : null,
        iconButton('sparkle', W.autoDetectTip, () => send({ type: 'autoDetect' })),
        // Every state: a chosen link is unlinked; a name match or a suggestion becomes "not linked".
        p ? iconButton('close', unlinkLabel(p, s, true), () => send({ type: 'unmapProblem' })) : null,
      ),
      combo,
      pickerOpen ? (renderPickerList(s), pickerBox) : null,
      p ? (s.folder && !s.folder.matched ? folderLine(s.folder) : sourceLine(p.source, p.id, p.name)) : null,
      p && s.file?.renameTo
        ? el('div', { class: 'row source-line small muted' },
            icon('edit'),
            el('button', { class: 'link small', type: 'button', title: W.renameToProblemTip(s.file.name, s.file.renameTo), onclick: () => send({ type: 'renameFileToProblem' }) }, W.renameToProblem),
          )
        : null,
      !p && s.notLinked
        ? el('div', { class: 'notice' },
            el('div', { class: 'row' }, icon('debug-disconnect'), el('span', { class: 'grow' }, W.notLinkedToAProblem)),
            el('div', { class: 'row gap' },
              button(W.chooseProblem, () => openPicker(), { kind: 'primary', title: W.chooseProblemTip }),
              button(W.autoDetect, () => send({ type: 'autoDetect' }), { title: W.autoDetectAgainTip }),
            ),
          )
        : null,
      p?.unavailable
        ? el('div', { class: 'notice warn', role: 'alert' },
            el('div', { class: 'row' }, icon('warning'), el('span', { class: 'grow' }, W.problemUnavailableMsg)),
            el('div', { class: 'row gap' },
              button(W.changeProblem, () => openPicker(), { title: W.changeProblemTitle }),
              button(W.removeLink, () => send({ type: 'unmapProblem' }), { title: W.removeLinkTip }),
            ),
          )
        : null,
      s.matching.note ? el('p', { class: 'hint' }, icon('info'), ' ', s.matching.note) : null,
      s.linkedFiles.length > 1 ? linkedFilesNotice(s) : null,
    ), () => headerMenuItems(p)),
  );

  if (p) {
    b.append(scoreCard(p.score));
    const L = s.languages;
    const select = el('select', {
      id: 'lang',
      disabled: L.loading || L.items.length <= 1,
      title: L.loading ? W.loadingLanguages : L.items.length <= 1 ? W.oneLanguageOnly : W.languageTip,
      onchange: (e: Event) => send({ type: 'selectLanguage', languageId: Number((e.target as HTMLSelectElement).value) }),
    });
    if (L.items.length === 0) select.append(el('option', {}, L.loading ? W.loading : '—'));
    if (L.selectedId === null && L.items.length) select.append(el('option', { value: '', selected: true, disabled: true }, W.chooseLanguage));
    for (const l of L.items) select.append(el('option', { value: l.id, selected: l.id === L.selectedId }, l.name));
    b.append(el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'lang' }, W.language), select));
    // Folder mode: which file Submit sends (the grader takes one file) and which program the tests run.
    if (s.folder) {
      const F = s.folder;
      b.append(
        rolePicker('submit-file', W.submits, 'submit', F.submitFile, F.submitChosen, F.submitWhy, F.candidates, W.submitFileAsk, W.submitFileTip),
        rolePicker('run-file', W.runs, 'run', F.runFile, F.runChosen, F.runWhy, F.runCandidates, W.runFileAsk, W.runFileTip),
        el('p', { class: 'small muted' }, W.submitFileTip),
      );
    }
  }

  const mm = p ? s.languages.mismatch : null;
  if (mm) {
    b.append(
      el('div', { class: 'notice warn', role: 'status' },
        el('div', { class: 'row' },
          icon('warning'),
          el('span', { class: 'grow' }, W.languageNotAccepted(mm.wanted)),
          button(W.change, () => openPicker()),
        ),
        el('p', { class: 'small muted' }, W.acceptedLanguages(mm.allowed.join(', '))),
      ),
    );
  }

  if (promptNearSubmit(s) && s.prompt) {
    const box = el('div', { id: 'submit-prompt', role: 'status' });
    fillPrompt(box, s.prompt);
    b.append(box);
    sCurrent.details.open = true;
  }

  if (s.runTests) b.append(runRows(s.runTests));

  const sub = s.submit;
  b.append(
    el('button', { class: 'btn big', type: 'button', id: 'submit-btn', disabled: !sub.enabled, title: sub.reason ?? undefined, onclick: () => send({ type: 'submit' }), 'aria-describedby': sub.reason ? 'submit-reason' : undefined },
      sub.busy ? icon('loading', 'codicon-modifier-spin') : icon('cloud-upload'),
      ` ${sub.busy ? W.grading : sub.label}`,
    ),
  );
  if (s.gradingElsewhere) b.append(el('p', { class: 'hint' }, icon('loading', 'codicon-modifier-spin'), ' ', W.gradingOtherFile(s.gradingElsewhere)));
  // One message: the mismatch notice already explains a disabled Submit.
  if (sub.reason && !mm) b.append(el('p', { class: 'hint', id: 'submit-reason' }, icon('info'), ' ', sub.reason));
}

/** Right-click on the problem header: the same actions as its icons. */
export function headerMenuItems(p: ViewState['problem']): MenuItem[] {
  return [
    ...(p
      ? [
          { icon: 'file-pdf', label: W.openStatement, onclick: () => send({ type: 'openStatement', problemId: p.id }) },
          { icon: 'copy', label: W.copyProblemName, onclick: () => send({ type: 'copyName', problemId: p.id }) },
          { icon: 'globe', label: W.openOnTheGraderWebsite, onclick: () => send({ type: 'openProblemInBrowser', problemId: p.id }) },
        ]
      : []),
    ...(p?.hasAttachment
      ? [{ icon: 'cloud-download', label: W.downloadAttachment, onclick: () => send({ type: 'downloadAttachment', problemId: p.id }), disabledReason: state?.attachment.busy === p.id ? W.downloading : null }]
      : []),
    ...(state?.folderMode
      ? [{
          icon: state.folderMode.on ? 'file' : 'folder',
          label: state.folderMode.on ? W.linkOnlyFile : W.linkFolder,
          tip: state.folderMode.on ? undefined : W.linkFolderTip,
          onclick: () => send({ type: 'toggleFolderMode' }),
          disabledReason: state.folderMode.disabledReason,
        }]
      : []),
    { icon: 'sparkle', label: W.autoDetectTip, onclick: () => send({ type: 'autoDetect' }) },
    ...(p && state?.file?.renameTo ? [{ icon: 'edit', label: W.renameToProblem, tip: W.renameToProblemTip(state.file.name, state.file.renameTo), onclick: () => send({ type: 'renameFileToProblem' }) }] : []),
    ...(p && state
      ? [{ icon: 'close', label: unlinkLabel(p, state, false), tip: W.autoDetectWontRelink, onclick: () => send({ type: 'unmapProblem' }) }]
      : []),
  ];
}

/** ✕: "Unlink this file / folder" for a link, "Don't match this file / folder" for a match. */
export function unlinkLabel(p: NonNullable<ViewState['problem']>, s: ViewState, long: boolean): string {
  if (s.folder && !s.folder.matched) return long ? W.unlinkThisFolderTip : W.unlinkThisFolder;
  if (p.source === 'folder') return long ? W.dontMatchThisFolderTip : W.dontMatchThisFolder;
  if (p.source === 'saved') return long ? W.unlinkThisFileTip : W.unlinkThisFile;
  return long ? W.dontMatchThisFileTip : W.dontMatchThisFile;
}

export let linkedOpen = false;
export const HOW_TEXT: Record<string, string> = HOW_LINKED;
export function linkedFilesNotice(s: ViewState): HTMLElement {
  const box = el('div', { class: 'notice linked' });
  box.append(
    el('div', { class: 'row' },
      icon('files'),
      el('span', { class: 'grow small' }, s.linkedNotice ?? W.nFilesLinked(s.linkedFiles.length)),
      el('button', { class: 'link small', type: 'button', 'aria-expanded': String(linkedOpen), title: linkedOpen ? W.hideTheList : W.showTheFiles, onclick: () => { linkedOpen = !linkedOpen; hooks.forceRender(); } }, linkedOpen ? W.hide : W.show),
      el('button', { class: 'link small', type: 'button', title: W.dismissNoticeTip, onclick: () => send({ type: 'dismissLinkedNotice' }) }, W.dismiss),
    ),
  );
  if (linkedOpen) {
    box.append(
      el('div', { class: 'linked-list' },
        // Rows keep their order and height; only the "this file" mark moves.
        ...s.linkedFiles.map((f, i) => {
          const hide = (b: HTMLElement) => {
            if (f.current) {
              b.classList.add('invisible');
              b.setAttribute('aria-hidden', 'true');
              b.tabIndex = -1;
            }
            return b;
          };
          return el('div', { class: `linked-row${f.current ? ' current' : ''}`, 'aria-current': f.current ? 'true' : undefined },
            el('div', { class: 'row' },
              icon(f.current ? 'circle-filled' : f.path.endsWith('/') ? 'folder' : 'file'),
              el('span', { class: 'grow ellipsis', title: f.path }, f.path),
            ),
            el('div', { class: 'row gap small' },
              el('span', { class: 'muted grow' }, f.current ? W.thisFile(HOW_TEXT[f.how]) : HOW_TEXT[f.how]),
              hide(button(W.open, () => send({ type: 'openLinkedFile', index: i }), { title: W.openPath(f.path) })),
              hide(
                f.how === 'chosen'
                  ? button(W.unlink, () => send({ type: 'unlinkLinkedFile', index: i }), { title: W.unlinkFileTip(f.path) })
                  : button(W.dontMatchThisFile, () => send({ type: 'unlinkLinkedFile', index: i }), { title: W.dontMatchFileTip(f.path) }),
              ),
            ),
          );
        }),
      ),
      el('div', { class: 'row gap' }, button(W.unlinkTheOtherFiles, () => send({ type: 'keepOnlyThisFile' }), { title: W.unlinkOthersTip })),
    );
  }
  return box;
}

export const SOURCE_ICON: Record<string, string> = { saved: 'pinned', filename: 'file', folder: 'folder', suggested: 'lightbulb' };
export const SOURCE_TEXT: Record<string, string> = W_SOURCE;

/** "How matched" line under the problem selector (text, not icon-only). Only "Suggested" stands out, with Confirm. */
export function sourceLine(source: string, problemId: number, name: string): HTMLElement {
  if (source === 'suggested') {
    return el('div', { class: 'row source-line source-suggested small muted' },
      icon('lightbulb'),
      el('span', {}, W.suggestedFromFileName),
      el('span', {}, '·'),
      el('button', { class: 'link small', type: 'button', title: W.useThisTip(name, problemId), onclick: () => send({ type: 'confirmProblem', problemId }) }, W.useThis),
    );
  }
  return el('div', { class: `row source-line source-${source} small muted` }, icon(SOURCE_ICON[source] ?? 'info'), el('span', {}, SOURCE_TEXT[source] ?? source));
}

/**
 * Folder mode: one role's dropdown ("Submits" / "Runs"). The first option is
 * "Automatic: <detected file>" (or "asked when needed"); picking a file is
 * remembered for the folder; picking Automatic again forgets the choice.
 */
export function rolePicker(id: string, label: string, role: 'submit' | 'run', file: string | null, chosen: boolean, why: string | null, files: string[], askText: string, tip: string): HTMLElement {
  const detected = chosen ? null : file;
  const pick = el('select', {
    id,
    disabled: !files.length,
    title: why && !chosen ? `${tip}${/[.!?]$/.test(tip) ? '' : '.'} ${W.whyTip(why)}` : tip,
    onchange: (e: Event) => send({ type: 'setFolderRole', role, file: (e.target as HTMLSelectElement).value }),
  });
  pick.append(el('option', { value: '', selected: !chosen }, detected ? W.automatic(detected) : askText));
  for (const f of files) pick.append(el('option', { value: f, selected: chosen && f === file }, f));
  return el('div', { class: 'field' }, el('label', { class: 'field-label', for: id }, label), pick);
}

/** Folder mode: "Folder linked by you: pkg/" (instead of the match line). */
export function folderLine(f: NonNullable<ViewState['folder']>): HTMLElement {
  return el('div', { class: 'row source-line source-folder small muted' }, icon('folder'), el('span', { class: 'ellipsis', title: f.path }, W.folderLinked(f.path)));
}
