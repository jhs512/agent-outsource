import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectSetup } from '../skills/agent-outsource-setup/scripts/setup.mjs';
import { executable } from '../skills/agent-outsource/scripts/executables.mjs';
import { Store, worksDb, migrateLegacyDb } from '../skills/agent-outsource/scripts/db.mjs';
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-oc-setup-'));
test('legacy home DB is copied into the works DB with logs and renamed, not deleted', async () => {
  const home = temporary(), works = temporary(), legacy = path.join(home, '.agent-outsource', 'agent-outsource.sqlite');
  const before = new Store(legacy);
  const { jobId } = before.submit({ caller: 'fixture', key: 'migrate', name: 'preserved', cwd: process.cwd(), provider: 'claude', prompt: 'keep' });
  before.run('INSERT INTO models VALUES(?,?,?)', 'claude', 'default', 'Default');
  before.close();
  fs.mkdirSync(`${legacy}.logs`);
  fs.writeFileSync(path.join(`${legacy}.logs`, 'sample.log'), 'original log');
  const target = worksDb(works);
  assert.equal(await migrateLegacyDb(target, { home }), legacy);
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.existsSync(`${legacy}.migrated`), true);
  assert.equal(fs.readFileSync(path.join(`${target}.logs`, 'sample.log'), 'utf8'), 'original log');
  const after = new Store(target);
  assert.equal(after.job(jobId).name, 'preserved');
  assert.equal(after.get('SELECT model_id FROM models').model_id, 'default');
  assert.equal(after.get('PRAGMA journal_mode').journal_mode, 'wal');
  after.close();
  assert.equal(await migrateLegacyDb(target, { home }), null);
});
test('legacy migration refuses a live old service, active runs and conflicting destinations', async () => {
  const home = temporary(), legacy = path.join(home, 'ai-oc.sqlite');
  const db = new Store(legacy);
  db.run("INSERT INTO daemon VALUES('service','t',1,'b',0)");
  db.close();
  const target = worksDb(temporary());
  await assert.rejects(migrateLegacyDb(target, { home, alive: async () => true }), /Stop the old/);
  const active = new Store(legacy);
  const { runId } = active.submit({ caller: 'fixture', key: 'busy', name: 'busy', cwd: process.cwd(), provider: 'claude', prompt: 'x' });
  active.run("UPDATE runs SET status='running' WHERE id=?", runId); active.close();
  await assert.rejects(migrateLegacyDb(target, { home }), /active tasks/);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'do not overwrite');
  await assert.rejects(migrateLegacyDb(target, { home }), /both exist/);
  assert.equal(fs.existsSync(legacy), true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'do not overwrite');
  assert.equal(fs.existsSync(path.join(path.dirname(target), 'migration-lock')), false);
});
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

test('setup records the chosen works folder and creates its WAL DB inside it', async () => {
  const works = path.join(temporary(), 'my works');
  const result = await inspectSetup({ works, home: temporary(), platform: 'win32', run: fake });
  assert.equal(result.configured, true);
  assert.equal(result.checks.find(c => c.name === 'works 폴더').detail, works);
  assert.match(result.checks.find(c => c.name === 'SQLite').detail, /journal_mode: wal/);
  const db = new Store(worksDb(works));
  assert.equal(db.setting('works_root'), works);
  db.close();
});
