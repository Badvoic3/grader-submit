/** Sidebar webview. Shared by every section: the VS Code API, saved UI state, buttons, the context menu, formatting, the section frame and the current ViewState. Grader text goes in through textContent / attributes only (see main.ts). */
import '../lang'; // first: the display language is set before any element is built
import { installTooltips } from '../tooltip';
import { G, W } from '../../src/shared/strings';
import { dateLocale } from '../../src/shared/i18n';
import { outOfFor } from '../../src/grader/score';
import { menuLabelMax, middleEllipsis } from '../text';
import { type Child, el, icon } from '../dom';
import { SERVER_SCORE_CAP } from '../../src/shared/constants';
import type { FromWebview, ScoreView, ViewState } from '../../src/shared/messages';

export interface VsCodeApi {
  postMessage(m: FromWebview): void;
  getState(): UiState | undefined;
  setState(s: UiState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

/** UI-only state persisted by VS Code for this view. Never holds credentials. */
export interface UiState {
  collapsed: Record<string, boolean>;
  filter: string;
  /** Problem list scroll position (kept across re-renders, hide/show and restarts). */
  listScroll?: number;
  /** The last celebration played (`CelebrateView.id`): each one plays once, also across hide/show. */
  celebrated?: number;
}

export const vscode = acquireVsCodeApi();
export const ui: UiState = { collapsed: {}, filter: '', ...(vscode.getState() ?? {}) };
export const saveUi = () => vscode.setState({ collapsed: ui.collapsed, filter: ui.filter, listScroll: ui.listScroll, celebrated: ui.celebrated });
export const send = (m: FromWebview) => vscode.postMessage(m);

// A bug in this script: the host offers a report (the panel itself may be broken, so it doesn't rely on it).
export const stackOf = (err: unknown) => String((err as { stack?: unknown } | null)?.stack ?? '');
window.addEventListener('error', (e) => send({ type: 'webviewError', message: e.message, stack: stackOf(e.error) }));
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason as { message?: unknown } | null;
  send({ type: 'webviewError', message: String(err?.message ?? err), stack: stackOf(err) });
});

// ------------------------------------------------------------------ helpers

/** "How to use": the user guide on GitHub (logged-out Account section). */
export function howToUseLink(): HTMLButtonElement {
  return el('button', { class: 'link small', type: 'button', title: W.howToUseTip, onclick: () => send({ type: 'openUserGuide' }) }, icon('book'), ' ', W.howToUse);
}

/** "Troubleshooting": the README section on GitHub (connection banner, logged-out Account section). */
export function troubleshootingLink(): HTMLButtonElement {
  return el('button', { class: 'link small', type: 'button', title: W.troubleshootingTip, onclick: () => send({ type: 'openTroubleshooting' }) }, icon('question'), ' ', W.troubleshooting);
}

export function iconButton(name: string, label: string, onclick: () => void, opts: { disabledReason?: string | null } = {}): HTMLButtonElement {
  const text = opts.disabledReason ? `${label} (${opts.disabledReason})` : label;
  return el('button', { class: 'icon-btn', title: text, 'aria-label': text, type: 'button', disabled: !!opts.disabledReason, onclick }, icon(name));
}

export function button(label: Child, onclick: () => void, opts: { kind?: 'primary' | 'secondary'; disabled?: boolean; title?: string } = {}) {
  return el('button', { class: `btn ${opts.kind ?? 'secondary'}`, type: 'button', disabled: opts.disabled, title: opts.title, onclick }, label);
}

export interface MenuItem {
  icon: string;
  label: string;
  tip?: string;
  onclick: () => void;
  disabledReason?: string | null;
  /** Set on every item of a pick-one menu: the current choice is `true`. */
  checked?: boolean;
}

/**
 * Right-click menu with the same actions as the visible icons (in addition
 * to them, never instead). Opens at the pointer (or under the element for
 * the keyboard context-menu key / Shift+F10); closes on outside click,
 * Escape, Tab, scroll or after choosing. Long labels are cut in the middle;
 * the full label is in the item's tooltip and aria-label.
 */
export let ctxMenu: HTMLElement | null = null;
export let ctxReturnFocus: HTMLElement | null = null;
/** The button that opened the menu: clicking it again closes the menu. */
export let ctxToggle: HTMLElement | null = null;
export const setCtxToggle = (e: HTMLElement | null) => { ctxToggle = e; };

export function closeContextMenu(refocus = false): void {
  if (!ctxMenu) return;
  ctxMenu.remove();
  ctxMenu = null;
  if (refocus) ctxReturnFocus?.focus();
  ctxReturnFocus = null;
  ctxToggle = null;
}

export function openContextMenu(x: number, y: number, items: MenuItem[], from: HTMLElement | null): void {
  closeContextMenu();
  const max = menuLabelMax(window.innerWidth);
  const menu = el('div', { class: 'menu context-menu', role: 'menu' },
    ...items.map((it) => {
      const shown = middleEllipsis(it.label, max);
      const tip = [shown !== it.label ? it.label : '', it.tip ?? '', it.disabledReason ? `(${it.disabledReason})` : ''].filter(Boolean).join(' — ');
      const b = el('button', {
        class: 'menu-item', type: 'button', role: it.checked === undefined ? 'menuitem' : 'menuitemradio',
        'aria-checked': it.checked === undefined ? undefined : String(it.checked), disabled: !!it.disabledReason,
        title: tip || undefined,
        onclick: () => {
          closeContextMenu();
          it.onclick();
        },
      }, icon(it.icon), el('span', { class: 'menu-label' }, shown));
      b.setAttribute('aria-label', it.label);
      return b;
    }),
  );
  document.body.append(menu);
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
  menu.style.top = `${y + h > window.innerHeight - 4 ? Math.max(4, y - h) : y}px`;
  ctxMenu = menu;
  ctxReturnFocus = from;
  (menu.querySelector<HTMLButtonElement>('.menu-item[aria-checked="true"]:not([disabled])') ?? menu.querySelector<HTMLButtonElement>('.menu-item:not([disabled])'))?.focus();
}

/** Attach the right-click menu to an element; `items` is evaluated when it opens. */
export function withContextMenu<T extends HTMLElement>(target: T, items: () => MenuItem[]): T {
  target.addEventListener('contextmenu', (e) => {
    // Text fields keep the normal Cut / Copy / Paste menu.
    if ((e.target as Element).closest?.('input, textarea, select')) return;
    e.preventDefault();
    e.stopPropagation();
    const r = target.getBoundingClientRect();
    const keyboard = e.clientX === 0 && e.clientY === 0;
    openContextMenu(keyboard ? r.left + 8 : e.clientX, keyboard ? r.bottom : e.clientY, items(), (document.activeElement as HTMLElement) ?? null);
  });
  return target;
}

document.addEventListener('mousedown', (e) => {
  const on = e.target as Element;
  if (ctxMenu && !on.closest?.('.context-menu') && !ctxToggle?.contains(on)) closeContextMenu();
});
document.addEventListener('keydown', (e) => {
  if (!ctxMenu) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeContextMenu(true);
  } else if (e.key === 'Tab') {
    closeContextMenu(true); // back on the opener first, so Tab moves on from there instead of from <body>
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...ctxMenu.querySelectorAll<HTMLButtonElement>('.menu-item:not([disabled])')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    // Nothing focused yet: Down goes to the first item, Up to the last.
    const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next]?.focus();
  }
});
window.addEventListener('blur', () => closeContextMenu());
document.addEventListener('scroll', () => closeContextMenu(), true);

export function fmt(n: number | null): string {
  if (n === null) return '–';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function scoreClass(score: number | null, rawSum = false, full: number | null = SERVER_SCORE_CAP): string {
  if (score === null) return 'score-none';
  if (rawSum) return 'score-partial';
  if (score >= (full ?? SERVER_SCORE_CAP)) return 'score-full';
  if (score <= 0) return 'score-zero';
  return 'score-partial';
}

/** "Out of": 100, or null for raw-sum problems (one rule: scoreText in src/grader/score.ts). */
export function outOf(s: ScoreView): number | null {
  return outOfFor(s.rawSum);
}

/** Is the active file's problem raw-sum? (results and history use the same display rule). */
export const activeRawSum = () => state?.problem?.score.rawSum ?? false;

export function scorePill(s: ScoreView): HTMLElement {
  const tip =
    s.counted === null
      ? W.notAttemptedYet
      : W.scorePillTip(fmt(s.counted), outOf(s) !== null ? fmt(outOf(s)) : null, s.penaltyLabel, s.attempts);
  const full = s.counted !== null && s.rawSum ? `${tip} ${G.rawSumTip}` : tip;
  return el('span', { class: `pill score-pill ${scoreClass(s.counted, s.rawSum, outOf(s))}`, title: full, 'aria-label': full }, fmt(s.counted));
}

/** Name and subtitle without repeating the name ("104_68_1_exam2_P1: Scholarship" → subtitle "Scholarship"). */
export function titleParts(p: { name: string; fullName: string }): { name: string; subtitle: string | null } {
  const full = p.fullName.trim();
  if (!full || full === p.name) return { name: p.name, subtitle: null };
  if (full.startsWith(`${p.name}:`)) {
    const rest = full.slice(p.name.length + 1).trim();
    return { name: p.name, subtitle: rest || null };
  }
  return { name: p.name, subtitle: full };
}

/** Relative time ("3 min ago", "2 days ago"). */
export function relative(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return W.ago.justNow;
  const m = Math.round(s / 60);
  if (m < 60) return W.ago.minAgo(m);
  const h = Math.round(m / 60);
  if (h < 24) return W.ago.hoursAgo(h);
  const d = Math.round(h / 24);
  if (d < 45) return W.ago.daysAgo(d);
  return new Date(t).toLocaleDateString(dateLocale() ?? [], { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Exact local time for tooltips. */
export function exact(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(dateLocale() ?? []);
}

export const seconds = (ms: number | null) => (ms === null ? '–' : `${(ms / 1000).toFixed(ms < 10_000 ? 3 : 2)} s`);
export const megabytes = (kb: number | null) => (kb === null ? '–' : `${(kb / 1024).toFixed(2)} MB`);

// -------------------------------------------------------------- skeleton

export const app = document.getElementById('app')!;

export function section(id: string, title: string, actions: HTMLElement[] = [], collapsedByDefault = false) {
  const body = el('div', { class: 'section-body' });
  const details = el(
    'details',
    { class: 'section', id: `sec-${id}`, open: !(ui.collapsed[id] ?? collapsedByDefault) },
    el('summary', {}, icon('chevron-right', 'chev'), el('span', { class: 'section-title' }, title), el('span', { class: 'section-actions' }, ...actions)),
    body,
  );
  details.addEventListener('toggle', () => {
    ui.collapsed[id] = !details.open;
    saveUi();
  });
  for (const a of actions) a.addEventListener('click', (e) => e.preventDefault());
  return { details, body };
}

export let state: ViewState | null = null;
export const setState = (s: ViewState) => { state = s; };

export const tooltip = installTooltips(document);

/** Set by main.ts: sections ask for a re-render through these. */
export const hooks = { render: () => {}, forceRender: () => {} };
