import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const root = path.resolve(process.env.AI_OC_HOME || path.join(os.homedir(), '.ai-oc'));
export const clip = (value, max = 2000) => String(value ?? '').slice(0, max);
export function jobDir(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid job ID');
  return path.join(root, id);
}
export function readJob(id) {
  return JSON.parse(fs.readFileSync(path.join(jobDir(id), 'state.json'), 'utf8'));
}
export function saveJob(job) {
  const dir = jobDir(job.id);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `${randomUUID()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(job, null, 2), { mode: 0o600 });
  fs.renameSync(temp, path.join(dir, 'state.json'));
}
export function emit(job) {
  saveJob(job);
  const event = { eventId: randomUUID(), jobId: job.id, name: job.name,
    status: job.status, summary: clip(job.summary), question: job.question,
    at: new Date().toISOString() };
  fs.appendFileSync(path.join(jobDir(job.id), 'events.jsonl'), JSON.stringify(event) + '\n');
  return event;
}
export function publicJob(job) {
  const { id, name, provider, status, sessionId, summary, question, exitCode, updatedAt } = job;
  return { id, name, provider, status, sessionId, summary, question, exitCode, updatedAt };
}
export function tail(id, file = 'stdout.log', bytes = 4096) {
  if (!['stdout.log', 'stderr.log', 'events.jsonl', 'runner.log'].includes(file)) throw new Error('Invalid log');
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > 8192) throw new Error('bytes must be 1..8192');
  const filename = path.join(jobDir(id), file);
  if (!fs.existsSync(filename)) return { text: '', nextOffset: 0 };
  const fd = fs.openSync(filename, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(bytes, size));
    const count = fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
    return { text: buffer.subarray(0, count).toString('utf8'), nextOffset: size, truncated: size > bytes };
  } finally { fs.closeSync(fd); }
}
