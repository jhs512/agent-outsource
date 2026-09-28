import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, worksDb } from '../skills/agent-outsource/scripts/db.mjs';
import { findWorks, resolveTarget, listProjects, getProject, createProject, setMemo, workContext } from '../skills/agent-outsource/scripts/works.mjs';
import { promptMessage } from '../skills/agent-outsource/scripts/providers.mjs';

const makeWorks = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-oc-works-'));
  const store = new Store(worksDb(root)); store.setSetting('works_root', root);
  return { root, store };
};
const request = extra => ({ caller: 'fixture', key: `k-${Math.random()}`, name: 'task', provider: 'claude', prompt: 'do it', ...extra });

test('works root is found by walking up from any folder inside it', () => {
  const { root, store } = makeWorks(); store.close();
  const deep = path.join(root, 'app', 'src', 'lib'); fs.mkdirSync(deep, { recursive: true });
  assert.equal(findWorks(deep), root);
  assert.equal(findWorks(os.tmpdir()), null);
});

test('works DB is WAL and projects/memos persist in SQLite', () => {
  const { root, store } = makeWorks();
  assert.equal(store.get('PRAGMA journal_mode').journal_mode, 'wal');
  fs.mkdirSync(path.join(root, 'existing'));
  const created = createProject(store, 'fresh', 'first note');
  assert.equal(created.created, true);
  assert.equal(fs.statSync(path.join(root, 'fresh')).isDirectory(), true);
  setMemo(store, 'fresh', 'second note', true);
  assert.equal(getProject(store, 'fresh').memo, 'first note\nsecond note');
  assert.deepEqual(listProjects(store).projects.map(p => p.name), ['existing', 'fresh']);
  assert.ok(!listProjects(store).projects.some(p => p.name === '.agent-outsource'));
  assert.throws(() => createProject(store, '../escape'), /Invalid project name/);
  assert.throws(() => setMemo(store, 'missing', 'x'), /not found/);
  store.close();
});

test('submit targets are confined to project folders under works', () => {
  const { root, store } = makeWorks();
  assert.throws(() => resolveTarget(store, request({ project: 'newapp' })), /not found/);
  const target = resolveTarget(store, request({ project: 'newapp', newProject: true }));
  assert.equal(target.cwd, path.join(root, 'newapp'));
  assert.equal(target.project, 'newapp');
  assert.equal('newProject' in target, false);
  const job = store.submit(target);
  assert.equal(getProject(store, 'newapp').jobs[0].id, job.jobId);
  fs.mkdirSync(path.join(root, 'newapp', 'sub'));
  assert.equal(resolveTarget(store, request({ cwd: path.join(root, 'newapp', 'sub') })).project, 'newapp');
  assert.throws(() => resolveTarget(store, request({ cwd: root })), /inside a project/);
  assert.throws(() => resolveTarget(store, request({ cwd: os.tmpdir() })), /inside a project/);
  assert.throws(() => resolveTarget(store, request({ project: 'newapp', cwd: os.tmpdir() })), /inside the named project/);
  store.close();
});

test('first worker turn receives works root, project path and memo', () => {
  const { root, store } = makeWorks();
  createProject(store, 'site', 'Uses Astro. Deploy with npm run deploy.');
  const context = workContext(store, { project: 'site' });
  assert.match(context, new RegExp(root.replace(/\\/g, '\\\\')));
  assert.match(context, /Uses Astro/);
  assert.match(promptMessage('claude', 'build it', 'win32', context).message.content, /^Workspace context[\s\S]*build it/);
  store.close();
});

test('bridge resolves the works DB from cwd and manages projects without a caller', () => {
  const { root, store } = makeWorks(); store.close();
  const bridge = path.resolve('skills/agent-outsource/scripts/bridge.mjs'), file = path.join(root, 'req.json');
  const call = (action, body) => {
    fs.writeFileSync(file, JSON.stringify(body));
    return JSON.parse(execFileSync(process.execPath, [bridge, action, file], { cwd: root, encoding: 'utf8', env: { ...process.env, AGENT_OUTSOURCE_WORKS: '' } }));
  };
  assert.equal(call('works', {}).journalMode, 'wal');
  assert.equal(call('project-create', { name: 'blog', memo: 'personal blog' }).created, true);
  assert.equal(call('projects', {}).projects[0].memo, 'personal blog');
  assert.equal(call('project-memo', { name: 'blog', memo: 'uses Hugo' }).memo, 'uses Hugo');
  assert.equal(call('works', {}).database, worksDb(root));
});
