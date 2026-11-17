/** Sidebar webview. The History section: every submission, with per-test details on demand. Grader text goes in through textContent / attributes only (see main.ts). */
import '../lang'; // first: the display language is set before any element is built
import { W } from '../../src/shared/strings';
import { scoreText } from '../../src/grader/score';
import { appendChildren, el, icon } from '../dom';
import type { HistoryEntry, SubmissionDetailView, ViewState } from '../../src/shared/messages';
import { activeRawSum, button, exact, fmt, hooks, iconButton, megabytes, relative, scoreClass, seconds, section, send } from './shared';
import { VERDICT_LETTER, legend, legendOpen, miniStrip, setLegendOpen } from './verdicts';

// Built once, in the header: renderHistory keeps its aria-expanded in step with the legend.
export const historyHelp = iconButton('question', W.readingTheResults, () => {
  setLegendOpen(legendOpen === 'history' ? null : 'history');
  hooks.forceRender();
});
historyHelp.setAttribute('aria-expanded', 'false');
export const sHistory = section('history', W.sectionHistory, [
  historyHelp,
  iconButton('refresh', W.refreshHistory, () => send({ type: 'refreshHistory' })),
]);
export function detailBox(d: SubmissionDetailView): HTMLElement {
  const box = el('div', { class: 'detail' });
  box.append(
    el('div', { class: 'score-facts small' },
      el('span', {}, W.maxTime, ' ', el('strong', {}, seconds(d.maxRuntimeMs))),
      el('span', {}, W.peakMemory, ' ', el('strong', {}, megabytes(d.peakMemoryKb))),
      d.sourceFilename ? el('span', { class: 'mono' }, d.sourceFilename) : null,
    ),
  );
  if (d.evaluations.length) {
    const table = el('table', { class: 'evals' },
      el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, W.result), el('th', {}, W.score), el('th', {}, W.time), el('th', {}, W.memory))),
    );
    const body = el('tbody');
    for (const e of d.evaluations) {
      body.append(
        el('tr', {},
          el('td', { class: 'num' }, String(e.index)),
          el('td', { class: 'verdict' }, el('span', { class: `mini v-${e.kind in VERDICT_LETTER ? e.kind : 'unknown'}`, 'aria-hidden': 'true', title: e.label }), ' ', e.label.replace(/^Test \d+: /, '')),
          el('td', { class: 'num' }, e.score === null ? '–' : fmt(e.score)),
          el('td', { class: 'num' }, seconds(e.timeMs)),
          el('td', { class: 'num' }, megabytes(e.memoryKb)),
        ),
      );
    }
    table.append(body);
    box.append(el('div', { class: 'evals-wrap' }, table));
  }
  if (d.compilerMessage) box.append(el('details', { class: 'compiler' }, el('summary', {}, W.compilerMessage), el('pre', {}, d.compilerMessage)));
  box.append(
    el('div', { class: 'row gap' },
      button([icon('go-to-file'), ' ', W.openThisVersion], () => send({ type: 'openSubmissionSource', submissionId: d.submissionId }), { disabled: !d.hasSource, title: d.hasSource ? W.openThisVersionTip : W.noSourceTip }),
      button([icon('diff'), ' ', W.compareWithCurrentFile], () => send({ type: 'compareSubmission', submissionId: d.submissionId }), { disabled: !d.hasSource, title: d.hasSource ? W.compareWithCurrentFile : W.noSourceTip }),
      el('button', { class: 'link', type: 'button', title: W.openInBrowser, onclick: () => send({ type: 'openSubmission', submissionId: d.submissionId }) }, W.website, icon('link-external')),
    ),
  );
  return box;
}

export function historyRow(h: HistoryEntry, s: ViewState): HTMLElement {
  const ex = s.history.expanded;
  const open = ex?.submissionId === h.submissionId;
  const row = el('div', { class: `history-item${open ? ' open' : ''}${h.counted ? ' counted' : ''}` });
  appendChildren(row, [
    el('div', { class: 'row history-line' },
    el('button', { class: 'history-row grow', type: 'button', 'aria-expanded': String(open), title: W.submissionTip(h.submissionId, exact(h.submittedAt)), onclick: () => send({ type: 'toggleSubmission', submissionId: h.submissionId }) },
      icon(open ? 'chevron-down' : 'chevron-right'),
      el('span', { class: 'mono muted' }, h.number !== null ? `${h.number}.` : `#${h.submissionId}`),
      (() => {
        const st = scoreText(h.points, activeRawSum());
        const tip = h.compileError ? W.compilationError : st.tip ? `${st.text}. ${st.tip}` : st.text;
        return el('span', { class: `pill ${h.compileError ? 'score-zero' : scoreClass(h.points, activeRawSum())}`, title: tip, 'aria-label': tip }, h.compileError ? W.ce : fmt(h.points));
      })(),
      // The star takes the colour of the counted score on this problem (penalties included), like the score pill.
      h.counted ? el('span', { class: `badge counted ${scoreClass(s.problem?.score.counted ?? h.points, activeRawSum())}`, title: W.countedTip, 'aria-label': W.countedLabel }, icon('star-full'), el('span', { class: 'counted-text' }, W.counted)) : null,
      el('span', { class: 'grow ellipsis' },
        h.verdicts.length
          ? el('span', { class: 'muted small', title: W.testsPassed(h.verdicts.filter((v) => v.ok).length, h.verdicts.length) }, `${h.verdicts.filter((v) => v.ok).length}/${h.verdicts.length}`)
          : h.compileError
            ? el('span', { class: 'muted small' }, W.compileError)
            : h.comment
              ? el('span', { class: 'mono small' }, `[${h.comment}]`)
              : el('span', { class: 'muted small' }, h.status.replace(/_/g, ' ')),
      ),
      el('span', { class: 'muted small nowrap', title: exact(h.submittedAt) }, relative(h.submittedAt)),
    ),
    iconButton('globe', W.openOnTheGraderWebsite, () => send({ type: 'openSubmission', submissionId: h.submissionId })),
    ),
    h.verdicts.length ? miniStrip(h.verdicts) : null,
  ]);
  if (open) {
    row.append(
      el('div', { class: 'row small muted pad-left' }, h.language ?? '', h.language ? ' · ' : '', exact(h.submittedAt), ` · #${h.submissionId}`),
    );
    if (ex!.detail) row.append(detailBox(ex!.detail));
    else if (ex!.loading) row.append(el('p', { class: 'muted small pad-left' }, icon('loading', 'codicon-modifier-spin'), ' ', W.loadingDetails));
    else if (ex!.error) row.append(el('div', { class: 'error pad-left' }, icon('error'), ' ', ex!.error));
  }
  return row;
}

export function renderHistory(s: ViewState): void {
  const b = sHistory.body;
  b.replaceChildren();
  if (!s.problem) {
    b.append(el('p', { class: 'muted' }, W.chooseProblemForHistory));
    return;
  }
  const H = s.history;
  historyHelp.setAttribute('aria-expanded', String(legendOpen === 'history'));
  if (legendOpen === 'history') b.append(legend());
  if (H.stale) b.append(el('p', { class: 'hint' }, icon('warning'), ' ', W.mayBeOutOfDate));
  if (!H.items.length) {
    if (H.loading || !H.error) b.append(el('p', { class: 'muted' }, H.loading ? W.loading : W.noSubmissions)); // an error says it below
  } else {
    const list = el('div', { class: 'history' });
    for (const h of H.items) list.append(historyRow(h, s));
    b.append(list, el('p', { class: 'muted small' }, W.nSubmissions(H.items.length)));
  }
  if (H.loading && H.items.length) b.append(el('p', { class: 'muted small' }, icon('loading', 'codicon-modifier-spin'), ' ', W.refreshing));
  if (H.error) b.append(el('div', { class: 'error' }, icon('error'), ' ', H.error));
}
