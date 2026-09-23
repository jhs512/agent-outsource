import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function executable(name, env = process.env, platform = process.platform) {
  const overrides = { claude: 'AI_OC_CLAUDE', antigravity: 'AI_OC_AGY', codex: 'AI_OC_CODEX' };
  if (!overrides[name]) throw new Error('Unknown executable');
  if (env[overrides[name]]) return env[overrides[name]];
  const command = name === 'antigravity' ? 'agy' : name;
  const filename = command + (platform === 'win32' ? '.exe' : '');
  for (const entry of (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':')) {
    if (!entry) continue;
    const candidate = path.join(entry.replace(/^"|"$/g, ''), filename);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const fallback = name === 'claude' ? path.join(home, '.local', 'bin', filename)
    : name === 'antigravity' && platform === 'win32' && env.LOCALAPPDATA
      ? path.join(env.LOCALAPPDATA, 'agy', 'bin', filename) : null;
  return fallback && fs.existsSync(fallback) ? fallback : filename;
}
