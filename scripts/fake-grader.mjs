// A local stand-in for a cafe-grader-web server, for development: the JSON API (token login) and the cookie web pages
// the extension reads (/main/list, a problem page). Synthetic data only; it never talks to a real grader.
//
//   npm run fake-grader                    → http://127.0.0.1:9590, password `demo` (any username)
//   node scripts/fake-grader.mjs --port 9600 --pdf statement.pdf
//
// Point an isolated VS Code at it with the user setting "cedtGrader.baseUrl": "http://127.0.0.1:9590". From a script:
// `import { startFakeGrader } from './scripts/fake-grader.mjs'`, then `const g = await startFakeGrader({ port: 0 })`.
//
// Problems (shapes follow test/fakeServer.ts and the real API):
//  41 hw_double   test cases (n → 2n), a PDF statement with a sample table, C++ only, two old submissions. A submission
//                 grades after two polls or 8 s: `@` or `#error` in the source fails to compile at line 1; `* 2` scores
//                 100; anything else 50.
//  42 hw_twin     no submissions.             43 pkg_student  zip attachment (student.h + main.cpp, and junk to skip).
//  44 hw_single   one .cpp attachment.        45 hw_text      description only (markdown).
//  46 hw_hidden   statement refused (403).    47 hw_raw       raw-sum score on /main/list (137.5).
//  48–67          hw_fill_2 … hw_fill_21, scores 0 / 60 / 100 / none, for sorting and filters.
//
// Switches, for tests: GET /__log (request lines), GET /__subs (each submission's file and source end);
// POST /__offline, /__online (every route becomes a reset socket, and back), /__expire (every API token expires now),
// /__exam/on, /__exam/off (/main/list shows a running contest's countdown).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

/** A one-page statement: a sentence and a ruled Input / Output table with two cases (3 / 1 2 3 → 6 and 1 / 5 → 5). */
export function statementPdf() {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const T = (str, x, y, f) => `BT /${f} 11 Tf ${x} ${y} Td (${esc(str)}) Tj ET`;
  const xs = [50, 250, 450], ys = [700, 680, 630, 595];
  const rules = [...ys.map((y) => `${xs[0]} ${y - 0.25} ${xs[2] - xs[0]} 0.5 re f`), ...xs.map((x) => `${x - 0.25} ${ys[3]} 0.5 ${ys[0] - ys[3]} re f`)];
  const content = ['q 0 0 0 rg', ...rules, 'Q',
    T('Write a program that adds the numbers.', 50, 760, 'F1'), T('Input', 60, 686, 'F1'), T('Output', 260, 686, 'F1'),
    T('3', 60, 665, 'F2'), T('1 2 3', 60, 652, 'F2'), T('6', 260, 665, 'F2'),
    T('1', 60, 615, 'F2'), T('5', 60, 602, 'F2'), T('5', 260, 615, 'F2')].join('\n') + '\n';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
  ];
  let out = '%PDF-1.5\n';
  const at = objs.map((o, i) => { const pos = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return pos; });
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${out.length}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Start the fake grader; resolves once it listens. `port: 0` picks a free one. */
export function startFakeGrader({ port = 9590, host = '127.0.0.1', pdf = statementPdf(), password = 'demo', quiet = true } = {}) {
  const log = [];
  let offline = false;
  let exam = false;
  const tokens = new Set();
  const web = new Set();
  const T = '2026-11-10T10:00:00+07:00';
  const P = (id, name, extra = {}) => ({ id, name, full_name: extra.full_name ?? name.replace(/_/g, ' '), difficulty: null, tags: [], submission_count: 0, best_score: null, last_score: null, last_result: null, last_submission_time: null, last_submission_id: null, has_testcase: false, has_attachment: false, permitted_languages: null, ...extra });
  const scored = (n, s, id) => ({ submission_count: n, best_score: s, last_score: s, last_result: 'done', last_submission_time: T, last_submission_id: id });
  const CPP = [{ id: 2, name: 'cpp', ext: 'cpp' }];
  // Submissions per problem, newest first.
  const subs = { 41: [
    { id: 9002, number: 2, language: 'cpp', submitted_at: '2026-11-12T09:00:00+07:00', points: 0, status: 'compilation_error', grader_comment: 'Compilation error', source: 'int main( {\n', file: 'hw_double.cpp', ce: "/source/main.cpp:1:10: error: expected ')' before '{' token\n" },
    { id: 9001, number: 1, language: 'cpp', submitted_at: '2026-11-11T09:00:00+07:00', points: 70, status: 'done', grader_comment: '[PP][P-]', source: '// v1\n', file: 'hw_double.cpp' },
  ] };
  let nextId = 9100;
  const pending = new Map(); // id → polls left before it is graded
  const problems = () => {
    const best = (id) => { const s = subs[id] ?? []; const pts = s.map((x) => x.points ?? 0); return s.length ? { submission_count: s.length, best_score: Math.max(...pts), last_score: s[0].points ?? 0, last_result: s[0].grader_comment, last_submission_time: s[0].submitted_at, last_submission_id: s[0].id } : {}; };
    const fills = Array.from({ length: 20 }, (_, i) => P(48 + i, `hw_fill_${i + 2}`, { tags: i % 3 ? ['Loops'] : i % 2 ? ['Arrays', 'Math'] : ['Arrays'], ...([null, 0, 60, 100][i % 4] === null ? {} : scored(1, [null, 0, 60, 100][i % 4], 9500 + i)) }));
    return [
      P(41, 'hw_double', { full_name: 'Double the number', tags: ['Recursion', 'Loops', 'Math'], has_testcase: true, permitted_languages: CPP, ...best(41) }),
      P(42, 'hw_twin', { tags: ['Loops'] }),
      P(43, 'pkg_student', { has_attachment: true, tags: ['Arrays'] }),
      P(44, 'hw_single', { has_attachment: true }),
      P(45, 'hw_text', { full_name: 'Text statement' }),
      P(46, 'hw_hidden'),
      P(47, 'hw_raw', scored(1, 137.5, 9400)),
      ...fills,
    ];
  };
  const zip = () => zipSync({
    'student.h': strToU8('int twice(int a) { return a * 2; }\n'),
    'main.cpp': strToU8('#include <iostream>\n#include "student.h"\nint main() { int a; std::cin >> a; std::cout << twice(a) << "\\n"; }\n'),
    '__MACOSX/._main.cpp': strToU8('junk'), '.DS_Store': strToU8('junk'), 'run.exe': strToU8('MZ'), 'notes.pdf': strToU8('%PDF-1.4\n'),
  });
  const evals = (pts) => [601, 602, 603, 604].map((tid, i) => ({ testcase_id: tid, result: pts === 100 || i < 2 ? 'correct' : 'wrong', score: pts === 100 || i < 2 ? 1 : 0, time: 12 + i, memory: 3000 + i }));
  const detail = (pid, s) => ({ id: s.id, problem_id: pid, problem_name: problems().find((p) => p.id === pid)?.name, user_id: 1, language: s.language, source: s.source, source_filename: s.file, submitted_at: s.submitted_at, number: s.number, status: s.status, points: s.points, grader_comment: s.grader_comment, compiler_message: s.ce ?? null, max_runtime: s.status === 'done' ? 15 : null, peak_memory: s.status === 'done' ? 3003 : null, evaluations: s.status === 'done' ? evals(s.points) : [] });
  const listHtml = () => `<!DOCTYPE html><html><head><meta name="csrf-token" content="x" /></head><body>${exam ? `<script>const contestEndTime = Date.parse('2099-01-01T00:00:00+07:00')</script><span id="countdown">3600s</span>` : ''}
<div><span class="topic-badge" data-bs-title="Problems solved with recursion">Recursion</span> <span class="topic-badge" data-bs-title="Loops and counting">Loops</span></div>
<table class="table" id="main_table"><tbody>${problems().map((p) => `<tr><td>${p.id}</td><td><strong>${p.full_name}</strong><div class="text-muted font-monospace">${p.name}</div></td><td style="width: 12em" data-order="${p.best_score ?? 0}">${p.id === 47 ? '<span class="fw-semibold">137.5</span>' : p.best_score === null ? '' : `<div class="progress rounded-pill"><div class="progress-bar" style="width: ${p.best_score}%">${p.best_score}</div><div class="progress-bar bg-danger" style="width: 0%">0</div></div><div><small></small></div><div><small></small></div>`}</td><td>-</td><td><a href="/submissions/direct_edit_problem/${p.id}">New</a></td></tr>`).join('\n')}</tbody></table></body></html>`;
  const loginHtml = '<!DOCTYPE html><html><head><meta name="csrf-param" content="authenticity_token" /><meta name="csrf-token" content="x" /></head><body><form action="/login/login" method="post"><input type="hidden" name="authenticity_token" value="x" /><input type="text" name="login" /><input type="password" name="password" /><input type="submit" name="commit" value="Login" /></form></body></html>';
  const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString('utf8'))); });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const p = url.pathname; const m = req.method;
    if (p === '/__log') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(log.join('\n') + '\n'); }
    if (p === '/__subs') return json(res, 200, Object.fromEntries(Object.entries(subs).map(([k, v]) => [k, v.map((x) => ({ id: x.id, file: x.file, end: String(x.source).slice(-60) }))])));
    if (p === '/__offline') { offline = true; return json(res, 200, {}); }
    if (p === '/__online') { offline = false; return json(res, 200, {}); }
    if (p === '/__expire') { tokens.clear(); return json(res, 200, {}); }
    if (p === '/__exam/on' || p === '/__exam/off') { exam = p.endsWith('on'); return json(res, 200, {}); }
    log.push(`${m} ${p}`);
    if (!quiet) console.log(`${m} ${p}`);
    if (offline) return req.socket.destroy();
    const raw = await body(req);
    if (m === 'POST' && p === '/api/v1/auth/login') {
      const b = JSON.parse(raw || '{}');
      if (b.password !== password) return json(res, 401, { error: 'Invalid login or password' });
      const t = `tok${tokens.size + 1}`; tokens.add(t);
      return json(res, 200, { token: t, expires_at: '2099-01-01T00:00:00Z', user: { id: 1, login: b.login, full_name: 'Demo Student' } });
    }
    if (!p.startsWith('/api/')) {
      const sid = /_cafe_grader_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      const html = (h, extra = {}) => { res.writeHead(200, { 'content-type': 'text/html', ...extra }); res.end(h); };
      // Relative redirects: right whichever address the client used (127.0.0.1, 0.0.0.0, a name).
      const go = (to, extra = {}) => { res.writeHead(302, { location: to, ...extra }); res.end(); };
      if (m === 'GET' && (p === '/' || p === '/main/login')) return sid && web.has(sid) && p === '/' ? go('/main/list') : html(loginHtml);
      if (m === 'POST' && p === '/login/login') {
        if (new URLSearchParams(raw).get('password') !== password) return go('/main/login');
        const s = `w${web.size + 1}`; web.add(s); return go('/main/list', { 'set-cookie': `_cafe_grader_session=${s}; path=/` });
      }
      if (m === 'GET' && p === '/main/list') return sid && web.has(sid) ? html(listHtml()) : go('/main/login');
      if (m === 'GET' && /^\/submissions\/direct_edit_problem\/\d+$/.test(p)) return sid && web.has(sid) ? html('<div class="row"><div class="col-md-6"><em>\nLimit:\n1\n<span class="text-body-tertiary">s</span>,\n<span>256</span>\n<span class="text-body-tertiary">MB</span>\n</em></div></div>') : go('/main/login');
      res.writeHead(404); return res.end('not found');
    }
    const auth = req.headers.authorization?.split(' ').pop();
    if (!auth || !tokens.has(auth)) return json(res, 401, { error: 'Token has expired' });
    if (p === '/api/v1/problems') return json(res, 200, problems());
    if (p === '/api/v1/languages') return json(res, 200, [{ id: 1, name: 'c', pretty_name: 'C', ext: 'c' }, { id: 2, name: 'cpp', pretty_name: 'C++', ext: 'cpp' }, { id: 6, name: 'python', pretty_name: 'Python', ext: 'py' }]);
    let r = /^\/api\/v1\/problems\/(\d+)(?:\/(.*))?$/.exec(p);
    if (r) {
      const id = Number(r[1]); const rest = r[2] ?? ''; const pr = problems().find((x) => x.id === id);
      if (!pr) return json(res, 404, { error: 'Problem not found' });
      if (rest === '') return json(res, 200, { ...pr, full_score: 100, submission_ids: (subs[id] ?? []).map((s) => s.id) });
      if (rest === 'files/pdf') {
        if (id === 46) return json(res, 403, { error: 'PDF statement not available for this problem' });
        if (id === 45 || !pdf) return json(res, 404, { error: 'PDF statement not found' });
        res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end(pdf);
      }
      if (rest === 'description') {
        if (id === 45) return json(res, 200, { markdown: true, description: '# Text statement\n\nRead **n**, print `2n`.\n\n<script>alert(1)</script>' });
        return json(res, id === 46 ? 403 : 404, { error: 'Description not available for this problem' });
      }
      if (rest === 'files/attachment') {
        if (id === 43) { const z = zip(); res.writeHead(200, { 'content-type': 'application/zip', 'content-length': z.length, 'content-disposition': 'attachment; filename="pkg_student.zip"' }); return res.end(Buffer.from(z)); }
        if (id === 44) { const b = Buffer.from('#include <iostream>\nint main() { return 0; }\n'); res.writeHead(200, { 'content-type': 'text/x-c++src', 'content-length': b.length, 'content-disposition': 'attachment; filename="template.cpp"' }); return res.end(b); }
        return json(res, 404, { error: 'Attachment not found' });
      }
      if (rest === 'testcases') return id === 41 ? json(res, 200, [601, 602, 603, 604].map((t, i) => ({ id: t, num: i + 1, group: i < 2 ? 1 : 2, group_name: String(i < 2 ? 1 : 2), weight: 1, access: 'preview', input_bytes: 2, sol_bytes: 2 }))) : json(res, 403, { error: 'You are not allowed to view testcases for this problem' });
      if (rest === 'submissions' && m === 'GET') return json(res, 200, (subs[id] ?? []).map(({ source, file, ce, final, ...s }) => s));
      if (rest === 'submissions' && m === 'POST') {
        const b = JSON.parse(raw || '{}');
        const src = String(b.source ?? '');
        const list = (subs[id] ??= []);
        const s = { id: ++nextId, number: list.length + 1, language: 'cpp', submitted_at: new Date().toISOString(), points: null, status: 'submitted', grader_comment: null, source: src, file: String(b.filename ?? 'main.cpp'), final: /@|#error|<< }/.test(src) ? 'ce' : /\* 2/.test(src) ? 100 : 50 };
        list.unshift(s); pending.set(s.id, 2);
        return json(res, 201, { id: s.id, number: s.number, status: 'submitted' });
      }
      return json(res, 404, { error: 'not found' });
    }
    r = /^\/api\/v1\/submissions\/(\d+)$/.exec(p);
    if (r) {
      const id = Number(r[1]);
      for (const [pid, list] of Object.entries(subs)) {
        const s = list.find((x) => x.id === id); if (!s) continue;
        if (pending.has(id)) {
          const left = pending.get(id);
          // Graded after two polls, or 8 s after it was sent (so a stopped poll finds it graded later, as on the real grader).
          if (left > 0 && Date.now() - Date.parse(s.submitted_at) < 8000) { pending.set(id, left - 1); s.status = 'grading'; }
          else {
            pending.delete(id);
            if (s.final === 'ce') Object.assign(s, { status: 'compilation_error', points: 0, grader_comment: 'Compilation error', ce: "/source/main.cpp:1:1: error: stray '@' in program\n" });
            else Object.assign(s, { status: 'done', points: s.final, grader_comment: s.final === 100 ? '[PP][PP]' : '[PP][--]' });
          }
        }
        const { final, ...shown } = s;
        return json(res, 200, detail(Number(pid), shown));
      }
      return json(res, 404, { error: 'not found' });
    }
    const tc = /^\/api\/v1\/testcases\/(60[1-4])\/(input|sol)$/.exec(p);
    if (tc) { const n = Number(tc[1]) - 600; res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(tc[2] === 'input' ? `${n}\n` : `${n * 2}\n`); }
    return json(res, 404, { error: 'not found' });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const at = server.address().port;
      resolve({ url: `http://${host}:${at}`, port: at, log, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const g = await startFakeGrader({ port: Number(arg('port') ?? 9590), pdf: arg('pdf') ? readFileSync(arg('pdf')) : undefined, quiet: false });
  console.log(`fake grader on ${g.url} (password: demo). Set "cedtGrader.baseUrl": "${g.url}" in an isolated VS Code's user settings. Ctrl+C stops it.`);
}
