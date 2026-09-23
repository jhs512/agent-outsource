import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../skills/agent-outsource/scripts/db.mjs';
import { JsonLines, outcome, liveReply, providerCommand, promptMessage } from '../skills/agent-outsource/scripts/providers.mjs';
import { createHash } from 'node:crypto';
import { deliverOne, recover } from '../skills/agent-outsource/scripts/service.mjs';
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-oc-test-'));
const request = overrides => ({ caller: 'caller-a', key: 'one', name: 'safe test', cwd: process.cwd(), prompt: 'hello', provider: 'claude', ...overrides });

test('T16 idempotency, conflict, and exact caller routing', () => {
  const db = new Store(path.join(temporary(), 'test.sqlite'));
  const first = db.submit(request());
  assert.equal(db.submit(request()).jobId, first.jobId);
  assert.throws(() => db.submit(request({ prompt: 'different' })), /different content/);
  assert.throws(() => db.job(first.jobId, 'caller-b'), /wrong caller/);
  assert.equal(db.all('SELECT * FROM runs').length, 1);
  db.close();
});
test('T04/T17 durable question, duplicate answer, stale answer and caller isolation', () => {
  const db = new Store(path.join(temporary(), 'test.sqlite'));
  const { runId, jobId } = db.submit(request()); db.claim('owner');
  db.run('UPDATE jobs SET session=? WHERE id=?', 'provider-session', jobId);
  const q = db.question(runId, 'question', 'question', 'resume', { question: 'red or blue?' });
  assert.throws(() => db.answer({ caller: 'other', questionId: q, response: { text: 'blue' } }), /wrong caller/);
  const reply = { caller: 'caller-a', questionId: q, response: { text: 'blue' } };
  const resumed = db.answer(reply);
  assert.equal(db.answer(reply).duplicate, true);
  assert.throws(() => db.answer({ ...reply, response: { text: 'red' } }), /differently/);
  assert.notEqual(resumed.runId, runId);
  assert.equal(db.job(jobId).session, 'provider-session');
  assert.equal(db.all('SELECT * FROM runs').length, 2);
  db.close();
});
test('T05 historical permission replies preserve input; general questions retain human answers', () => {
  const base = { provider_id: 'request-1', kind: 'permission', payload: JSON.stringify({ input: { command: 'safe' } }) };
  assert.equal(liveReply({ ...base, answer: '{"decision":"deny"}' }).response.response.behavior, 'deny');
  assert.deepEqual(liveReply({ ...base, answer: '{"decision":"allow"}' }).response.response.updatedInput, { command: 'safe' });
  const q = { ...base, kind: 'question', payload: JSON.stringify({ input: { questions: [{ question: 'color?' }] } }), answer: '{"text":"blue"}' };
  assert.deepEqual(liveReply(q).response.response.updatedInput.answers, { 'color?': 'blue' });
});
test('mandatory bypass on every provider, new/resumed run and legacy permission value', () => {
  for (const provider of ['claude', 'antigravity']) for (const session of [null, 'existing-session']) {
    for (const permission of [undefined, 'manual', 'bypass']) {
      const command = providerCommand({ provider, session }, { options: JSON.stringify({ permission }) });
      assert.equal(command.args.filter(arg => arg === '--dangerously-skip-permissions').length, 1);
      assert.ok(!command.args.includes('--permission-mode'));
      if (session) assert.ok(command.args.includes(provider === 'claude' ? '--resume' : '--conversation'));
    }
  }
});
test('new options normalize to bypass without breaking legacy idempotency keys', () => {
  const db = new Store(path.join(temporary(), 'test.sqlite'));
  const req = request({ options: { permission: 'manual' } });
  const task = db.submit(req);
  assert.equal(JSON.parse(db.get('SELECT options FROM runs WHERE id=?', task.runId).options).permission, 'bypass');
  const legacy = { caller: req.caller, key: req.key, name: req.name, cwd: path.resolve(req.cwd), prompt: req.prompt,
    provider: req.provider, jobId: null, options: { permission: 'manual' } };
  db.run('UPDATE commands SET hash=?', createHash('sha256').update(JSON.stringify(legacy)).digest('hex'));
  assert.equal(db.submit(req).duplicate, true);
  assert.equal(db.submit(request()).duplicate, true);
  assert.throws(() => db.submit(request({ prompt: 'different' })), /different content/);
  db.close();
});
test('T19 result/notification atomic, cancellation wins, terminal result retained', () => {
  const db = new Store(path.join(temporary(), 'test.sqlite'));
  const { runId, jobId } = db.submit(request()); db.claim('owner'); db.cancel(jobId, 'caller-a');
  db.finish(runId, 'completed', 'A result raced cancellation', { actual: 'result preserved' });
  assert.equal(db.job(jobId).status, 'cancelled');
  assert.equal(db.all('SELECT * FROM outbox').length, 1);
  assert.match(db.get('SELECT result FROM runs WHERE id=?', runId).result, /preserved/);
  assert.equal(db.finish(runId, 'failed', 'late event'), false);
  assert.equal(db.all('SELECT * FROM outbox').length, 1);
  db.close();
});
test('T10/T15 notification failure preserves result, retry carries same event ID, ack is idempotent', async () => {
  const dir = temporary(), db = new Store(path.join(dir, 'test.sqlite'));
  const { runId } = db.submit(request()); db.claim('owner'); db.finish(runId, 'completed', 'work done', { value: 42 });
  process.env.AI_OC_TEST_MODE = '1'; process.env.AI_OC_TEST_NOTIFIER = path.resolve('test/fixtures/notifier.mjs'); process.env.AI_OC_TEST_DIR = dir;
  fs.writeFileSync(path.join(dir, 'fail-notify'), '1');
  await deliverOne(db);
  const first = db.get('SELECT * FROM outbox');
  assert.equal(first.state, 'retry');
  assert.equal(db.get('SELECT status FROM runs').status, 'completed');
  fs.unlinkSync(path.join(dir, 'fail-notify')); db.run('UPDATE outbox SET due=0');
  await deliverOne(db);
  assert.equal(db.get('SELECT state FROM outbox').state, 'sent');
  assert.match(fs.readFileSync(path.join(dir, 'notifications.jsonl'), 'utf8'), new RegExp(first.id));
  db.run("UPDATE outbox SET state='sending'");
  await recover(db, 'replacement-owner');
  await deliverOne(db);
  const duplicated = fs.readFileSync(path.join(dir, 'notifications.jsonl'), 'utf8').trim().split('\n');
  assert.equal(duplicated.length, 2);
  assert.ok(duplicated.every(line => line.includes(first.id)), 'uncertain delivery reuses the same event ID');
  assert.equal(db.ack(first.id, 'other').acknowledged, false);
  assert.equal(db.ack(first.id, 'caller-a').acknowledged, true);
  assert.equal(db.ack(first.id, 'caller-a').duplicate, true);
  db.close();
  delete process.env.AI_OC_TEST_MODE; delete process.env.AI_OC_TEST_NOTIFIER; delete process.env.AI_OC_TEST_DIR;
});
test('T18 oversized lines have bounded parser memory and recover at newline', () => {
  const got = []; let tooBig = 0;
  const parser = new JsonLines(e => got.push(e), () => tooBig++, 64);
  for (let i = 0; i < 1000; i++) parser.feed('x'.repeat(32));
  assert.equal(parser.buffer.length, 0); assert.equal(tooBig, 1);
  parser.feed('\n{"ok":true}\n'); assert.deepEqual(got, [{ ok: true }]);
});
test('T01 exit/result classification requires explicit task outcome', () => {
  assert.equal(outcome({ type: 'result', result: 'looks done' }, 'claude').status, 'needs_review');
  assert.equal(outcome({ event: 'result', result: { status: 'ERROR', error: 'auth failed' } }, 'antigravity').status, 'failed');
  assert.equal(outcome({ event: 'result', result: { status: 'SUCCESS', structured_output: { status: 'waiting_user', summary: 'ask', question: 'when?' } } }, 'antigravity').status, 'waiting_user');
});
test('T11/T16 concurrent SQLite WAL writes from four processes', async () => {
  const filename = path.join(temporary(), 'test.sqlite'); new Store(filename).close();
  await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['test/fixtures/concurrent.mjs', filename], { stdio: 'pipe', windowsHide: true });
    let error = ''; child.stderr.on('data', data => error += data);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
  })));
  const db = new Store(filename);
  assert.equal(db.get('PRAGMA journal_mode').journal_mode, 'wal');
  assert.equal(db.all('SELECT * FROM jobs').length, 20);
  assert.equal(db.all('SELECT * FROM runs').length, 20); db.close();
});
test('T13/T14/T15 restart retains results, does not kill reused PIDs, marks delivery uncertain', async () => {
  const db = new Store(path.join(temporary(), 'test.sqlite'));
  const { runId } = db.submit(request()); db.claim('dead-owner');
  db.run('UPDATE runs SET child_pid=123,child_birth=?,result=? WHERE id=?', 'old-identity', '{"saved":true}', runId);
  db.event(runId, 'test', { summary: 'preserved event' });
  db.run("UPDATE outbox SET state='sending'");
  let killed = false;
  await recover(db, 'new-owner', { identity: async () => 'new-identity', killTree: async () => { killed = true; } });
  assert.equal(killed, false);
  assert.equal(db.get('SELECT status FROM runs').status, 'interrupted');
  assert.equal(db.get('SELECT result FROM runs').result, '{"saved":true}');
  assert.equal(db.get("SELECT state FROM outbox WHERE kind='test'").state, 'uncertain');
  assert.equal(db.all('SELECT * FROM runs').length, 1); db.close();
});
test('historical Antigravity permission request resumes a new process with mandatory bypass', () => {
  const db = new Store(path.join(temporary(), 'test.sqlite'));
  const { runId, jobId } = db.submit(request({ provider: 'antigravity' })); db.claim('owner');
  db.run('UPDATE jobs SET session=? WHERE id=?', 'session', jobId);
  const q = db.question(runId, 'soft-denial', 'permission', 'resume', { tool: 'command' });
  const resumed = db.answer({ caller: 'caller-a', questionId: q, response: { decision: 'allow' } });
  assert.equal(resumed.mode, 'resume');
  const run = db.get('SELECT * FROM runs WHERE id=?', resumed.runId);
  assert.ok(providerCommand(db.job(jobId), run).args.includes('--dangerously-skip-permissions'));
  assert.equal(db.get('SELECT state FROM questions WHERE id=?', q).state, 'sent'); db.close();
});
test('T13 failed orphan cleanup blocks a new execution', async () => {
  const db = new Store(path.join(temporary(), 'test.sqlite'));
  const { runId, jobId } = db.submit(request()); db.claim('dead-owner');
  db.run('UPDATE runs SET child_pid=123,child_birth=? WHERE id=?', 'same-process', runId);
  db.run('UPDATE jobs SET session=? WHERE id=?', 'provider-session', jobId);
  await recover(db, 'replacement-owner', { identity: async () => 'same-process', killTree: async () => { throw new Error('Access denied'); } });
  assert.equal(db.job(jobId).status, 'recovery_blocked');
  assert.throws(() => db.submit(request({ key: 'resume', jobId })), /active run/); db.close();
});

test('agy schema and Windows guidance preserve native ERROR despite completed response', () => {
  const command = providerCommand({ provider: 'antigravity' }, {});
  assert.ok(command.args.includes('--json-schema'));
  assert.match(promptMessage('antigravity', 'read only', 'win32').message.content, /OutputEncoding/);
  assert.doesNotMatch(promptMessage('claude', 'read only', 'win32').message.content, /OutputEncoding/);
  const result = outcome({ result: { status: 'ERROR', error: 'invalid UTF-8', response: JSON.stringify({status: 'completed',summary: 'artifact verified',question: ''}) } }, 'antigravity');
  assert.equal(result.status, 'failed');
  assert.equal(result.summary, 'invalid UTF-8');
});
