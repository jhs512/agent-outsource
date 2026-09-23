import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../skills/agent-outsource/scripts/db.mjs';
import { sleep, identity } from '../skills/agent-outsource/scripts/process.mjs';
const script = path.resolve('skills/agent-outsource/scripts/bridge.mjs');
async function until(fn, timeout = 25000) {
  const start = Date.now();
  for (;;) { const result = fn(); if (result) return result; if (Date.now() - start > timeout) throw new Error('Timed out'); await sleep(100); }
}
test('service integration: both providers, routing, live replies, resume, cancellation, orphan recovery', { timeout: 120000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-oc-service-')), filename = path.join(dir, 'state.sqlite');
  const db = new Store(filename), procs = [];
  const env = { ...process.env, AI_OC_TEST_MODE: '1', AI_OC_TEST_DIR: dir,
    AI_OC_TEST_WORKER: path.resolve('test/fixtures/worker.mjs'), AI_OC_TEST_NOTIFIER: path.resolve('test/fixtures/notifier.mjs') };
  const launch = () => {
    const p = spawn(process.execPath, [script, 'serve', '--db', filename], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', chunk => fs.appendFileSync(path.join(dir, 'service.log'), chunk)); procs.push(p); return p;
  };
  t.after(async () => {
    for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM');
    await sleep(2500); db.close();
  });
  let daemon = launch();
  await until(() => db.get('SELECT * FROM daemon'));
  const second = launch(); await until(() => second.exitCode !== null);
  assert.equal(second.exitCode, 0, 'T12 duplicate daemon exits');
  let sequence = 0;
  const submit = (prompt, provider = 'claude', caller = 'caller-a', jobId) => db.submit({ provider, caller, prompt, cwd: dir, name: 'fixture', key: `req-${++sequence}`, jobId });
  const terminal = runId => until(() => { const r = db.get('SELECT * FROM runs WHERE id=?', runId); return !['queued','running','waiting_user','waiting_permission'].includes(r.status) && r; });
  const a = submit('hello'), b = submit('hello', 'antigravity', 'caller-b');
  assert.equal((await terminal(a.runId)).status, 'completed'); assert.equal((await terminal(b.runId)).status, 'completed');
  const before = db.job(b.jobId).session;
  const resumed = submit('followup', 'antigravity', 'caller-b', b.jobId);
  await terminal(resumed.runId); assert.equal(db.job(b.jobId).session, before, 'T03 same session');
  const q = submit('QUESTION_LIVE');
  const live = await until(() => db.get("SELECT * FROM questions WHERE run_id=? AND state='pending'", q.runId));
  assert.equal(live.mode, 'live'); db.answer({ caller: 'caller-a', questionId: live.id, response: { text: 'blue' } });
  assert.match((await terminal(q.runId)).result, /blue/);
  const p = submit('PERMISSION');
  assert.match((await terminal(p.runId)).result, /allow/);
  assert.equal(db.get("SELECT count(*) AS n FROM outbox WHERE run_id=? AND kind='waiting_permission'", p.runId).n, 0);
  assert.equal(db.get('SELECT state FROM questions WHERE run_id=?', p.runId).state, 'sent');
  const ended = submit('QUESTION_END', 'antigravity');
  const endedQ = await until(() => db.get("SELECT * FROM questions WHERE run_id=? AND mode='resume'", ended.runId));
  const answer = db.answer({ caller: 'caller-a', questionId: endedQ.id, response: { text: 'red' } });
  assert.equal((await terminal(answer.runId)).status, 'completed');
  const crashed = submit('CRASH'), empty = submit('EMPTY'), huge = submit('HUGE');
  assert.equal((await terminal(crashed.runId)).status, 'failed');
  assert.equal((await terminal(empty.runId)).status, 'needs_review');
  assert.notEqual((await terminal(huge.runId)).status, 'completed');
  const silent = submit('SILENT');
  await until(() => db.get('SELECT child_birth FROM runs WHERE id=?', silent.runId)?.child_birth);
  await sleep(20000); assert.equal(db.job(silent.jobId).status, 'running', 'T08 20 seconds with no output is not failure');
  db.cancel(silent.jobId, 'caller-a'); assert.equal((await terminal(silent.runId)).status, 'cancelled');
  const orphan = submit('SILENT');
  const orphanRun = await until(() => { const r = db.get('SELECT * FROM runs WHERE id=?', orphan.runId); return r.child_birth && r; });
  daemon.kill('SIGKILL'); await until(() => daemon.exitCode !== null || daemon.signalCode !== null);
  daemon = launch();
  assert.equal((await terminal(orphan.runId)).status, 'interrupted');
  assert.notEqual(await identity(orphanRun.child_pid), orphanRun.child_birth, 'T13 orphan process cleaned');
  assert.equal(db.all('SELECT * FROM runs WHERE job_id=?', orphan.jobId).length, 1, 'No automatic duplicate replay');
  await until(() => db.get("SELECT count(*) AS n FROM outbox WHERE state IN ('pending','sending','retry','uncertain')").n === 0);
  const delivered = fs.readFileSync(path.join(dir, 'notifications.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const routed = delivered.find(e => e.message.includes(b.jobId)); assert.equal(routed.caller, 'caller-b');
  const shutdownTask = submit('SILENT');
  await until(() => db.get('SELECT child_birth FROM runs WHERE id=?', shutdownTask.runId)?.child_birth);
  const owner = db.get('SELECT token FROM daemon');
  db.run("INSERT OR REPLACE INTO controls VALUES('stop',?)", owner.token);
  assert.equal((await terminal(shutdownTask.runId)).status, 'interrupted', 'Orderly cross-platform stop persists interruption');
});
test('T07 missing executable becomes durable failure with notification', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-oc-missing-')), filename = path.join(dir, 'state.sqlite');
  const db = new Store(filename);
  const task = db.submit({ provider: 'claude', caller: 'caller', key: 'missing', name: 'missing executable', cwd: dir, prompt: 'no execution expected' });
  const env = { ...process.env, AI_OC_CLAUDE: path.join(dir, 'missing.exe'), AI_OC_TEST_MODE: '1',
    AI_OC_TEST_NOTIFIER: path.resolve('test/fixtures/notifier.mjs'), AI_OC_TEST_DIR: dir };
  delete env.AI_OC_TEST_WORKER;
  const daemon = spawn(process.execPath, [script, 'serve', '--db', filename], { env, windowsHide: true, stdio: 'ignore' });
  try {
    await until(() => db.job(task.jobId).status === 'failed');
    assert.match(db.job(task.jobId).summary, /ENOENT/);
    assert.equal(db.all('SELECT * FROM outbox').length, 1);
  } finally { daemon.kill('SIGTERM'); await sleep(1000); db.close(); }
});
