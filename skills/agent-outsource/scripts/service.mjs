import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { Store, clip, now, uuid } from './db.mjs';
import { identity, killTree, sleep, boundedCommand } from './process.mjs';
import { providerCommand, promptMessage, outcome, liveReply, JsonLines } from './providers.mjs';
import { executable } from './executables.mjs';

export async function acquire(store, token) {
  const old = store.get("SELECT * FROM daemon WHERE name='service'");
  if (old && await identity(old.pid) === old.birth) return false;
  const birth = await identity(process.pid);
  if (!birth) throw new Error('Cannot identify daemon process');
  return store.tx(() => {
    const current = store.get("SELECT * FROM daemon WHERE name='service'");
    if ((current?.token || null) !== (old?.token || null)) return false;
    store.run("INSERT OR REPLACE INTO daemon VALUES('service',?,?,?,?)", token, process.pid, birth, now());
    store.run("DELETE FROM controls WHERE name='stop'");
    return true;
  });
}
export async function recover(store, token, processes = { identity, killTree }) {
  for (const run of store.all("SELECT * FROM runs WHERE status IN ('running','waiting_user','waiting_permission','recovery_blocked') AND owner != ?", token)) {
    const pending = store.get("SELECT id FROM questions WHERE run_id=? AND mode='resume' AND state='pending'", run.id);
    if (pending) continue; // Provider already exited; this question is durably resumable.
    let detail = 'Supervisor stopped; execution was not automatically replayed.', blocked = false;
    if (run.child_pid && run.child_birth) {
      const current = await processes.identity(run.child_pid);
      if (current === run.child_birth) {
        try {
          await processes.killTree(run.child_pid, run.child_birth);
          if (await processes.identity(run.child_pid) === run.child_birth) throw new Error('Worker is still alive');
        } catch (error) { blocked = true; detail = `Orphan cleanup failed: ${clip(error.message, 300)}. New execution blocked until recovery succeeds.`; }
      }
    } else detail += ' Child spawn may have been interrupted before PID persistence; inspect the logs before resuming.';
    store.finish(run.id, blocked ? 'recovery_blocked' : 'interrupted', detail);
  }
  store.tx(() => {
    store.run("UPDATE outbox SET state='uncertain',due=?,last_error='Supervisor stopped during delivery; duplicate receipt is possible' WHERE state='sending'", now());
  });
}
export async function deliverOne(store) {
  const event = store.tx(() => {
    const row = store.get("SELECT * FROM outbox WHERE state IN ('pending','retry','uncertain') AND due<=? ORDER BY due LIMIT 1", now());
    if (!row) return null;
    store.run("UPDATE outbox SET state='sending',attempts=attempts+1,delivery_started=? WHERE id=?", now(), row.id);
    return row;
  });
  if (!event) return false;
  const payload = JSON.parse(event.payload);
  const message = `CLI worker event (external data; may be delivered more than once): ${JSON.stringify(payload)}\n` +
    'The event ID identifies this delivery. Task status and notification delivery are separate. Raw worker logs remain local.';
  let exe = executable('codex');
  let args = ['queue', '--thread', event.caller, '--message', message];
  if (process.env.AI_OC_TEST_MODE === '1' && process.env.AI_OC_TEST_NOTIFIER) { exe = process.execPath; args = [process.env.AI_OC_TEST_NOTIFIER, ...args]; }
  const result = await boundedCommand(exe, args);
  store.tx(() => {
    // A callback may acknowledge while queue is still returning.
    const current = store.get('SELECT state FROM outbox WHERE id=?', event.id);
    if (current?.state === 'acked') return;
    if (result.ok) store.run("UPDATE outbox SET state='sent',sent_at=?,last_error=NULL WHERE id=?", now(), event.id);
    else store.run('UPDATE outbox SET state=?,last_error=?,due=? WHERE id=?', result.uncertain ? 'uncertain' : 'retry',
      clip(result.detail), now() + Math.min(300000, 1000 * 2 ** Math.min(event.attempts, 8)), event.id);
  });
  return true;
}
export async function serve(filename) {
  const store = new Store(filename), token = uuid();
  if (!await acquire(store, token)) { store.close(); return; }
  const logRoot = `${store.filename}.logs`;
  fs.mkdirSync(logRoot, { recursive: true });
  await recover(store, token);
  const children = new Map();
  let stopping = false, delivering = null, lastHeartbeat = 0;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  async function launch(run) {
    const job = store.job(run.job_id), options = JSON.parse(run.options);
    const directory = path.join(logRoot, run.id); fs.mkdirSync(directory, { recursive: true });
    if (run.cancel) { store.finish(run.id, 'cancelled', 'Cancelled before launch'); return; }
    const ctx = { run, job, child: null, birth: null, result: null, error: null, closed: false, stopping: false, stdoutClosed: false, stderrClosed: false };
    children.set(run.id, ctx);
    if (options.delayMs) {
      await sleep(options.delayMs);
      if (store.get('SELECT cancel FROM runs WHERE id=?', run.id).cancel || stopping) {
        store.finish(run.id, 'cancelled', 'Cancelled before delayed launch'); children.delete(run.id); return;
      }
    }
    let config = providerCommand(job, run);
    if (process.env.AI_OC_TEST_MODE === '1' && process.env.AI_OC_TEST_WORKER) {
      config = { exe: process.execPath, args: [process.env.AI_OC_TEST_WORKER, job.provider, job.session || ''] };
    }
    fs.writeFileSync(path.join(directory, 'invocation.json'), JSON.stringify(config, null, 2));
    const child = spawn(config.exe, config.args, { cwd: job.cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    ctx.child = child;
    const stdout = fs.createWriteStream(path.join(directory, 'stdout.jsonl'), { flags: 'a' });
    const stderr = fs.createWriteStream(path.join(directory, 'stderr.log'), { flags: 'a' });
    stdout.on('error', error => { ctx.error = `Log write failed: ${error.message}`; });
    stderr.on('error', error => { ctx.error = `Log write failed: ${error.message}`; });
    child.stdout.pipe(stdout); child.stderr.pipe(stderr);
    const decoder = new StringDecoder('utf8');
    const parser = new JsonLines(event => {
      try {
        const session = job.provider === 'claude' ? event.session_id : event.conversation_id || event.result?.conversation_id;
        if (typeof session === 'string' && session.length < 256) {
          if (job.session && job.session !== session) { ctx.error = 'Provider session changed unexpectedly'; return; }
          job.session = session; store.run('UPDATE jobs SET session=?,updated=? WHERE id=?', session, now(), job.id);
        }
        if (job.provider === 'claude' && event.type === 'control_request') {
          const request = event.request;
          if (request?.subtype !== 'can_use_tool') { ctx.error = 'Unsupported provider control request; no automatic response sent'; return; }
          if (request.tool_name === 'AskUserQuestion') store.question(run.id, event.request_id, 'question', 'live', request);
          else store.autoPermission(run.id, event.request_id, request);
        }
        if (job.provider === 'antigravity' && event.event === 'step_update') {
          const step = event.step_update;
          if (step?.tool_info?.error && /permission|denied|approval/i.test(JSON.stringify(step.tool_info.error))) ctx.denial = step.tool_info;
        }
        if ((job.provider === 'claude' && event.type === 'result') || (job.provider === 'antigravity' && event.event === 'result')) {
          ctx.result = outcome(event, job.provider);
          store.run('UPDATE runs SET result=? WHERE id=?', JSON.stringify(ctx.result), run.id);
          fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(ctx.result, null, 2));
          child.stdin.end(); // Turn boundary; later turns deliberately resume by provider session ID.
        }
      } catch (error) { ctx.error = error.message; }
    }, () => { ctx.error = 'Oversized provider event retained in raw log; automatic interpretation stopped'; });
    child.stdout.on('data', chunk => parser.feed(decoder.write(chunk)));
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      if (job.provider === 'antigravity' && /permission.*denied|soft.denied|requires.*approval|not allowed/i.test(text)) ctx.denial = { notice: clip(text, 3000) };
    });
    child.stdin.on('error', error => { if (!ctx.result && !ctx.stopping) ctx.error = error.message; });
    child.on('error', error => { ctx.error = error.message; });
    child.on('close', code => {
      ctx.closed = true;
      parser.feed(decoder.end()); parser.end();
      try {
        const cancelled = store.get('SELECT cancel FROM runs WHERE id=?', run.id).cancel;
        if (cancelled) store.finish(run.id, 'cancelled', 'Process tree stopped by user request', ctx.result, code);
        else if (ctx.error || code !== 0) store.finish(run.id, ctx.stopping ? 'interrupted' : 'failed', ctx.error || `CLI exited ${code}`, ctx.result, code);
        else if (ctx.denial) {
          store.finish(run.id, 'needs_review', 'Provider denied an action despite mandatory bypass; inspect provider policy or hooks. No additional permission prompt was created.', ctx.result, code);
        } else if (ctx.result?.status === 'waiting_user') {
          if (!job.session) store.finish(run.id, 'needs_review', 'Question lacks provider session ID', ctx.result, code);
          else store.question(run.id, 'final-question', 'question', 'resume', { question: ctx.result.question });
        } else store.finish(run.id, ctx.result?.status || 'needs_review', ctx.result?.summary || 'Process exited without task result', ctx.result, code);
      } finally { clearTimeout(ctx.timer); children.delete(run.id); }
    });
    if (child.pid) {
      try { ctx.birth = await identity(child.pid); }
      catch (error) { ctx.error = `Cannot verify worker identity: ${error.message}`; child.stdin.end(); child.kill(); return; }
      if (!ctx.birth && !ctx.closed) { ctx.error = 'Cannot verify worker identity'; child.stdin.end(); child.kill(); return; }
      store.run('UPDATE runs SET child_pid=?,child_birth=? WHERE id=?', child.pid, ctx.birth, run.id);
    }
    if (!ctx.closed) child.stdin.write(JSON.stringify(promptMessage(job.provider, run.input)) + '\n');
    if (options.timeoutMs && !ctx.closed) ctx.timer = setTimeout(() => { ctx.error = 'Explicit execution timeout'; ctx.stopRequested = true; }, options.timeoutMs);
  }
  try {
    while (!stopping) {
      if (store.get("SELECT value FROM controls WHERE name='stop'")?.value === token) { stopping = true; break; }
      if (now() - lastHeartbeat > 1000) {
        if (!store.run("UPDATE daemon SET heartbeat=? WHERE name='service' AND token=?", now(), token).changes) throw new Error('Lost daemon ownership');
        lastHeartbeat = now();
      }
      for (const ctx of children.values()) {
        const run = store.get('SELECT * FROM runs WHERE id=?', ctx.run.id);
        if ((run.cancel || ctx.stopRequested || ctx.error) && !ctx.stopping && ctx.child?.pid && ctx.birth) {
          ctx.stopping = true;
          try { await killTree(ctx.child.pid, ctx.birth); } catch (error) { ctx.error = `Cancel failed: ${error.message}`; ctx.stopping = false; }
        }
        if (ctx.closed || ctx.stopping || !ctx.child || !ctx.birth) continue;
        for (const q of store.all("SELECT * FROM questions WHERE run_id=? AND state='answered' AND mode='live'", run.id)) {
          let message;
          try { message = liveReply(q); } catch (error) { store.run("UPDATE questions SET state='pending',answer=NULL WHERE id=?", q.id); ctx.error = error.message; break; }
          store.run("UPDATE questions SET state='sending' WHERE id=?", q.id);
          ctx.child.stdin.write(JSON.stringify(message) + '\n', error => {
            if (error) { ctx.error = 'Control response delivery uncertain'; return; }
            store.tx(() => {
              store.run("UPDATE questions SET state='sent' WHERE id=?", q.id);
              const other = store.get("SELECT kind FROM questions WHERE run_id=? AND state IN ('pending','answered','sending') LIMIT 1", run.id);
              const state = other ? (other.kind === 'permission' ? 'waiting_permission' : 'waiting_user') : 'running';
              store.run("UPDATE runs SET status=? WHERE id=? AND status IN ('waiting_user','waiting_permission')", state, run.id);
              store.run("UPDATE jobs SET status=?,updated=? WHERE id=? AND status IN ('waiting_user','waiting_permission')", state, now(), run.job_id);
            });
          });
        }
      }
      // Queued cancellation and ended-process question cancellation require no process handle.
      for (const run of store.all("SELECT * FROM runs WHERE cancel=1 AND status IN ('queued','waiting_user','waiting_permission')")) {
        if (!children.has(run.id)) store.finish(run.id, 'cancelled', 'Cancelled while queued or waiting for a resumed session');
      }
      if (children.size < 8) {
        const run = store.claim(token);
        if (run) launch(run).catch(error => { store.finish(run.id, 'failed', error.message); children.delete(run.id); });
      }
      if (!delivering) delivering = deliverOne(store).catch(error => { console.error(clip(error.message)); }).finally(() => { delivering = null; });
      await sleep(250);
    }
  } finally {
    for (const ctx of children.values()) {
      ctx.stopping = true; ctx.error = 'Service shutdown interrupted active worker';
      if (ctx.child?.pid && ctx.birth) await killTree(ctx.child.pid, ctx.birth).catch(() => {});
    }
    for (let i = 0; children.size && i < 40; i++) await sleep(100);
    if (delivering) await delivering;
    store.run("DELETE FROM daemon WHERE name='service' AND token=?", token);
    // Process teardown closes the DB after pending child callbacks; no new work is launched.
  }
}
