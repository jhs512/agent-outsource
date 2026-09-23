import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { jobDir, readJob, saveJob, emit, clip } from './store.js';
import { command } from './providers.js';
import { instructions, JsonLines, parseOutcome } from './protocol.js';

const job = readJob(process.argv[2]);
const dir = jobDir(job.id);
let child, watcher, timer, outcome, providerError, cancelled = false;
const finish = (status, summary, exitCode = null) => {
  clearTimeout(timer); watcher?.close();
  job.status = status; job.summary = clip(summary); job.exitCode = exitCode;
  job.updatedAt = new Date().toISOString();
  emit(job);
  fs.rmSync(path.join(dir, 'launch.lock'), { force: true });
};
try {
  const config = command(job);
  const prompt = instructions(fs.readFileSync(path.join(dir, 'input.txt'), 'utf8'));
  if (fs.existsSync(path.join(dir, 'cancel'))) {
    fs.rmSync(path.join(dir, 'cancel'), { force: true });
    finish('cancelled', 'Cancelled before launch');
  } else {
    if (job.provider === 'antigravity') config.args.push('--print', prompt);
    child = spawn(config.executable, config.args, { cwd: job.cwd, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    job.status = 'running'; job.pid = child.pid; saveJob(job);
    const stdout = fs.createWriteStream(path.join(dir, 'stdout.log'), { flags: 'a' });
    const stderr = fs.createWriteStream(path.join(dir, 'stderr.log'), { flags: 'a' });
    child.stdout.pipe(stdout); child.stderr.pipe(stderr);
    const decoder = new StringDecoder('utf8');
    const parser = new JsonLines(event => {
      const session = event.session_id || event.conversation_id;
      if (typeof session === 'string' && session.length < 256) job.sessionId = session;
      if (event.type === 'result') {
        if (event.is_error) providerError = clip(event.result || event.error || 'Provider reported failure');
        outcome = parseOutcome(event.structured_output) || parseOutcome(event.result) || outcome;
      }
    });
    child.stdout.on('data', chunk => parser.feed(decoder.write(chunk)));
    let spawnError;
    child.on('error', error => { spawnError = error.message; });
    child.stdin.on('error', () => {});
    child.stdin.end(job.provider === 'claude' ? prompt : undefined);
    const terminate = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const checkCancel = () => {
      if (!fs.existsSync(path.join(dir, 'cancel'))) return;
      cancelled = true; terminate();
    };
    watcher = fs.watch(dir, checkCancel);
    checkCancel();
    timer = setTimeout(() => { providerError = 'Worker exceeded the 30 minute execution limit'; terminate(); }, 30 * 60 * 1000);
    child.on('close', code => {
      parser.feed(decoder.end()); parser.end();
      if (fs.existsSync(path.join(dir, 'cancel'))) fs.rmSync(path.join(dir, 'cancel'), { force: true });
      if (cancelled) return finish('cancelled', 'Cancelled by user', code);
      if (spawnError || providerError || code !== 0) return finish('failed', spawnError || providerError || `Worker exited with code ${code}`, code);
      if (!outcome) return finish('needs_review', 'Process exited without a valid structured outcome; inspect a bounded log excerpt.', code);
      if (outcome.status === 'waiting_user') {
        job.question = { id: randomUUID(), text: outcome.question };
        if (!job.sessionId) return finish('needs_review', 'Worker asked a question but did not provide a resumable session ID.', code);
      }
      finish(outcome.status, outcome.summary, code);
    });
  }
} catch (error) { finish('failed', error.message); }
