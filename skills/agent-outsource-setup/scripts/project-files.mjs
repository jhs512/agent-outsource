import fs from 'node:fs';
import path from 'node:path';

const start = '<!-- agent-outsource:begin -->';
const end = '<!-- agent-outsource:end -->';
const policy = `${start}
## Default delegation policy

Delegate nearly all substantive project work through the agent-outsource skill to a local Claude Code or Antigravity CLI worker: implementation, investigation, debugging, tests, reviews, and documentation. Codex coordinates scope, conveys user questions, checks results, and reports completion.

Use the user's requested worker when specified; otherwise use an available authenticated worker suited to the task. Do not ask for delegation approval for each routine task. Direct user instructions to work without delegation take precedence. Codex may handle short conversational answers, coordination, result verification, and trivial edits directly when delegation adds no value. If no worker is ready or delegation fails, report the limitation and complete feasible work directly.

Use the agent-outsource skill's project-local database and keep the same project directory for follow-ups. Workers must complete their assigned task directly and must not recursively delegate because of this default policy. Delegation does not expand the user's authorized scope. General questions requiring human judgment still wait for the user's answer.
${end}`;

function readLocal(file) {
  if (!fs.existsSync(file)) return '';
  if (!fs.lstatSync(file).isFile()) throw new Error(`Expected a regular file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}
export function prepareProjectFiles(root) {
  const agents = path.join(root, 'AGENTS.md'), ignore = path.join(root, '.gitignore');
  const original = readLocal(agents), ignored = readLocal(ignore);
  const first = original.indexOf(start), last = original.indexOf(end);
  if ((first < 0) !== (last < 0) || (first >= 0 && (last < first || original.indexOf(start, first + start.length) >= 0 || original.indexOf(end, last + end.length) >= 0))) {
    throw new Error('AGENTS.md has ambiguous agent-outsource markers; preserve it and repair the marked block.');
  }
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const block = policy.replaceAll('\n', newline);
  const updated = first < 0 ? original + (original ? (original.endsWith('\n') ? newline : newline + newline) : '') + block + newline
    : original.slice(0, first) + block + original.slice(last + end.length);
  const ignoreNewline = ignored.includes('\r\n') ? '\r\n' : '\n';
  const lines = ignored.split(/\r?\n/);
  const rules = ['/AGENTS.md', '/.agent-outsource/'];
  // Append after existing negations, once, so generated files stay ignored.
  const lastNegation = lines.findLastIndex(line => line.startsWith('!'));
  const suffix = rules.filter(rule => lines.lastIndexOf(rule) <= lastNegation);
  const nextIgnore = suffix.length ? ignored + (ignored && !ignored.endsWith('\n') ? ignoreNewline : '') + suffix.join(ignoreNewline) + ignoreNewline : ignored;
  if (nextIgnore !== ignored) fs.writeFileSync(ignore, nextIgnore);
  if (updated !== original) fs.writeFileSync(agents, updated);
  return { agents, ignore, changed: updated !== original || nextIgnore !== ignored };
}
