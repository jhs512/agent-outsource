import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectSetup } from '../skills/cli-worker-bridge-setup/scripts/setup.mjs';
import { executable } from '../skills/cli-worker-bridge/scripts/executables.mjs';
import { Store } from '../skills/cli-worker-bridge/scripts/db.mjs';
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-oc-setup-'));
const optionsText = '--dangerously-skip-permissions --input-format --output-format --resume --conversation';
const fake = async (exe, args) => {
  if (args[0] === 'queue') return { ok: true, output: '--thread --message' };
  if (args[0] === 'auth') return { ok: true, output: '{"loggedIn":true,"email":"private@example.invalid"}' };
  return { ok: true, output: args[0] === '--help' ? optionsText : 'test version' };
};
test('setup checks prerequisites without models and preserves existing DB data', async () => {
  const filename = path.join(temporary(), 'home.sqlite');
  const db = new Store(filename);
  const task = db.submit({ caller: 'fixture', key: 'preserve', name: 'existing', cwd: process.cwd(), provider: 'claude', prompt: 'keep this' }); db.close();
  const calls = [];
  const result = await inspectSetup({ databasePath: filename, platform: 'win32', run: async (exe, args) => { calls.push(args); return fake(exe, args); } });
  assert.equal(result.configured, true);
  assert.deepEqual(result.workers, ['claude', 'antigravity']);
  assert.ok(!JSON.stringify(result).includes('private@example'));
  assert.ok(result.checks.some(c => c.name === 'Antigravity 로그인' && c.status === 'manual'));
  assert.ok(calls.every(args => args.includes('--help') || args.includes('--version') || args[0] === 'auth'));
  const after = new Store(filename); assert.equal(after.job(task.jobId).name, 'existing'); after.close();
});
test('setup rejects unsupported Node, missing sibling, and absent queue capability', async () => {
  assert.equal((await inspectSetup({ nodeVersion: '20.0.0' })).configured, false);
  assert.equal((await inspectSetup({ bridgeDirectory: temporary() })).configured, false);
  const result = await inspectSetup({ databasePath: path.join(temporary(), 'db.sqlite'),
    run: async (exe, args) => args[0] === 'queue' ? { ok: false, output: '' } : fake(exe, args) });
  assert.equal(result.configured, false);
  assert.ok(result.checks.some(c => c.name === 'Codex 알림' && c.status === 'missing'));
});
test('setup works from relocated skill folders without a developer username', async () => {
  const root = temporary(), relocated = path.join(root, '다른 사용자 skills', 'cli-worker-bridge');
  // Node 24.13.1 on Windows crashes inside cpSync for this Unicode destination.
  // Copy individual files so the test exercises skill portability, not cpSync.
  const source = path.resolve('skills/cli-worker-bridge');
  for (const entry of fs.readdirSync(source, { recursive: true, withFileTypes: true })) {
    const from = path.join(entry.parentPath, entry.name);
    const to = path.join(relocated, path.relative(source, from));
    if (entry.isDirectory()) fs.mkdirSync(to, { recursive: true });
    else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
  }
  const result = await inspectSetup({ bridgeDirectory: relocated, databasePath: path.join(root, 'db.sqlite'), run: fake });
  assert.equal(result.configured, true);
  assert.equal(result.checks.find(c => c.name === '작업 스킬').detail, relocated);
});
test('executable discovery respects override, PATH, and a different user home', () => {
  const root = temporary(), bin = path.join(root, 'tools'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude.exe'), '');
  assert.equal(executable('claude', { PATH: bin }, 'win32'), path.join(bin, 'claude.exe'));
  assert.equal(executable('claude', { AI_OC_CLAUDE: 'explicit.exe', PATH: bin }, 'win32'), 'explicit.exe');
  const userBin = path.join(root, 'someone-else', '.local', 'bin'); fs.mkdirSync(userBin, { recursive: true }); fs.writeFileSync(path.join(userBin, 'claude.exe'), '');
  assert.equal(executable('claude', { USERPROFILE: path.join(root, 'someone-else') }, 'win32'), path.join(userBin, 'claude.exe'));
});
