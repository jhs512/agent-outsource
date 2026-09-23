import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { root, jobDir, readJob, saveJob, publicJob, clip } from './store.js';

function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value;
}
function launch(job, prompt) {
  const dir = jobDir(job.id);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'launch.lock');
  const fd = fs.openSync(lock, 'wx');
  fs.closeSync(fd);
  try {
    fs.writeFileSync(path.join(dir, 'input.txt'), prompt, { mode: 0o600 });
    job.status = 'queued'; job.summary = ''; job.question = null;
    saveJob(job);
    const log = fs.openSync(path.join(dir, 'runner.log'), 'a');
    try {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./runner.js', import.meta.url)), job.id], {
        detached: true, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, AI_OC_HOME: root },
      });
      child.on('error', () => {});
      child.unref();
    } finally { fs.closeSync(log); }
  } catch (error) { fs.rmSync(lock, { force: true }); throw error; }
  return publicJob(job);
}
export function start({ provider, name, cwd, prompt }) {
  if (!['claude', 'antigravity'].includes(provider)) throw new Error('Invalid provider');
  text(cwd, 'cwd', 4096);
  if (!path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('cwd must be an existing absolute directory');
  return launch({ id: randomUUID(), name: text(name, 'name', 120), provider, cwd,
    sessionId: null, createdAt: new Date().toISOString() }, text(prompt, 'prompt', 32000));
}
export function answer({ id, questionId, answer }) {
  text(answer, 'answer', 16000);
  const job = readJob(id);
  if (job.status !== 'waiting_user' || !job.sessionId) throw new Error('Job is not resumable');
  if (job.question?.id !== questionId) throw new Error('Stale or incorrect question ID');
  return launch(job, `Human answer to question ${questionId}:\n${answer}\nContinue the existing task.`);
}
export function cancel(id) {
  const job = readJob(id);
  if (!['queued', 'running'].includes(job.status)) throw new Error('Job is not running');
  fs.writeFileSync(path.join(jobDir(id), 'cancel'), 'cancel');
  return { id, cancellationRequested: true };
}
export function list(limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be 1..50');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(id => /^[a-f0-9-]{36}$/.test(id))
    .map(id => { try { return readJob(id); } catch { return null; } }).filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(publicJob);
}

// One active tool call can wait without repeated model invocations. This cannot wake a finished Codex turn.
export async function wait(id, timeoutMs = 30000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('timeoutMs must be 1..60000');
  const current = readJob(id);
  if (!['queued', 'running'].includes(current.status)) return publicJob(current);
  return new Promise(resolve => {
    let watcher, timer;
    const finish = () => { watcher?.close(); clearTimeout(timer); resolve(publicJob(readJob(id))); };
    watcher = fs.watch(jobDir(id), () => {
      try { if (!['queued', 'running'].includes(readJob(id).status)) finish(); } catch { /* Atomic rename in progress. */ }
    });
    timer = setTimeout(finish, timeoutMs);
    if (!['queued', 'running'].includes(readJob(id).status)) finish();
  });
}
