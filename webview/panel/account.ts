/** Sidebar webview. The Account section: login form, server address check, logged-in line. Grader text goes in through textContent / attributes only (see main.ts). */
import '../lang'; // first: the display language is set before any element is built
import { W } from '../../src/shared/strings';
import { el, icon } from '../dom';
import { DEFAULT_BASE_URL } from '../../src/shared/constants';
import type { ViewState } from '../../src/shared/messages';
import { button, hooks, howToUseLink, iconButton, section, send, state, troubleshootingLink } from './shared';

// Persistent inputs (kept across renders so typing is never interrupted).
export const loginUser = el('input', { type: 'text', id: 'login-user', name: 'username', autocomplete: 'username', spellcheck: 'false', placeholder: W.username });
export const loginPass = el('input', { type: 'password', id: 'login-pass', name: 'password', autocomplete: 'current-password', placeholder: W.password });
export const loginRemember = el('input', { type: 'checkbox', id: 'login-remember', checked: true });
export let rememberInitialised = false;

// The server line. Every part stays in place across renders: a check's answer can arrive while the user is typing.
export let serverOpen = false;
export const setServerOpen = (v: boolean) => { serverOpen = v; };
export const checkServer = () => send({ type: 'checkServer', url: loginServer.value });
export const loginServer = el('input', {
  type: 'text',
  id: 'login-server',
  name: 'server',
  autocomplete: 'off',
  spellcheck: 'false',
  placeholder: new URL(DEFAULT_BASE_URL).host,
  onchange: checkServer,
  oninput: () => showServerStatus(),
  onkeydown: (e: Event) => {
    if ((e as KeyboardEvent).key !== 'Enter') return;
    e.preventDefault(); // Enter here checks the address; it doesn't log in
    checkServer();
  },
});
export const serverHost = el('span', { class: 'small ellipsis grow' });
export const serverLine = el('div', { class: 'row server-line' },
  el('span', { class: 'muted small' }, W.serverLine),
  serverHost,
  iconButton('edit', W.changeServer, () => {
    serverOpen = true;
    loginServer.value = state?.baseUrl ?? '';
    showServerStatus();
    loginServer.focus();
  }),
);
export const serverStatus = el('div', { class: 'server-status' });
export const serverField = el('div', { class: 'server-field' },
  el('label', { for: 'login-server' }, W.server),
  loginServer,
  serverStatus,
  el('button', { class: 'link', type: 'button', onclick: () => { loginServer.value = ''; checkServer(); showServerStatus(); } }, W.useDefaultServer),
);
export const loginSubmit = el('button', { class: 'btn primary', type: 'submit' }, icon('sign-in'), ' ', W.logIn);

/** What the host said about the address now in the field: an answer about older text isn't shown. */
export function showServerStatus(): void {
  const v = state?.account.server;
  if (v && !serverOpen && (v.status === 'bad' || v.status === 'unreachable') && v.draft !== null) {
    serverOpen = true; // an address from Settings was refused: show which one
    loginServer.value = v.draft;
  }
  serverLine.hidden = serverOpen;
  serverField.hidden = !serverOpen;
  const current = serverOpen && v?.draft === loginServer.value ? v : null;
  serverStatus.replaceChildren();
  if (current?.status === 'checking') serverStatus.append(el('div', { class: 'hint' }, icon('loading', 'codicon-modifier-spin'), ' ', W.checkingServer));
  else if (current?.status === 'ok') serverStatus.append(el('div', { class: 'hint server-ok' }, icon('check'), ' ', W.serverWorks));
  else if (current?.message) serverStatus.append(el('div', { class: 'error', role: 'alert' }, icon('error'), ' ', current.message));
  const refused = current?.status === 'bad' ? current.message : null;
  loginSubmit.disabled = !!refused;
  if (refused) loginSubmit.dataset.tip = refused;
  else delete loginSubmit.dataset.tip;
}

export const loginForm = el(
  'form',
  {
    class: 'login-form',
    onsubmit: (e: Event) => {
      e.preventDefault();
      const password = loginPass.value;
      loginPass.value = ''; // never kept in the webview
      send({ type: 'login', username: loginUser.value, password, remember: loginRemember.checked, ...(serverOpen ? { server: loginServer.value } : {}) });
    },
  },
  serverLine,
  serverField,
  el('label', { for: 'login-user' }, W.username),
  loginUser,
  el('label', { for: 'login-pass' }, W.password),
  loginPass,
  el('label', { class: 'check', for: 'login-remember' }, loginRemember, ' ', W.rememberPassword),
  loginSubmit,
);
export let showLoginForm = false;
export const setShowLoginForm = (v: boolean) => { showLoginForm = v; };

export const sAccount = section('account', W.sectionAccount);
// -------------------------------------------------------------- sections

export function renderAccount(s: ViewState): void {
  const b = sAccount.body;
  const a = s.account;
  // The form stays where it is: moving it would take the focus from whatever the user is typing in.
  const formShown = a.status === 'logged-out' && !(a.hasSavedPassword && a.username && !showLoginForm);
  if (formShown && b.contains(loginForm)) {
    for (const n of [...b.children]) {
      if (n !== loginForm) n.remove();
    }
  } else {
    b.replaceChildren();
  }
  let host = s.baseUrl;
  try {
    host = new URL(s.baseUrl).host;
  } catch {
    /* keep */
  }
  if (a.status === 'logged-in') {
    b.append(
      el('div', { class: 'row account' },
        el('span', { class: 'dot ok', 'aria-hidden': 'true' }),
        el('span', { class: 'grow account-name', title: W.userOnHost(a.fullName ? `${a.fullName} (${a.username})` : a.username, host) },
          el('strong', { class: 'ellipsis' }, a.fullName || a.username),
          el('span', { class: 'account-host' },
            el('span', { class: 'muted small ellipsis' }, a.fullName ? `${a.username} · ${host}` : host),
            iconButton('globe', W.websiteTip(host), () => send({ type: 'openGraderWebsite' })),
          ),
        ),
      ),
      el('div', { class: 'row gap account-actions' },
        button([icon('sign-out'), ' ', W.logOut], () => send({ type: 'logout' }), { title: W.logOutTip }),
      ),
    );
    return;
  }
  if (a.status === 'logging-in') {
    b.append(el('div', { class: 'row muted' }, icon('loading', 'codicon-modifier-spin'), ' ', W.loggingIn(host)));
    return;
  }
  if (a.hasSavedPassword && a.username && !showLoginForm) {
    b.append(
      el('div', { class: 'row' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), el('span', { class: 'grow ellipsis' }, W.savedLogin, ' ', el('strong', {}, a.username))),
      el('div', { class: 'row gap' },
        button([icon('sign-in'), ' ', W.logIn], () => send({ type: 'loginSaved' }), { kind: 'primary' }),
        el('button', { class: 'link', type: 'button', onclick: () => { showLoginForm = true; hooks.render(); } }, W.useAnotherAccount),
      ),
    );
  } else {
    if (!loginUser.value && a.username) loginUser.value = a.username;
    if (!rememberInitialised) {
      loginRemember.checked = a.rememberPassword;
      rememberInitialised = true;
    }
    serverHost.textContent = s.baseUrl.replace(/^https:\/\//, ''); // a plain http:// address keeps its scheme
    serverHost.dataset.tip = s.baseUrl;
    showServerStatus();
    if (!b.contains(loginForm)) b.append(loginForm);
  }
  if (a.error) b.append(el('div', { class: 'error', role: 'alert' }, icon('error'), ' ', a.error));
  b.append(el('div', { class: 'row gap account-help' }, howToUseLink(), troubleshootingLink()));
}
