// Opt-in real-provider tests. Never part of npm test. Synthetic human answers are explicit fixtures.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../skills/agent-outsource/scripts/db.mjs';
import { sleep } from '../skills/agent-outsource/scripts/process.mjs';
const root = path.resolve('.ai-oc/live-' + Date.now()); fs.mkdirSync(root, { recursive: true });
const cwd = path.join(root, 'workspace'); fs.mkdirSync(cwd);
const dbFile = path.join(root, 'smoke.sqlite');
const db = new Store(dbFile);
const env = { ...process.env, AI_OC_TEST_MODE: '1', AI_OC_TEST_NOTIFIER: path.resolve('test/fixtures/notifier.mjs'), AI_OC_TEST_DIR: root };
delete env.AI_OC_TEST_WORKER;
const log = fs.openSync(path.join(root, 'service.log'), 'a');
const daemon = spawn(process.execPath, ['skills/agent-outsource/scripts/bridge.mjs', 'serve', '--db', dbFile], { env, windowsHide: true, stdio: ['ignore', log, log] });
fs.closeSync(log);
const evidence = [];
const providers = process.argv.includes('--agy-only') ? ['antigravity'] : ['claude', 'antigravity'];
const record = value => { evidence.push(value); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(value)); };
let sequence = 0;
async function until(fn, timeout = 90000) {
  const started = Date.now();
  for (;;) { const result = fn(); if (result) return result; if (Date.now() - started > timeout) throw new Error('Smoke deadline exceeded'); await sleep(200); }
}
const submit = (provider, prompt, jobId, options = {}) => db.submit({ provider, caller: process.env.CODEX_THREAD_ID || 'smoke-caller', key: `smoke-${++sequence}`,
  name: `real ${provider} smoke`, cwd, prompt, jobId, options: { timeoutMs: 60000, ...options } });
const wait = id => until(() => { const r = db.get('SELECT * FROM runs WHERE id=?', id); return !['queued','running'].includes(r.status) && r; });
try {
  await until(() => db.get('SELECT * FROM daemon'), 15000);
  for (const provider of providers) {
    const first = submit(provider, 'This is a harmless no-tool test. Remember the word plum for this conversation. Report the word in your final summary.', undefined, { permission: 'manual' });
    const r1 = await wait(first.runId); record({ provider, test: 'task/result', status: r1.status, summary: r1.summary, jobId: first.jobId,
      args: JSON.parse(fs.readFileSync(path.join(`${dbFile}.logs`, first.runId, 'invocation.json'), 'utf8')).args });
    const session = db.job(first.jobId).session;
    if (r1.status === 'completed') {
      const next = submit(provider, 'What word did I ask you to remember in the previous message? Put it in your summary. No tools.', first.jobId);
      const r2 = await wait(next.runId); record({ provider, test: 'resume', status: r2.status, summary: r2.summary, sameSession: session === db.job(first.jobId).session,
        args: JSON.parse(fs.readFileSync(path.join(`${dbFile}.logs`, next.runId, 'invocation.json'), 'utf8')).args });
    }
    const ask = submit(provider, 'This is a synthetic human-question protocol test. Ask which sample label I choose, red or blue. Return waiting_user with the question. No tools. Wait for the test response; do not choose.');
    const r3 = await wait(ask.runId);
    const q = db.get("SELECT * FROM questions WHERE run_id=? AND state='pending'", ask.runId);
    if (q) {
      const res = db.answer({ caller: db.job(ask.jobId).caller, questionId: q.id, response: { text: 'blue (synthetic test fixture answer)' } });
      const r4 = await wait(res.runId || ask.runId);
      record({ provider, test: 'question/resume', mode: q.mode, status: r4.status, summary: r4.summary,
        args: JSON.parse(fs.readFileSync(path.join(`${dbFile}.logs`, res.runId || ask.runId, 'invocation.json'), 'utf8')).args });
    } else record({ provider, test: 'question/resume', status: r3.status, summary: r3.summary });
  }
  for (const kind of providers.includes('claude') ? ['question', 'auto'] : []) {
    const prompt = kind === 'question' ? 'Synthetic human-question test: use AskUserQuestion to ask which color I choose, red or blue. Wait for the supplied test answer and include it in your summary.'
      : 'Harmless bypass test: use Write to create fixture-auto.txt containing bridge smoke. Use no other tools.';
    const task = submit('claude', prompt);
    const r = await wait(task.runId);
    const q = db.get("SELECT * FROM questions WHERE run_id=? AND state='pending'", task.runId);
    if (!q) { record({ provider: 'claude', test: `native-${kind}`, status: r.status, summary: r.summary,
      fileExists: kind === 'auto' ? fs.existsSync(path.join(cwd, 'fixture-auto.txt')) : null,
      permissionEvents: db.get("SELECT count(*) AS n FROM outbox WHERE run_id=? AND kind='waiting_permission'", task.runId).n }); continue; }
    db.answer({ caller: db.job(task.jobId).caller, questionId: q.id,
      response: { text: 'blue (synthetic fixture)' } });
    const done = await until(() => { const r = db.get('SELECT * FROM runs WHERE id=?', task.runId); return !['queued','running','waiting_user','waiting_permission'].includes(r.status) && r; });
    record({ provider: 'claude', test: `native-${kind}`, mode: q.mode, status: done.status, summary: done.summary,
      fileExists: kind === 'question' ? null : fs.existsSync(path.join(cwd, `fixture-${kind}.txt`)) });
  }
  for (const provider of providers) {
    const task = submit(provider, 'No tools. Explain the history of relational databases in detail, then summarize completion.');
    await until(() => db.get('SELECT child_birth FROM runs WHERE id=?', task.runId)?.child_birth);
    db.cancel(task.jobId, db.job(task.jobId).caller);
    const r = await until(() => { const r = db.get('SELECT * FROM runs WHERE id=?', task.runId); return r.status === 'cancelled' && r; });
    record({ provider, test: 'cancel', status: r.status });
  }
} catch (error) { record({ test: 'harness', error: error.message }); process.exitCode = 1; }
finally {
  daemon.kill('SIGTERM');
  await Promise.race([new Promise(resolve => daemon.once('close', resolve)), sleep(10000)]);
  db.close(); console.log(JSON.stringify({ evidenceDirectory: root }));
}
