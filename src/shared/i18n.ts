import { EN, EN_G, EN_HOW_LINKED, EN_W, EN_W_SOURCE, G, HOW_LINKED, MATCH_SOURCE, PICK_HOW, S, type Strings, W, W_SOURCE } from './strings';
import { TH, TH_G, TH_HOW_LINKED, TH_W, TH_W_SOURCE } from './strings.th';

/**
 * Display language (setting `cedtGrader.displayLanguage`). No `vscode`
 * import: the host and both webviews call `setLanguage`, which overwrites the
 * live text tables of `strings.ts` in place, so every `S.x` / `W.x` / `G.x`
 * read afterwards is in the new language. Grader content (problem names,
 * compiler messages) is never translated.
 *
 * VS Code's own texts (command titles, settings) come from
 * `package.nls*.json` and follow VS Code's display language instead.
 */
export type Lang = 'en' | 'th';
export type LangSetting = Lang | 'auto';

/** Registered translations; a language without a table shows English. */
const TABLES: Partial<Record<Lang, Strings>> = { en: EN, th: TH };

let current: Lang = 'en';

export function registerLanguage(lang: Lang, table: Strings): void {
  TABLES[lang] = table;
}

/** `auto` ("Follow VS Code") uses VS Code's display language (`vscode.env.language`, e.g. `th`, `en-us`). */
export function resolveLang(setting: unknown, vscodeLanguage: string): Lang {
  if (setting === 'en' || setting === 'th') return setting;
  if (setting === 'auto') return /^th\b/i.test(vscodeLanguage) ? 'th' : 'en';
  return 'en';
}

function assign(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(source)) {
    const t = target[k];
    if (v && typeof v === 'object' && t && typeof t === 'object') assign(t as Record<string, unknown>, v as Record<string, unknown>);
    else target[k] = v;
  }
}

/** Switch every live text table to `lang` (English when it has no table). */
export function setLanguage(lang: Lang): void {
  const t = TABLES[lang] ?? EN;
  current = TABLES[lang] ? lang : 'en';
  const live: [unknown, unknown][] = [
    [HOW_LINKED, t.HOW_LINKED],
    [PICK_HOW, t.PICK_HOW],
    [S, t.S],
    [W, t.W],
    [W_SOURCE, t.W_SOURCE],
    [G, t.G],
    [MATCH_SOURCE, t.MATCH_SOURCE],
  ];
  for (const [target, source] of live) assign(target as Record<string, unknown>, source as Record<string, unknown>);
}

/**
 * The webviews' switch (`webview/lang.ts`): only the tables a webview shows (`W`, `W_SOURCE`, `HOW_LINKED`, and
 * `G` for the score and verdict helpers they share with the host). It names those sections directly, so a webview
 * bundle leaves the host's own texts (`S`, `PICK_HOW`, `MATCH_SOURCE`) out, in both languages.
 */
export function setWebLanguage(lang: Lang): void {
  current = lang === 'th' ? 'th' : 'en';
  const th = current === 'th';
  const live: [unknown, unknown][] = [
    [W, th ? TH_W : EN_W],
    [W_SOURCE, th ? TH_W_SOURCE : EN_W_SOURCE],
    [HOW_LINKED, th ? TH_HOW_LINKED : EN_HOW_LINKED],
    [G, th ? TH_G : EN_G],
  ];
  for (const [target, source] of live) assign(target as Record<string, unknown>, source as Record<string, unknown>);
}

export function currentLang(): Lang {
  return current;
}

/**
 * Locale for dates and times. English keeps VS Code's / the system's locale
 * (`undefined`, as before); Thai uses Thai month names with Gregorian years
 * (2 พ.ย. 2026), as the grader website shows them.
 */
export function dateLocale(lang: Lang = current): string | undefined {
  return lang === 'th' ? 'th-TH-u-ca-gregory' : undefined;
}
