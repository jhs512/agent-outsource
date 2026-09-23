import path from 'node:path';
import os from 'node:os';
import { schema } from './protocol.js';

export function command(job) {
  const args = ['-p', '--output-format', 'stream-json'];
  if (job.provider === 'claude') {
    args.push('--verbose', '--dangerously-skip-permissions', '--json-schema', JSON.stringify(schema));
    if (job.sessionId) args.push('--resume', job.sessionId);
    return { executable: process.env.AI_OC_CLAUDE || (process.platform === 'win32'
      ? path.join(os.homedir(), '.local', 'bin', 'claude.exe') : 'claude'), args };
  }
  if (job.provider === 'antigravity') {
    // Antigravity print consumes a prompt argument rather than Claude's stdin convention.
    args.splice(0, 1);
    args.push('--json-schema', JSON.stringify(schema));
    if (job.sessionId) args.push('--conversation', job.sessionId);
    return { executable: process.env.AI_OC_AGY || (process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe') : 'agy'), args };
  }
  throw new Error('Unknown provider');
}
