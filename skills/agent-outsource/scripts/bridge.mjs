import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Store, worksDb, clip, now } from './db.mjs';
import { resolveWorks, resolveTarget, listProjects, getProject, createProject, setMemo } from './works.mjs';
import { identity, sleep } from './process.mjs';
import { serve } from './service.mjs';
import { cachedModels, refreshModels } from './models.mjs';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? null : path.resolve(args.splice(index, 2)[1]); };
const dbOption = option('--db'), worksOption = option('--works');
function databaseFor(req = {}) {
  if (dbOption) return dbOption;
  const root = resolveWorks({ explicit: worksOption, starts: [req.cwd, process.cwd()] });
  if (!root || !fs.existsSync(worksDb(root))) throw new Error('No works folder is set up here. Ask the user to run agent-outsource-setup, or pass --works <folder>.');
  return worksDb(root);
}
const noCaller = ['service', 'stop', 'works', 'projects', 'project', 'project-create', 'project-memo'];
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
  if (action === 'serve') return serve(databaseFor());
  if (action === 'help') return console.log('bridge.mjs <submit|followup|answer|cancel|status|question|result|log|events|ack|retry|service|stop|models|models-refresh|works|projects|project|project-create|project-memo> <request.json> [--works folder] [--db test.sqlite]');
  const req = input ? JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')) : {};
  if (!noCaller.includes(action) && (typeof req.caller !== 'string' || !req.caller.trim())) throw new Error('caller is required');
  const store = new Store(databaseFor(req));
  try {
    let value;
    if (action === 'models' || action === 'models-refresh') {
      const providers = req.provider ? [req.provider] : ['claude', 'antigravity'];
      value = [];
      for (const provider of providers) value.push(action === 'models' ? cachedModels(store, provider) : await refreshModels(store, provider));
      if (value.some(item => item.refreshed === false)) process.exitCode = 1;
    } else if (['submit', 'followup'].includes(action)) {
      // --db alone (isolated verification) may have no works root; everything else is project-scoped.
      value = store.submit(dbOption && !store.setting('works_root') ? req : resolveTarget(store, req)); await ensureService(store);
    } else if (action === 'works') {
      value = { root: store.setting('works_root'), database: store.filename, journalMode: store.get('PRAGMA journal_mode').journal_mode,
        projects: store.get('SELECT count(*) AS n FROM projects').n };
    } else if (action === 'projects') value = listProjects(store);
    else if (action === 'project') value = getProject(store, req.name);
    else if (action === 'project-create') value = createProject(store, req.name, req.memo);
    else if (action === 'project-memo') value = setMemo(store, req.name, req.memo, req.append === true); else if (action === 'answer') { value = store.answer(req); await ensureService(store); }
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
