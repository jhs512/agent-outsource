import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const defaultDb = path.join(os.homedir(), 'agent-outsource.sqlite');
export function migrateHomeDb(home = os.homedir()) {
  const legacy = path.join(home, 'ai-oc.sqlite');
  const target = path.join(home, 'agent-outsource.sqlite');
  if (!fs.existsSync(legacy)) return target;
  const lock = `${target}.migration-lock`;
  fs.mkdirSync(lock);
  try {
    if (!fs.existsSync(legacy)) return target;
    if (fs.existsSync(target)) throw new Error('Both ai-oc.sqlite and agent-outsource.sqlite exist; reconcile them before continuing.');
    if (['-wal', '-shm', '-journal'].some(suffix => fs.existsSync(`${legacy}${suffix}`))) {
      throw new Error('Close the old agent-outsource service and SQLite connections before migrating ai-oc.sqlite.');
    }
    const oldLogs = `${legacy}.logs`, newLogs = `${target}.logs`;
    if (fs.existsSync(newLogs)) throw new Error('agent-outsource.sqlite.logs already exists; reconcile logs before migrating.');
    const moveLogs = fs.existsSync(oldLogs);
    if (moveLogs) fs.renameSync(oldLogs, newLogs);
    try { fs.renameSync(legacy, target); }
    catch (error) { if (moveLogs) fs.renameSync(newLogs, oldLogs); throw error; }
    return target;
  } finally { fs.rmdirSync(lock); }
}
export const clip = (v, n = 1800) => String(v ?? '').slice(0, n);
export const now = () => Date.now();
export const uuid = () => randomUUID();
export const active = ['queued', 'running', 'waiting_user', 'waiting_permission', 'recovery_blocked'];
export class Store {
  constructor(filename = defaultDb) {
    this.filename = path.resolve(filename);
    if (this.filename === defaultDb) migrateHomeDb();
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    this.db = new DatabaseSync(this.filename);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,name TEXT NOT NULL,provider TEXT NOT NULL,caller TEXT NOT NULL,cwd TEXT NOT NULL,
        session TEXT,status TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),input TEXT NOT NULL,options TEXT NOT NULL,
        status TEXT NOT NULL,owner TEXT,child_pid INTEGER,child_birth TEXT,cancel INTEGER NOT NULL DEFAULT 0,
        result TEXT,summary TEXT NOT NULL DEFAULT '',exit_code INTEGER,created INTEGER NOT NULL,ended INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs(job_id) WHERE status IN ('queued','running','waiting_user','waiting_permission');
      CREATE TABLE IF NOT EXISTS commands(caller TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,job_id TEXT NOT NULL,run_id TEXT NOT NULL,
        PRIMARY KEY(caller,key));
      CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),provider_id TEXT NOT NULL,
        kind TEXT NOT NULL,mode TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',answer TEXT,created INTEGER NOT NULL,
        UNIQUE(run_id,provider_id));
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),caller TEXT NOT NULL,kind TEXT NOT NULL,
        payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL,
        last_error TEXT,delivery_started INTEGER,sent_at INTEGER,acked_at INTEGER);
      CREATE INDEX IF NOT EXISTS outbox_due ON outbox(state,due);
      CREATE TABLE IF NOT EXISTS daemon(name TEXT PRIMARY KEY,token TEXT NOT NULL,pid INTEGER NOT NULL,birth TEXT NOT NULL,heartbeat INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS controls(name TEXT PRIMARY KEY,value TEXT NOT NULL);
      PRAGMA user_version=1;
    `);
  }
  get(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  tx(fn) {
    for (let attempt = 0; ; attempt++) {
      try { this.db.exec('BEGIN IMMEDIATE'); break; }
      catch (error) {
        if (!/busy|locked/i.test(error.message) || attempt >= 3) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30 * (attempt + 1));
      }
    }
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  job(id, caller) {
    const job = this.get('SELECT * FROM jobs WHERE id=?', id);
    if (!job || (caller !== undefined && job.caller !== caller)) throw new Error('Job missing or wrong caller');
    return job;
  }
  submit(req) {
    for (const field of ['caller', 'key', 'name', 'cwd', 'prompt', 'provider']) {
      if (typeof req[field] !== 'string' || !req[field].trim()) throw new Error(`Missing ${field}`);
    }
    if (!['claude', 'antigravity'].includes(req.provider)) throw new Error('Invalid provider');
    if (req.name.length > 120 || req.key.length > 200 || req.caller.length > 200 || req.prompt.length > 32000) throw new Error('Input too long');
    if (!path.isAbsolute(req.cwd) || !fs.statSync(req.cwd).isDirectory()) throw new Error('cwd must be an existing absolute directory');
    const normalized = { caller: req.caller, key: req.key, name: req.name, cwd: path.resolve(req.cwd), prompt: req.prompt,
      provider: req.provider, jobId: req.jobId || null, options: validateOptions(req.options || {}) };
    const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return this.tx(() => {
      const previous = this.get('SELECT * FROM commands WHERE caller=? AND key=?', req.caller, req.key);
      if (previous) {
        const legacyHash = createHash('sha256').update(JSON.stringify({ ...normalized,
          options: { ...normalized.options, permission: 'manual' } })).digest('hex');
        if (previous.hash !== hash && previous.hash !== legacyHash) throw new Error('Idempotency key reused with different content');
        return { jobId: previous.job_id, runId: previous.run_id, duplicate: true };
      }
      const jobId = req.jobId || uuid(), runId = uuid();
      if (req.jobId) {
        const job = this.job(jobId, req.caller);
        if (active.includes(job.status)) throw new Error('Job has an active run');
        if (job.provider !== req.provider || job.cwd !== normalized.cwd) throw new Error('Provider/cwd cannot change on resume');
        if (!job.session) throw new Error('No provider session to resume');
      } else this.run('INSERT INTO jobs(id,name,provider,caller,cwd,status,created,updated) VALUES(?,?,?,?,?,?,?,?)',
        jobId, req.name, req.provider, req.caller, normalized.cwd, 'queued', now(), now());
      this.run('INSERT INTO runs(id,job_id,input,options,status,created) VALUES(?,?,?,?,?,?)', runId, jobId, req.prompt, JSON.stringify(normalized.options), 'queued', now());
      this.run("UPDATE jobs SET status='queued',updated=? WHERE id=?", now(), jobId);
      this.run('INSERT INTO commands VALUES(?,?,?,?,?)', req.caller, req.key, hash, jobId, runId);
      return { jobId, runId, duplicate: false };
    });
  }
  event(runId, kind, payload) {
    const row = this.get('SELECT jobs.caller,jobs.id AS jobId,jobs.name FROM jobs JOIN runs ON jobs.id=runs.job_id WHERE runs.id=?', runId);
    const id = uuid();
    this.run('INSERT INTO outbox(id,run_id,caller,kind,payload,due) VALUES(?,?,?,?,?,?)', id, runId, row.caller, kind,
      JSON.stringify({ eventId: id, jobId: row.jobId, runId, name: row.name, kind, ...payload }), now());
    return id;
  }
  claim(owner) {
    return this.tx(() => {
      const run = this.get("SELECT * FROM runs WHERE status='queued' ORDER BY created LIMIT 1");
      if (!run) return null;
      this.run("UPDATE runs SET status='running',owner=? WHERE id=?", owner, run.id);
      this.run("UPDATE jobs SET status='running',updated=? WHERE id=?", now(), run.job_id);
      return { ...run, status: 'running', owner };
    });
  }
  finish(runId, status, summary, result = null, exitCode = null) {
    return this.tx(() => {
      const run = this.get('SELECT * FROM runs WHERE id=?', runId);
      if (!run || !active.includes(run.status)) return false;
      if (run.cancel && status !== 'recovery_blocked') status = 'cancelled';
      this.run('UPDATE runs SET status=?,summary=?,result=?,exit_code=?,ended=? WHERE id=?', status, clip(summary),
        result == null ? run.result : JSON.stringify(result), exitCode, now(), runId);
      this.run('UPDATE jobs SET status=?,summary=?,updated=? WHERE id=?', status, clip(summary), now(), run.job_id);
      this.run("UPDATE questions SET state='expired' WHERE run_id=? AND state IN ('pending','answered','sending')", runId);
      this.event(runId, status, { summary: clip(summary) });
      return true;
    });
  }
  question(runId, providerId, kind, mode, payload) {
    if (JSON.stringify(payload).length > 64000) throw new Error('Question payload too large; see raw log');
    return this.tx(() => {
      const old = this.get('SELECT id FROM questions WHERE run_id=? AND provider_id=?', runId, providerId);
      if (old) return old.id;
      const run = this.get('SELECT * FROM runs WHERE id=?', runId);
      if (!run || !active.includes(run.status)) return null;
      const id = uuid(), status = kind === 'permission' ? 'waiting_permission' : 'waiting_user';
      this.run('INSERT INTO questions(id,run_id,provider_id,kind,mode,payload,created) VALUES(?,?,?,?,?,?,?)',
        id, runId, providerId, kind, mode, JSON.stringify(payload), now());
      this.run('UPDATE runs SET status=? WHERE id=?', status, runId);
      this.run('UPDATE jobs SET status=?,updated=? WHERE id=?', status, now(), run.job_id);
      this.event(runId, status, { questionId: id, mode, summary: clip(JSON.stringify(payload), 1400) });
      return id;
    });
  }
  autoPermission(runId, providerId, payload) {
    if (JSON.stringify(payload).length > 64000) throw new Error('Permission payload too large; see raw log');
    return this.tx(() => {
      const existing = this.get('SELECT id FROM questions WHERE run_id=? AND provider_id=?', runId, providerId);
      if (existing) return existing.id;
      const run = this.get('SELECT * FROM runs WHERE id=?', runId);
      if (!run || !active.includes(run.status) || run.cancel) return null;
      const id = uuid();
      this.run("INSERT INTO questions(id,run_id,provider_id,kind,mode,payload,state,answer,created) VALUES(?,?,?,'permission','live',?,'answered',?,?)",
        id, runId, providerId, JSON.stringify(payload), JSON.stringify({ decision: 'allow', source: 'always-bypass execution policy' }), now());
      return id;
    });
  }
  answer({ caller, questionId, response }) {
    if (!response || JSON.stringify(response).length > 16000) throw new Error('Invalid response');
    return this.tx(() => {
      const q = this.get('SELECT * FROM questions WHERE id=?', questionId);
      if (!q) throw new Error('Question missing');
      const run = this.get('SELECT * FROM runs WHERE id=?', q.run_id), job = this.job(run.job_id, caller);
      const serialized = JSON.stringify(response);
      if (q.answer) {
        if (q.answer !== serialized) throw new Error('Question already answered differently');
        return { questionId, duplicate: true };
      }
      if (q.state !== 'pending' || !active.includes(run.status) || run.cancel) throw new Error('Question is no longer pending');
      if (q.kind === 'permission' && !['allow', 'deny'].includes(response.decision)) throw new Error('Explicit allow or deny required');
      if (q.kind === 'question' && typeof response.text !== 'string' && !response.answers) throw new Error('Human answer required');
      if (q.kind === 'question' && q.mode === 'live') {
        const questions = JSON.parse(q.payload).input?.questions || [];
        if (questions.length !== 1 && (!response.answers || questions.some(item => typeof response.answers[item.question] !== 'string'))) {
          throw new Error('An explicit answer for each question is required');
        }
      }
      this.run("UPDATE questions SET answer=?,state='answered' WHERE id=?", serialized, questionId);
      if (q.mode === 'resume') {
        if (!job.session) throw new Error('Missing provider session');
        this.run("UPDATE runs SET status='answered',ended=? WHERE id=?", now(), run.id);
        const nextId = uuid();
        const prompt = `Human response to the pending ${q.kind}: ${serialized}. Continue the same task. Do not invent human decisions.`;
        this.run('INSERT INTO runs(id,job_id,input,options,status,created) VALUES(?,?,?,?,?,?)', nextId, job.id, prompt, run.options, 'queued', now());
        this.run("UPDATE jobs SET status='queued',updated=? WHERE id=?", now(), job.id);
        this.run("UPDATE questions SET state='sent' WHERE id=?", questionId);
        return { questionId, runId: nextId, mode: 'resume' };
      }
      return { questionId, mode: 'live' };
    });
  }
  cancel(jobId, caller) {
    return this.tx(() => {
      this.job(jobId, caller);
      const run = this.get("SELECT * FROM runs WHERE job_id=? AND status IN ('queued','running','waiting_user','waiting_permission')", jobId);
      if (!run) return { requested: false };
      this.run('UPDATE runs SET cancel=1 WHERE id=?', run.id);
      return { requested: true, runId: run.id };
    });
  }
  ack(id, caller) {
    const changed = this.run("UPDATE outbox SET state='acked',acked_at=? WHERE id=? AND caller=? AND state!='acked'", now(), id, caller).changes;
    return { acknowledged: !!changed, duplicate: !changed && !!this.get("SELECT id FROM outbox WHERE id=? AND caller=? AND state='acked'", id, caller) };
  }
  close() { this.db.close(); }
}
function validateOptions(options) {
  // Accept legacy requests, but neither omission nor manual can disable the invariant.
  if (options.permission !== undefined && !['manual', 'bypass'].includes(options.permission)) throw new Error('Invalid legacy permission value');
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000)) throw new Error('Invalid timeoutMs');
  if (options.delayMs !== undefined && (!Number.isInteger(options.delayMs) || options.delayMs < 0 || options.delayMs > 60000)) throw new Error('Invalid delayMs');
  return { permission: 'bypass', ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), ...(options.delayMs ? { delayMs: options.delayMs } : {}) };
}
