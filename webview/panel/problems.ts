/** Sidebar webview. The Problems section: rows in normal flow (FlowList), status / topic / tag filters, sort, search. Grader text goes in through textContent / attributes only (see main.ts). */
import '../lang'; // first: the display language is set before any element is built
import { W } from '../../src/shared/strings';
import { el, icon } from '../dom';
import { FlowList } from '../flowList';
import { PANEL } from '../../src/shared/constants';
import { filterProblems, sorts, sortProblems } from '../filters';
import { cycleTopic, topicState } from '../../src/shared/tags';
import type { ProblemFilter, ProblemView, ViewState } from '../../src/shared/messages';
import { pickerSearch, setPickerOpen } from './current';
import { MenuItem, button, closeContextMenu, ctxToggle, hooks, iconButton, openContextMenu, radioGroup, saveUi, scorePill, section, send, setCtxToggle, state, titleParts, ui, withContextMenu } from './shared';

export const problemFilter = el('input', { type: 'search', placeholder: W.filterPlaceholder, 'aria-label': W.filterProblems, spellcheck: 'false', value: ui.filter });
export const problemSearch = el('div', { class: 'search-box' }, icon('search'), problemFilter);

export const sProblems = section('problems', W.sectionProblems, [iconButton('refresh', W.refreshProblems, () => send({ type: 'refreshProblems' }))]);
/** Right-click on a problem row: the row's icons, plus linking the open file and the website. */
export function rowMenuItems(p: ProblemView, s: ViewState): MenuItem[] {
  const fileName = s.file?.name;
  return [
    ...(fileName ? [{ icon: 'link', label: W.linkTo(fileName), tip: W.useFor(p.name, fileName), onclick: () => send({ type: 'mapProblem', problemId: p.id }) }] : []),
    { icon: 'copy', label: W.copyProblemName, onclick: () => send({ type: 'copyName', problemId: p.id }) },
    p.hasFile
      ? { icon: 'go-to-file', label: W.goToLinkedFile, onclick: () => send({ type: 'goToFile', problemId: p.id }) }
      : { icon: 'search', label: W.findMatchingFile, onclick: () => send({ type: 'findFile', problemId: p.id }) },
    { icon: 'new-file', label: W.newFileForThisProblem, onclick: () => send({ type: 'newFile', problemId: p.id }) },
    { icon: 'file-pdf', label: W.openStatement, onclick: () => send({ type: 'openStatement', problemId: p.id }) },
    ...(p.hasAttachment
      ? [{ icon: 'cloud-download', label: W.downloadAttachment, onclick: () => send({ type: 'downloadAttachment', problemId: p.id }), disabledReason: s.attachment.busy === p.id ? W.downloading : null }]
      : []),
    { icon: 'globe', label: W.openOnTheGraderWebsite, onclick: () => send({ type: 'openProblemInBrowser', problemId: p.id }) },
  ];
}

/** Last click on a list row (an editor switch caused by it never scrolls the list). */
export let lastRowClickAt = 0;

export function problemRow(p: ProblemView, s: ViewState, where: 'picker' | 'list'): HTMLElement {
  const mapped = s.problem?.id === p.id;
  const sub = titleParts(p).subtitle;
  const main = el('button', {
    class: 'problem-main',
    type: 'button',
    'aria-label': `${p.name} #${p.id}${sub ? `, ${sub}` : ''}${where === 'list' && p.tags?.length ? `, ${W.problemTags(p.tags.join(', '))}` : ''}`,
    // Picker: choose this problem for the file. List: open its linked file (or offer choices).
    disabled: where === 'picker' && !s.file,
    onclick: () => {
      if (where === 'picker') {
        setPickerOpen(false);
        pickerSearch.value = '';
        send({ type: 'mapProblem', problemId: p.id });
      } else {
        lastRowClickAt = Date.now();
        send({ type: 'problemRowClick', problemId: p.id });
      }
    },
  },
    el('span', { class: 'problem-name ellipsis' }, mapped ? icon('check') : null, p.name, el('span', { class: 'muted id' }, ` #${p.id}`)),
    sub ? el('span', { class: 'problem-full ellipsis muted' }, sub) : null,
    // Every tag of the problem, as on the website's problem list (topics and other tags).
    where === 'list' && p.tags?.length ? el('span', { class: 'problem-tags', 'aria-hidden': 'true' }, ...p.tags.map((t) => el('span', { class: 'tag' }, t))) : null,
  );
  // Tooltip: just the names (bold "name #id", the title below).
  main.dataset.tipTitle = `${p.name} #${p.id}`;
  main.dataset.tip = main.disabled ? W.openFileToLink(sub ? `${sub} · ` : '') : (sub ?? '');
  // Score pill in the first column (CSS grid; first in reading order stays the name). The icons float in
  // over the row's bottom right on hover / keyboard focus, so they take no room from the name.
  // Right-click offers the same and more.
  return withContextMenu(
    el('div', { class: `problem-row${mapped ? ' mapped' : ''}`, role: where === 'picker' ? 'option' : undefined, 'aria-selected': where === 'picker' ? String(mapped) : undefined },
      main,
      scorePill(p.score),
      el('span', { class: 'row-actions' },
        // First (leftmost): the icons are right-aligned, so the other four stay in the same columns on every row.
        p.hasAttachment
          ? iconButton('cloud-download', W.downloadAttachment, () => send({ type: 'downloadAttachment', problemId: p.id }), { disabledReason: s.attachment.busy === p.id ? W.downloading : null })
          : null,
        iconButton('copy', W.copyProblemName, () => send({ type: 'copyName', problemId: p.id })),
        p.hasFile
          ? iconButton('go-to-file', W.goToLinkedFile, () => send({ type: 'goToFile', problemId: p.id }))
          : iconButton('search', W.findMatchingFile, () => send({ type: 'findFile', problemId: p.id })),
        iconButton('new-file', W.newFileForThisProblem, () => send({ type: 'newFile', problemId: p.id })),
        iconButton('file-pdf', W.openStatement, () => send({ type: 'openStatement', problemId: p.id })),
      ),
    ),
    () => rowMenuItems(p, state ?? s),
  );
}

/**
 * Problem list: one persistent list, rows in normal flow (see flowList.ts).
 * Rows are keyed by problem id and rebuilt only when their own data changed;
 * an editor switch only updates the rows whose ✓ changed.
 */
export const problemVersion = (p: ProblemView) =>
  JSON.stringify([p.name, p.fullName, p.score, p.status, p.tags, p.hasFile, p.hasTestcase, p.hasAttachment, state?.attachment.busy === p.id, state?.problem?.id === p.id]);
export let listSaveTimer: ReturnType<typeof setTimeout> | undefined;
export const problemList = new FlowList<ProblemView>(document, {
  key: (p) => String(p.id),
  version: problemVersion,
  render: (p) => problemRow(p, state!, 'list'),
  maxHeight: PANEL.listMaxHeightPx,
  className: 'problem-list',
  onScroll: (top) => {
    ui.listScroll = top;
    clearTimeout(listSaveTimer);
    listSaveTimer = setTimeout(saveUi, PANEL.scrollSaveMs);
  },
});
export let listRestored = false;
export let listHitsKey = '';
export let listHits: ProblemView[] = [];

/** Filtered + sorted items (recomputed only when items, filter or search changed). */
export function problemHits(s: ViewState): ProblemView[] {
  const q = problemFilter.value.trim().toLowerCase();
  const key = JSON.stringify([s.problems.items, s.problems.filter, q]);
  if (key !== listHitsKey) {
    listHitsKey = key;
    listHits = sortProblems(filterProblems(s.problems.items, s.problems.filter, q), s.problems.filter.sort ?? 'default');
  }
  return listHits;
}

/** Every problem's key: rows filtered out stay in the list, hidden, so clearing the filter is cheap. */
export let knownFor: ViewState['problems']['items'] | null = null;
export let known = new Set<string>();
export function knownKeys(s: ViewState): Set<string> {
  if (s.problems.items !== knownFor) {
    knownFor = s.problems.items;
    known = new Set(s.problems.items.map((p) => String(p.id)));
  }
  return known;
}

/** Update the list rows in place (cheap; runs after every state push). */
export function syncProblemList(s: ViewState): void {
  if (!s.problems.loaded || !problemList.viewport.isConnected) return;
  problemList.setItems(problemHits(s), knownKeys(s));
  if (!listRestored && ui.listScroll) {
    problemList.scrollTop = ui.listScroll;
  }
  listRestored = true;
}

export function renderProblems(s: ViewState): void {
  const b = sProblems.body;
  const keepScroll = problemList.viewport.isConnected ? problemList.scrollTop : (ui.listScroll ?? 0);
  // Ticking a tag re-renders the section: put keyboard focus back on the same control.
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focus;
  b.replaceChildren();
  const P = s.problems;
  if (!P.loaded) {
    if (P.loading) b.append(el('p', { class: 'muted' }, icon('loading', 'codicon-modifier-spin'), ' ', W.loadingProblems));
    else if (s.account.status !== 'logged-in' && !s.account.hasSavedPassword) b.append(el('p', { class: 'muted' }, W.logInToSeeProblems));
    else b.append(button([icon('refresh'), ' ', W.loadProblems], () => send({ type: 'refreshProblems' })));
    if (P.error) b.append(el('div', { class: 'error' }, icon('error'), ' ', P.error));
    return;
  }
  b.append(statusFilter(P.filter), el('div', { class: 'filter-row' }, problemSearch, sortButton(P.filter)));
  if (P.topics.length || P.tags.length) {
    b.append(el('div', { class: 'filter-chips' },
      P.topics.length ? topicFilter(P.filter, P.topics, P.topicClickOrder ?? 'showFirst') : null,
      P.tags.length ? tagToggle(P.filter) : null,
    ));
  }
  if (P.tags.length && tagMenuOpen) b.append(tagMenu(P.filter, P.tags));
  const hits = problemHits(s);
  b.append(problemList.viewport);
  problemList.setItems(hits, knownKeys(s));
  // The same viewport element is re-inserted: put the scroll position back.
  if (keepScroll && problemList.scrollTop !== keepScroll) problemList.scrollTop = keepScroll;
  listRestored = true;
  b.append(el('p', { class: 'muted small list-count' }, hits.length === P.items.length ? W.nProblems(P.items.length) : W.nOfProblems(hits.length, P.items.length)));
  if (focusKey) [...b.querySelectorAll<HTMLElement>('[data-focus]')].find((x) => x.dataset.focus === focusKey)?.focus();
  if (P.penaltyNote) b.append(el('p', { class: 'hint' }, icon('info'), ' ', P.penaltyNote));
  if (P.stale) b.append(el('p', { class: 'hint' }, icon('warning'), ' ', W.mayBeOutOfDate));
  if (P.loading) b.append(el('p', { class: 'muted small' }, icon('loading', 'codicon-modifier-spin'), ' ', W.refreshing));
  if (P.error) b.append(el('div', { class: 'error' }, icon('error'), ' ', P.error));
}

export const STATUS_FILTERS: { key: ProblemFilter['status']; label: string; tip: string }[] = [
  { key: 'all', label: W.all, tip: W.allProblems },
  { key: 'unsolved', label: W.unsolved, tip: W.unsolvedTip },
  { key: 'inprogress', label: W.inProgress, tip: W.inProgressTip },
  { key: 'solved', label: W.solved, tip: W.solvedTip },
];

export function statusFilter(f: ProblemFilter): HTMLElement {
  return radioGroup(el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': W.filterProblemsByStatus },
    ...STATUS_FILTERS.map((x) =>
      el('button', {
        class: `seg${f.status === x.key ? ' active' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(f.status === x.key), title: x.tip,
        'data-focus': `status-${x.key}`,
        onclick: () => send({ type: 'setFilter', filter: { ...f, status: x.key } }),
      }, x.label),
    ),
  ));
}

/** Sort order: an icon button with a pick-one menu; a dot shows a non-default order. */
export function sortButton(f: ProblemFilter): HTMLElement {
  const current = f.sort ?? 'default';
  const choices = sorts();
  const open = () => {
    if (ctxToggle === btn) { closeContextMenu(true); return; }
    const r = btn.getBoundingClientRect();
    openContextMenu(r.left, r.bottom + 2, choices.map((x) => ({
      icon: x.key === current ? 'check' : 'blank', label: x.label, checked: x.key === current,
      onclick: () => {
        btn.focus(); // the render puts focus back on the rebuilt button (`data-focus`)
        send({ type: 'setFilter', filter: { ...f, sort: x.key } });
      },
    })), btn);
    setCtxToggle(btn);
  };
  const btn = iconButton('sort-precedence', W.sortedBy(choices.find((x) => x.key === current)?.label ?? ''), open);
  btn.classList.add('sort-btn');
  btn.classList.toggle('changed', current !== 'default');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.dataset.focus = 'sort';
  return btn;
}

/**
 * Topic pills, three states each (clicks cycle; `cedtGrader.panel.topicClickOrder`:
 * show only first, or hide first). Colour + icon show the state.
 */
export function topicFilter(f: ProblemFilter, topics: { name: string; description: string | null }[], order: 'showFirst' | 'hideFirst'): HTMLElement {
  return el('div', { class: 'topics', role: 'group', 'aria-label': W.filterProblemsByTopic },
    ...topics.map((t) => {
      const state = topicState(f, t.name);
      const tip = W.topicTip(t.description, t.name, state, order);
      return el('button', {
        class: `topic${state === 'in' ? ' active' : state === 'out' ? ' excluded' : ''}`, type: 'button',
        title: tip, 'aria-label': tip, 'data-focus': `topic:${t.name}`,
        onclick: () => send({ type: 'setFilter', filter: { ...f, ...cycleTopic(f, t.name, order) } }),
      }, state === 'in' ? icon('check') : state === 'out' ? icon('circle-slash') : null, t.name);
    }),
  );
}

/** The "Tags" dropdown is open (local UI state; it stays open while ticking several tags). */
export let tagMenuOpen = false;

/** Change the chosen tags or how they match, keeping the rest of the filter. */
export function setTags(f: ProblemFilter, next: Partial<ProblemFilter>): void {
  send({ type: 'setFilter', filter: { ...f, tags: f.tags ?? [], tagMode: f.tagMode ?? 'or', ...next } });
}

/** The "Tags" button, last on the row of topic pills; `tagMenu` opens below that row. */
export function tagToggle(f: ProblemFilter): HTMLElement {
  const chosen = f.tags ?? [];
  const label = chosen.length ? W.tagsChosen(chosen.join((f.tagMode ?? 'or') === 'and' ? ' + ' : ' / ')) : W.tagsFilter;
  return el('button', {
    class: `tag-toggle${chosen.length ? ' active' : ''}`, type: 'button', 'aria-expanded': String(tagMenuOpen), title: W.tagsFilterTip,
    'data-focus': 'tag-toggle',
    onclick: () => { tagMenuOpen = !tagMenuOpen; hooks.forceRender(); },
  }, icon('tag'), el('span', { class: 'ellipsis' }, label), icon(tagMenuOpen ? 'chevron-up' : 'chevron-down'));
}

/**
 * The open "Tags" dropdown: the problems' other tags (not the topic pills), several
 * at once, matched with Any (OR) or All (AND). Combines with status, topic and search.
 */
export function tagMenu(f: ProblemFilter, tags: string[]): HTMLElement {
  const chosen = f.tags ?? [];
  const mode = f.tagMode ?? 'or';
  const modes: { key: 'or' | 'and'; label: string; tip: string }[] = [
    { key: 'or', label: W.tagMatchAny, tip: W.tagMatchAnyTip },
    { key: 'and', label: W.tagMatchAll, tip: W.tagMatchAllTip },
  ];
  return el('div', { class: 'tag-menu', role: 'group', 'aria-label': W.tagsFilter,
    onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') { tagMenuOpen = false; hooks.forceRender(); document.querySelector<HTMLElement>('[data-focus="tag-toggle"]')?.focus(); } },
  },
    el('div', { class: 'tag-menu-head' },
      el('span', { class: 'small muted' }, W.tagMatch),
      radioGroup(el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': W.tagMatch },
        ...modes.map((m) => el('button', {
          class: `seg${mode === m.key ? ' active' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(mode === m.key), title: m.tip,
          'data-focus': `tag-mode-${m.key}`,
          onclick: () => setTags(f, { tagMode: m.key }),
        }, m.label)),
      )),
      el('button', { class: 'link small', type: 'button', title: W.clearTagsTip, disabled: !chosen.length, 'data-focus': 'tag-clear', onclick: () => setTags(f, { tags: [] }) }, W.clearTags),
    ),
    el('div', { class: 'tag-list' },
      ...tags.map((t) => {
        const on = chosen.some((c) => c.toLowerCase() === t.toLowerCase());
        return el('label', { class: 'tag-option' },
          el('input', { type: 'checkbox', checked: on, 'data-focus': `tag:${t}`,
            onchange: () => setTags(f, { tags: on ? chosen.filter((c) => c.toLowerCase() !== t.toLowerCase()) : [...chosen, t] }) }),
          el('span', { class: 'ellipsis' }, t),
        );
      }),
    ),
  );
}
