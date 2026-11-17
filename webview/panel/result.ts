/** Sidebar webview. The Result section: the latest submission for the active file. Grader text goes in through textContent / attributes only (see main.ts). */
import '../lang'; // first: the display language is set before any element is built
import { W } from '../../src/shared/strings';
import { scoreText } from '../../src/grader/score';
import { el, icon } from '../dom';
import type { ViewState } from '../../src/shared/messages';
import { celebrateOn, celebrationFor } from './celebrate';
import { activeRawSum, button, scoreClass, section, send } from './shared';
import { legend, legendButton, legendOpen, plainComment, verdictStrip } from './verdicts';

export const sResult = section('result', W.sectionResult);
export function renderResult(s: ViewState): void {
  const b = sResult.body;
  b.replaceChildren();
  const r = s.result;
  if (!r) {
    b.append(el('p', { class: 'muted' }, W.noResultYet));
    return;
  }
  b.append(
    el('div', { class: 'row result-head' },
      r.number !== null ? el('span', { class: 'muted' }, W.attempt(r.number)) : null,
      r.number !== null && r.submissionId ? el('span', { class: 'muted' }, '·') : null,
      r.submissionId
        ? el('button', { class: 'link', type: 'button', title: W.openOnTheGraderWebsite, onclick: () => send({ type: 'openSubmission', submissionId: r.submissionId! }) }, `#${r.submissionId}`, icon('link-external'))
        : null,
      el('span', { class: 'grow' }),
      r.verdicts.length ? legendButton('result') : null,
    ),
  );
  if (legendOpen === 'result' && r.verdicts.length) b.append(legend());
  if (r.phase === 'submitting' || r.phase === 'grading') {
    b.append(el('div', { class: 'row status' }, icon('loading', 'codicon-modifier-spin'), ' ', r.message ?? W.grading));
  }
  if (r.phase === 'done' || ((r.phase === 'timeout' || r.phase === 'error') && r.verdicts.length)) {
    const st = scoreText(r.points, activeRawSum());
    const text = r.compileError ? W.compilationError : r.points !== null ? st.text : (r.message ?? W.graded);
    const scoreRow = el('div', { class: 'row score-row' }, el('span', { class: `score ${r.compileError ? 'score-zero' : scoreClass(r.points, activeRawSum())}`, title: r.compileError ? undefined : (st.tip ?? undefined) }, text));
    b.append(scoreRow);
    const party = celebrationFor(s, r);
    if (party) celebrateOn(scoreRow, b, party);
    if (r.verdicts.length) {
      b.append(verdictStrip(r.verdicts));
    } else if (r.comment && !r.compileError) b.append(plainComment(r.comment));
    const failed = r.verdicts.filter((v) => !v.ok);
    if (failed.length && failed.length <= 6) b.append(el('ul', { class: 'failed' }, ...failed.map((v) => el('li', {}, v.label))));
    if (r.improvement) b.append(el('p', { class: 'improvement' }, icon('graph-line'), ' ', r.improvement));
  }
  if (r.compileError) {
    b.append(
      el('details', { class: 'compiler', open: true },
        el('summary', {}, W.compilerMessage),
        el('pre', {}, r.compilerMessage || W.empty),
        el('div', { class: 'row gap' },
          r.errorLine ? button([icon('go-to-file'), ' ', W.goToLine(r.errorLine)], () => send({ type: 'goToCompileError' })) : null,
          button([icon('go-to-file'), ' ', W.openInEditor], () => send({ type: 'showCompilerMessage' })),
        ),
      ),
    );
  }
  if (r.phase === 'timeout' || r.phase === 'error') {
    b.append(el('div', { class: r.phase === 'error' ? 'error' : 'notice' }, icon(r.phase === 'error' ? 'error' : 'clock'), ' ', r.message ?? ''));
  }
}
