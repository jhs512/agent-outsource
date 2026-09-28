import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectSetup } from '../skills/agent-outsource-setup/scripts/setup.mjs';
import { executable } from '../skills/agent-outsource/scripts/executables.mjs';
import { Store, projectDb } from '../skills/agent-outsource/scripts/db.mjs';
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
  const root = temporary(), relocated = path.join(root, '다른 사용자 skills', 'agent-outsource');
  // Node 24.13.1 on Windows crashes inside cpSync for this Unicode destination.
  // Copy individual files so the test exercises skill portability, not cpSync.
  const source = path.resolve('skills/agent-outsource');
  for (const entry of fs.readdirSync(source, { recursive: true, withFileTypes: true })) {
    const from = path.join(entry.parentPath, entry.name);
    if (path.relative(source, from).split(path.sep).includes('node_modules')) continue;
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

test('setup defaults to current project and leaves parent and home databases untouched', async () => {
  const parent = temporary(), project = path.join(parent, 'app'), home = temporary();
  fs.mkdirSync(project);
  const unrelated = [projectDb(parent), projectDb(home), path.join(home, 'agent-outsource.sqlite'), path.join(home, 'ai-oc.sqlite')];
  for (const file of unrelated) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'unrelated database');
    fs.mkdirSync(`${file}.logs`); fs.writeFileSync(path.join(`${file}.logs`, 'keep'), 'keep log');
  }
  const originalCwd = process.cwd(), originalHome = process.env.USERPROFILE, originalWorks = process.env.AGENT_OUTSOURCE_WORKS;
  let result;
  try {
    process.chdir(project); process.env.USERPROFILE = home; process.env.AGENT_OUTSOURCE_WORKS = parent;
    result = await inspectSetup({ platform: 'win32', run: fake });
  } finally {
    process.chdir(originalCwd);
    for (const [key, value] of [['USERPROFILE', originalHome], ['AGENT_OUTSOURCE_WORKS', originalWorks]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  assert.equal(result.configured, true);
  assert.equal(result.checks.find(c => c.name === '프로젝트 폴더').detail, project);
  const db = new Store(projectDb(project));
  assert.equal(db.setting('project_root'), project);
  assert.equal(db.get('PRAGMA journal_mode').journal_mode, 'wal');
  assert.equal(db.get('PRAGMA integrity_check').integrity_check, 'ok');
  assert.equal(db.get('SELECT count(*) n FROM jobs').n, 0);
  db.close();
  for (const file of unrelated) {
    assert.equal(fs.readFileSync(file, 'utf8'), 'unrelated database');
    assert.equal(fs.readFileSync(path.join(`${file}.logs`, 'keep'), 'utf8'), 'keep log');
    assert.equal(fs.existsSync(`${file}.migrated`), false);
  }
});

test('project instructions preserve custom content, update once and ignore generated files', async () => {
  const { prepareProjectFiles } = await import('../skills/agent-outsource-setup/scripts/project-files.mjs');
  const { execFileSync } = await import('node:child_process');
  const root = temporary();
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Custom instructions\nKeep my conventions.\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '# Custom ignore\nbuild/\n!AGENTS.md\n');
  prepareProjectFiles(root);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.ok(agents.startsWith('# Custom instructions\nKeep my conventions.\n'));
  assert.equal(agents.split('<!-- agent-outsource:begin -->').length, 2);
  assert.equal(prepareProjectFiles(root).changed, false);
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), ignore);
  execFileSync('git', ['init', root]);
  for (const file of ['AGENTS.md', '.agent-outsource/agent-outsource.sqlite', '.agent-outsource/request.json']) {
    assert.equal(execFileSync('git', ['-C', root, 'check-ignore', '--', file], { encoding: 'utf8' }).trim(), file);
  }
  fs.writeFileSync(path.join(root, 'AGENTS.md'), agents.replace('Delegate nearly all substantive project work', 'Old policy'));
  prepareProjectFiles(root);
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), agents);
});
test('ambiguous policy markers preserve both original files', async () => {
  const { prepareProjectFiles } = await import('../skills/agent-outsource-setup/scripts/project-files.mjs');
  const root = temporary(), file = path.join(root, 'AGENTS.md');
  const original = 'Keep this\n<!-- agent-outsource:begin -->\nunfinished';
  fs.writeFileSync(file, original);
  assert.throws(() => prepareProjectFiles(root), /ambiguous/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(root, '.gitignore')), false);
});
