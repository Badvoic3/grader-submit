/** Sidebar webview. The first-full-score celebration on the Result card, the trophy toast and the Trophies section. Grader text goes in through textContent / attributes only (see main.ts). */
import '../lang'; // first: the display language is set before any element is built
import { reducedMotion } from '../look';
import { W } from '../../src/shared/strings';
import { el, icon } from '../dom';
import { CELEBRATE } from '../../src/shared/constants';
import type { CelebrateView, ResultView, ViewState } from '../../src/shared/messages';
import { iconButton, saveUi, section, tooltip, ui } from './shared';

export const sTrophies = section('trophies', W.sectionTrophies, [], true);
// -------------------------------------------------------------- celebration and trophies

/** The celebration that belongs on this Result card, if any. */
export function celebrationFor(s: ViewState, r: ResultView): CelebrateView | null {
  const c = s.celebrate;
  if (!c || c.problemId !== r.problemId || r.compileError) return null;
  return c.submissionId === null || c.submissionId === r.submissionId ? c : null;
}


/**
 * The ring and the "First 100!" ribbon stay on the card; the first time a celebration is shown (and only while it
 * is fresh) the ring fills, confetti bursts from it, the ribbon pops and the trophy toast slides up.
 */
export function celebrateOn(row: HTMLElement, body: HTMLElement, c: CelebrateView): void {
  const ring = el('span', { class: 'fun-ring', 'aria-hidden': 'true' });
  const svg = (cls: string) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [k, v] of Object.entries({ class: cls, cx: '18', cy: '18', r: '15.9', fill: 'none', 'stroke-width': '3', pathLength: '100' })) circle.setAttribute(k, v);
    return circle;
  };
  const pic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  pic.setAttribute('viewBox', '0 0 36 36');
  pic.append(svg('track'), svg('arc'));
  ring.append(pic, icon('check'));
  row.prepend(ring);
  row.classList.add('fun-row');
  row.append(el('span', { class: 'fun-ribbon' }, icon('sparkle-filled'), W.fun.first));
  const play = (ui.celebrated ?? 0) < c.id && Date.now() - c.at < CELEBRATE.freshMs;
  if (!play) return;
  ui.celebrated = c.id;
  saveUi();
  const still = reducedMotion();
  if (!still) {
    row.classList.add('fun-play');
    body.classList.add('fun-host');
    const box = el('div', { class: 'fun-confetti', 'aria-hidden': 'true' });
    const colors = ['green', 'yellow', 'blue', 'purple', 'red', 'orange'];
    // The ring's centre in the card (a closed section has no layout yet: the ring's usual place).
    const x0 = ring.offsetWidth ? ring.offsetLeft + ring.offsetWidth / 2 : 23;
    const y0 = ring.offsetHeight ? ring.offsetTop + ring.offsetHeight / 2 : 40;
    for (let i = 0; i < CELEBRATE.confettiPieces; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 40 + Math.random() * 80;
      const piece = el('i');
      const props: Record<string, string> = {
        '--x0': `${x0}px`,
        '--y0': `${y0}px`,
        '--dx': `${Math.cos(a) * v * 1.4}px`,
        '--dy': `${Math.sin(a) * v * 0.7 - 30}px`,
        '--r': `${(Math.random() - 0.5) * 720}deg`,
        '--c': `var(--vscode-charts-${colors[i % colors.length]})`,
        '--d': `${CELEBRATE.confettiDelayMs + Math.floor(Math.random() * 120)}ms`,
      };
      for (const [k, v2] of Object.entries(props)) piece.style.setProperty(k, v2);
      box.append(piece);
    }
    body.append(box);
    setTimeout(() => box.remove(), CELEBRATE.confettiDelayMs + 1800);
  }
  showTrophyToast(c, still ? 0 : CELEBRATE.toastDelayMs);
}

export let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showTrophyToast(c: CelebrateView, delay: number): void {
  document.querySelector('.fun-toast')?.remove();
  clearTimeout(toastTimer);
  const close = () => {
    clearTimeout(toastTimer);
    toast.remove();
  };
  const more = [c.streak > 0 ? W.fun.streak(c.streak) : null, c.topic ? W.fun.topic(c.topic.name, c.topic.solved, c.topic.total) : null].filter((x): x is string => !!x);
  const toast = el('div', { class: 'fun-toast', role: 'status' },
    icon('star-full'),
    el('strong', {}, W.fun.unlocked),
    iconButton('close', W.fun.close, close),
    c.problemName ? el('span', { class: 'sub' }, W.fun.firstOn(c.problemName)) : null,
    more.length ? el('span', { class: 'sub' }, more.join(' · ')) : null,
  );
  const autoClose = () => {
    toastTimer = setTimeout(() => (toast.matches(':hover, :focus-within') ? autoClose() : close()), CELEBRATE.toastMs);
  };
  toastTimer = setTimeout(() => {
    document.body.append(toast);
    tooltip.refresh();
    autoClose();
  }, delay);
}

export function renderTrophies(s: ViewState): void {
  const b = sTrophies.body;
  b.replaceChildren();
  const t = s.trophies;
  if (!t) return;
  const tile = (name: string, n: number, label: string) => el('div', { class: `fun-tile${n ? '' : ' locked'}` }, icon(name), el('b', {}, String(n)), el('span', {}, label));
  b.append(
    el('div', { class: 'fun-tiles' },
      tile('pass-filled', t.firsts, W.fun.firsts),
      tile('flame', t.streak, `${W.fun.days} · ${W.fun.best(t.best)}`),
      tile('verified-filled', t.wholeTopics, W.fun.wholeTopics),
    ),
  );
  if (!t.topics.length) {
    b.append(el('p', { class: 'muted small' }, W.fun.noTopics));
    return;
  }
  b.append(el('div', { class: 'muted small' }, W.fun.topics));
  for (const x of t.topics) {
    const fill = el('i');
    fill.style.width = `${x.total ? (x.solved / x.total) * 100 : 0}%`;
    b.append(
      el('div', { class: 'fun-topic', title: W.fun.topic(x.name, x.solved, x.total) },
        el('span', { class: 'ellipsis' }, x.name),
        el('span', { class: 'muted small' }, W.fun.topicCount(x.solved, x.total), x.solved === x.total ? icon('check') : null),
        el('div', { class: 'bar', 'aria-hidden': 'true' }, fill),
      ),
    );
  }
}
