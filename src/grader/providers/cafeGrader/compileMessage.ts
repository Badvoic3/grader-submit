/**
 * Where a cafe-grader compile error points in the submitted file. The grader writes the submission under its
 * own name (the problem's submission file name, else the language's default), so the name in the message can
 * differ from the user's; its own driver files are mounted at `/source_manager` (`app/engine/compiler.rb`).
 * So the first error in a file outside `/source_manager` is in the submitted file. No `vscode` import.
 */
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const ERROR_AT = /^(.+?):(\d+)(?::\d+)?:\s*(?:fatal\s+)?error\b/;
const MANAGER = '/source_manager';

export function submittedErrorLine(message: string | null | undefined): number | null {
  if (!message) return null;
  for (const raw of message.replace(ANSI, '').split(/\r?\n/)) {
    const m = ERROR_AT.exec(raw);
    if (!m) continue;
    const file = m[1].trim();
    if (file === MANAGER || file.startsWith(`${MANAGER}/`)) continue;
    const line = Number(m[2]);
    if (line > 0) return line;
  }
  return null;
}
