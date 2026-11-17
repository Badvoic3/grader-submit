/** Sidebar webview. The bars above the sections: connection banner, inline question, crash report. Grader text goes in through textContent / attributes only (see main.ts). */
import '../lang'; // first: the display language is set before any element is built
import { W } from '../../src/shared/strings';
import { appendChildren, el, icon } from '../dom';
import type { ViewState } from '../../src/shared/messages';
import { sCurrent } from './current';
import { button, send, troubleshootingLink } from './shared';

export const banner = el('div', { class: 'banner', role: 'alert', hidden: true });
export const promptBar = el('div', { class: 'prompt', role: 'status', hidden: true });
export const crashBar = el('div', { class: 'crash', role: 'status', hidden: true });

/** A question about submitting goes right above the Submit button (when Current problem is shown). */
export function promptNearSubmit(s: ViewState): boolean {
  return s.prompt?.near === 'submit' && !sCurrent.details.hidden;
}

/** The contents of an inline question: text, detail, plain buttons. */
export function fillPrompt(box: HTMLElement, q: NonNullable<ViewState['prompt']>): void {
  box.className = `prompt notice${q.tone === 'warn' ? ' warn' : ''}`;
  appendChildren(box, [
    el('div', { class: 'row' }, icon(q.tone === 'warn' ? 'warning' : 'info'), el('span', { class: 'grow' }, q.text)),
    q.detail ? el('p', { class: 'small muted' }, q.detail) : null,
    el('div', { class: 'row gap' }, ...q.buttons.map((b) => button(b.label, () => send({ type: 'promptAnswer', id: q.id, button: b.id }), { kind: b.primary ? 'primary' : 'secondary' }))),
  ]);
}

/** Inline question with plain buttons (instead of a modal dialog), under the banner. */
export function renderPrompt(s: ViewState): void {
  const q = promptNearSubmit(s) ? null : s.prompt;
  promptBar.hidden = !q;
  promptBar.replaceChildren();
  if (q) fillPrompt(promptBar, q);
}

/** A bug was caught: the exact report, and the choice to open it on GitHub. Its own card, so it never cancels an open question. */
export function renderCrash(s: ViewState): void {
  const c = s.crash;
  crashBar.hidden = !c;
  crashBar.replaceChildren();
  if (!c) return;
  appendChildren(crashBar, [
    el('div', { class: 'row' }, icon('warning'), el('strong', { class: 'grow' }, W.crashTitle)),
    el('p', { class: 'small' }, W.crashNote),
    el('pre', { class: 'crash-report', tabindex: '0', 'aria-label': W.crashReportLabel }, c.report),
    el('div', { class: 'row gap' },
      button(W.crashReport, () => send({ type: 'crashAction', id: c.id, action: 'open' }), { kind: 'primary' }),
      button(W.notNow, () => send({ type: 'crashAction', id: c.id, action: 'dismiss' })),
    ),
  ]);
}

/** The question shown above Submit that was last scrolled into view (only new ones are). */
export let revealedPrompt: number | null = null;
export const setRevealedPrompt = (v: number | null) => { revealedPrompt = v; };

/** One banner for connection problems, with Retry (or Log in). Cached data stays visible below it. */
export function renderBanner(s: ViewState): void {
  const c = s.connection;
  banner.hidden = !c;
  banner.replaceChildren();
  if (!c) return;
  banner.className = `banner banner-${c.kind}`;
  appendChildren(banner, [
    el('div', { class: 'row' },
      icon(c.kind === 'session' ? 'account' : c.kind === 'offline' ? 'debug-disconnect' : 'warning'),
      el('strong', { class: 'grow' }, c.title),
      button(c.action === 'login' ? [icon('sign-in'), ' ', W.logIn] : [icon('refresh'), ' ', W.retry], () => send({ type: 'retry' }), { kind: 'primary' }),
    ),
    el('p', {}, c.message),
    (s.problems.loaded || s.history.items.length > 0) && el('p', { class: 'small muted' }, W.showingSavedData),
    el('div', { class: 'row' }, troubleshootingLink()),
  ]);
}
