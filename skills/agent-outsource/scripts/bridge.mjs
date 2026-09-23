import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Store, defaultDb, clip, now } from './db.mjs';
import { identity, sleep } from './process.mjs';
import { serve } from './service.mjs';

const args = process.argv.slice(2);
const dbIndex = args.indexOf('--db');
const filename = dbIndex < 0 ? defaultDb : path.resolve(args.splice(dbIndex, 2)[1]);
const [action = 'help', input] = args;
export async function ensureService(store) {
  const row = store.get("SELECT * FROM daemon WHERE name='service'");
  if (row && await identity(row.pid) === row.birth) return { running: true, heartbeatAgeMs: now() - row.heartbeat };
  const logDir = `${store.filename}.logs`; fs.mkdirSync(logDir, { recursive: true });
  const fd = fs.openSync(path.join(logDir, 'service.log'), 'a');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', '--db', store.filename],
    { detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env: process.env });
  fs.closeSync(fd); child.on('error', () => {}); child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    const started = store.get("SELECT * FROM daemon WHERE name='service'");
    if (started && now() - started.heartbeat < 4000) return { running: true };
  }
  throw new Error('Service did not start; request remains in SQLite. Inspect service.log');
}
async function main() {
  if (action === 'serve') return serve(filename);
  if (action === 'help') return console.log('bridge.mjs <submit|followup|answer|cancel|status|question|result|log|events|ack|retry|service|stop> <request.json> [--db test.sqlite]');
  const req = input ? JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')) : {};
  if (!['service', 'stop'].includes(action) && (typeof req.caller !== 'string' || !req.caller.trim())) throw new Error('caller is required');
  const store = new Store(filename);
  try {
    let value;
    if (['submit', 'followup'].includes(action)) {
      value = store.submit(req); await ensureService(store);
    } else if (action === 'answer') { value = store.answer(req); await ensureService(store); }
    else if (action === 'cancel') { value = store.cancel(req.jobId, req.caller); await ensureService(store); }
    else if (action === 'service') value = await ensureService(store);
    else if (action === 'stop') {
      const row = store.get("SELECT * FROM daemon WHERE name='service'");
      if (row && await identity(row.pid) === row.birth) store.run("INSERT OR REPLACE INTO controls VALUES('stop',?)", row.token);
      value = { stopRequested: !!row };
    } else if (action === 'status') {
      const job = store.job(req.jobId, req.caller);
      const runs = store.all('SELECT id,status,summary,exit_code,created,ended FROM runs WHERE job_id=? ORDER BY created DESC LIMIT 5', job.id);
      const pending = store.all("SELECT questions.id,questions.kind,questions.mode,questions.state,questions.payload FROM questions JOIN runs ON questions.run_id=runs.id WHERE runs.job_id=? AND questions.state='pending' LIMIT 8", job.id)
        .map(q => ({ ...q, payload: clip(q.payload, 2000), payloadTruncated: q.payload.length > 2000 }));
      value = { job, runs, pending, notifications: store.all('SELECT outbox.id,outbox.kind,outbox.state,outbox.attempts FROM outbox JOIN runs ON outbox.run_id=runs.id WHERE runs.job_id=? ORDER BY outbox.due DESC LIMIT 10', job.id) };
    } else if (action === 'question') {
      const q = store.get('SELECT questions.*,runs.job_id FROM questions JOIN runs ON questions.run_id=runs.id WHERE questions.id=?', req.questionId);
      if (!q) throw new Error('Question missing'); store.job(q.job_id, req.caller);
      const offset = req.offset ?? 0, limit = req.limit ?? 4000;
      if (!Number.isInteger(offset) || offset < 0 || offset > q.payload.length || !Number.isInteger(limit) || limit < 1 || limit > 8192) throw new Error('Invalid question slice');
      value = { id: q.id, kind: q.kind, mode: q.mode, state: q.state, payload: q.payload.slice(offset, offset + limit),
        nextOffset: Math.min(q.payload.length, offset + limit), totalLength: q.payload.length };
    } else if (action === 'result' || action === 'log') {
      const run = store.get('SELECT * FROM runs WHERE id=?', req.runId);
      if (!run) throw new Error('Run missing'); store.job(run.job_id, req.caller);
      const limit = req.limit ?? 4000;
      if (!Number.isInteger(limit) || limit < 1 || limit > 8192) throw new Error('limit must be 1..8192');
      if (action === 'result') value = { status: run.status, summary: run.summary, result: clip(run.result, limit), truncated: (run.result?.length || 0) > limit };
      else {
        const file = req.file || 'stdout.jsonl';
        if (!['stdout.jsonl', 'stderr.log', 'result.json'].includes(file)) throw new Error('Invalid log name');
        const target = path.join(`${store.filename}.logs`, run.id, file), fd = fs.openSync(target, 'r');
        try {
          const size = fs.fstatSync(fd).size, offset = req.offset ?? Math.max(0, size - limit);
          if (!Number.isInteger(offset) || offset < 0 || offset > size) throw new Error('Invalid offset');
          const buffer = Buffer.alloc(Math.min(limit, size - offset));
          const count = fs.readSync(fd, buffer, 0, buffer.length, offset);
          value = { text: buffer.subarray(0, count).toString('utf8'), nextOffset: offset + count, size };
        } finally { fs.closeSync(fd); }
      }
    } else if (action === 'events') {
      if (typeof req.caller !== 'string') throw new Error('caller required');
      value = store.all('SELECT id,kind,state,attempts,payload,last_error FROM outbox WHERE caller=? ORDER BY due DESC LIMIT 20', req.caller)
        .map(e => ({ ...e, payload: clip(e.payload, 1000) }));
    } else if (action === 'ack') value = store.ack(req.eventId, req.caller);
    else if (action === 'retry') {
      value = { changed: store.run("UPDATE outbox SET state='retry',due=? WHERE id=? AND caller=? AND state IN ('sent','retry','uncertain')", now(), req.eventId, req.caller).changes };
      await ensureService(store);
    } else throw new Error('Unknown action');
    console.log(JSON.stringify(value, null, 2));
  } finally { store.close(); }
}
main().catch(error => { console.error(clip(error.message)); process.exitCode = 1; });
