/** Sidebar webview. Verdict tiles, strips and the "Reading the results" legend, shared by Result and History. Grader text goes in through textContent / attributes only (see main.ts). */
import '../lang'; // first: the display language is set before any element is built
import { W } from '../../src/shared/strings';
import { verdictLegend } from '../../src/grader/verdicts';
import { groupLabel } from '../../src/grader/verdictWords';
import { el } from '../dom';
import type { VerdictView } from '../../src/shared/messages';
import { hooks, iconButton } from './shared';

export const VERDICT_LETTER: Record<string, string> = {
  correct: 'P', wrong: '-', partial: 's', time_limit: 'T', memory_limit: 'M', crash: 'x', unknown_error: 'E', grader_error: '!', waiting: '?',
};

export function verdictTile(v: VerdictView): HTMLElement {
  const known = v.kind in VERDICT_LETTER;
  return el('span', { class: `tile v-${known ? v.kind : 'unknown'}`, title: v.label, role: 'img', 'aria-label': v.label }, VERDICT_LETTER[v.kind] ?? '?');
}

/** One tile per test, in order; `[...]` groups drawn as a box (as on the website). */
export function verdictStrip(verdicts: VerdictView[]): HTMLElement {
  const strip = el('div', { class: 'strip', role: 'group', 'aria-label': W.verdictPerTest });
  const groupCount = new Set(verdicts.filter((v) => v.group !== undefined).map((v) => v.group)).size;
  let i = 0;
  while (i < verdicts.length) {
    const v = verdicts[i];
    if (v.group === undefined) {
      strip.append(verdictTile(v));
      i++;
      continue;
    }
    const members = verdicts.filter((x) => x.group === v.group);
    const label = groupLabel(v.group, groupCount, members);
    strip.append(el('span', { class: 'tile-group', title: label, 'aria-label': label, role: 'group' }, ...members.map(verdictTile)));
    i += members.length;
  }
  return strip;
}

/** Plain text for comments that are not a verdict strip ("No testcase", odd brackets, …). */
export function plainComment(comment: string): HTMLElement {
  return el('code', { class: 'comment' }, `[${comment}]`);
}

export let legendOpen: string | null = null;
export const setLegendOpen = (v: string | null) => { legendOpen = v; };
/** "?" button with the "Reading the results" popover (like the website's legend). */
export function legendButton(where: string): HTMLElement {
  const btn = iconButton('question', W.readingTheResults, () => {
    legendOpen = legendOpen === where ? null : where;
    hooks.forceRender();
  });
  btn.setAttribute('aria-expanded', String(legendOpen === where));
  return btn;
}
export function legend(): HTMLElement {
  return el('div', { class: 'legend', role: 'note' },
    el('strong', {}, W.readingTheResults),
    ...verdictLegend().map((c) => el('div', { class: 'row' }, el('span', { class: `tile v-${c.kind}`, 'aria-hidden': 'true' }, c.code), el('span', {}, c.word))),
    el('div', { class: 'row' }, el('span', { class: 'tile-group', 'aria-hidden': 'true' }, el('span', { class: 'tile v-correct' }, 'P'), el('span', { class: 'tile v-correct' }, 'P'), el('span', { class: 'tile v-wrong' }, '-')), el('span', {}, W.legendBox)),
    el('p', { class: 'small' }, W.legendTiles),
    el('p', { class: 'small muted' }, W.legendHover),
  );
}

/** Compact strip for history rows: every test (no cut-off), wraps on its own line, groups kept as boxes. */
export function miniStrip(verdicts: VerdictView[]): HTMLElement {
  const passed = verdicts.filter((v) => v.ok).length;
  const strip = el('div', { class: 'mini-strip', role: 'img', 'aria-label': W.testsPassed(passed, verdicts.length) });
  const mini = (v: VerdictView) => el('span', { class: `mini v-${v.kind in VERDICT_LETTER ? v.kind : 'unknown'}`, title: v.label });
  const groupCount = new Set(verdicts.filter((v) => v.group !== undefined).map((v) => v.group)).size;
  let i = 0;
  while (i < verdicts.length) {
    const v = verdicts[i];
    if (v.group === undefined) {
      strip.append(mini(v));
      i++;
      continue;
    }
    const members = verdicts.filter((x) => x.group === v.group);
    strip.append(el('span', { class: 'mini-group', title: groupLabel(v.group, groupCount, members) }, ...members.map(mini)));
    i += members.length;
  }
  return strip;
}
