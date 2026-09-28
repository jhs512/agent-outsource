import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, projectDb } from '../skills/agent-outsource/scripts/db.mjs';
import { resolveTarget, listProjects, getProject, setMemo, workContext } from '../skills/agent-outsource/scripts/works.mjs';
import { promptMessage } from '../skills/agent-outsource/scripts/providers.mjs';
const makeProject = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-oc-project-'));
  const store = new Store(projectDb(root)); store.setSetting('project_root', root);
  return { root, store };
};
const request = extra => ({ caller: 'fixture', key: `k-${Math.random()}`, name: 'task', provider: 'claude', prompt: 'do it', ...extra });
test('project memo persists and child folders are not separate projects', () => {
  const { root, store } = makeProject();
  fs.mkdirSync(path.join(root, 'src'));
  setMemo(store, undefined, 'first note'); setMemo(store, undefined, 'second note', true);
  assert.equal(getProject(store).memo, 'first note\nsecond note');
  assert.deepEqual(listProjects(store).projects.map(p => p.path), [root]);
  assert.throws(() => setMemo(store, 'another-project', 'x'), /belongs to project/);
  store.close();
  const reopened = new Store(projectDb(root));
  assert.equal(getProject(reopened).memo, 'first note\nsecond note'); reopened.close();
});
test('worker can run at project root or below, including followups, but cannot escape', () => {
  const { root, store } = makeProject();
  const target = resolveTarget(store, request({ cwd: root }));
  const job = store.submit(target);
  assert.equal(getProject(store).jobs[0].id, job.jobId);
  assert.equal(target.project, path.basename(root));
  assert.equal(resolveTarget(store, request({})).cwd, root);
  const sub = path.join(root, 'src'); fs.mkdirSync(sub);
  assert.equal(resolveTarget(store, request({ cwd: sub })).project, target.project);
  assert.throws(() => resolveTarget(store, request({ cwd: os.tmpdir() })), /inside the current project/);
  assert.throws(() => resolveTarget(store, request({ cwd: os.tmpdir(), jobId: job.jobId })), /inside the current project/);
  assert.throws(() => resolveTarget(store, request({ newProject: true })), /own folder/);
  store.close();
});
test('first worker turn receives current project and memo', () => {
  const { root, store } = makeProject(); setMemo(store, undefined, 'Uses Astro.');
  const context = workContext(store);
  assert.ok(context.includes(root)); assert.match(context, /Uses Astro/);
  assert.doesNotMatch(context, /Works root|direct subfolder/);
  assert.match(promptMessage('claude', 'build it', 'win32', context).message.content, /^Workspace context[\s\S]*build it/);
  store.close();
});
test('bridge isolates databases and uses explicit project for commands without cwd', () => {
  const a = makeProject(), b = makeProject(); a.store.close(); b.store.close();
  const bridge = path.resolve('skills/agent-outsource/scripts/bridge.mjs'), file = path.join(a.root, 'req.json');
  const call = (action, body, flags = [], cwd = a.root) => {
    fs.writeFileSync(file, JSON.stringify(body));
    return JSON.parse(execFileSync(process.execPath, [bridge, action, file, ...flags], { cwd, encoding: 'utf8', env: { ...process.env, AGENT_OUTSOURCE_WORKS: b.root } }));
  };
  assert.equal(call('workspace', {}).database, projectDb(a.root));
  call('project-memo', { memo: 'only A' });
  assert.equal(call('project', {}).memo, 'only A');
  assert.equal(call('project', {}, ['--project-dir', b.root]).memo, '');
  assert.equal(call('workspace', { cwd: b.root }).database, projectDb(b.root));
  const nested = path.join(a.root, 'nested'); fs.mkdirSync(nested);
  assert.throws(() => call('workspace', {}, [], nested), /No database in this project/);
  assert.equal(call('workspace', {}, ['--project-dir', a.root], nested).database, projectDb(a.root));
  assert.throws(() => call('workspace', {}, ['--works', b.root]), /Use --project-dir/);
});
