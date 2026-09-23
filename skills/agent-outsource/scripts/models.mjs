import { execFile } from 'node:child_process';
import { executable } from './executables.mjs';

const providers = ['claude', 'antigravity'];
function check(provider) { if (!providers.includes(provider)) throw new Error('Invalid provider'); }
export function cachedModels(store, provider) {
  check(provider);
  const lastSuccess = store.get('SELECT last_success FROM model_refresh WHERE provider=?', provider)?.last_success ?? null;
  return { provider, lastSuccess, cached: lastSuccess !== null,
    models: store.all('SELECT model_id AS id,display_name AS name FROM models WHERE provider=? ORDER BY model_id', provider) };
}
export function parseAgyModels(output) {
  const rows = output.trim().split(/\r?\n/).filter(line => line.trim() && line.trim() !== 'Fetching available models...');
  const models = rows.map(line => {
    const match = /^([A-Za-z0-9][A-Za-z0-9._:/-]*)\t([^\t\r\n]+)$/.exec(line);
    if (!match || !match[2].trim()) throw new Error('Unrecognized agy models output; cache preserved');
    return { id: match[1], name: match[2].trim() };
  });
  if (!models.length || new Set(models.map(m => m.id)).size !== models.length) throw new Error('Empty or duplicate model list; cache preserved');
  return models;
}
function query(exe, args) {
  return new Promise((resolve, reject) => execFile(exe, args, { windowsHide: true, timeout: 30000, maxBuffer: 256 * 1024 },
    (error, stdout) => error ? reject(new Error(`Model query failed (${error.code || 'unknown'}); cache preserved`)) : resolve(stdout)));
}
// Called only by the explicit models-refresh command. Normal task execution never calls this.
export async function refreshModels(store, provider, run = query) {
  check(provider);
  if (provider === 'claude') return { ...cachedModels(store, provider), refreshed: false, error: 'unsupported',
    detail: 'No supported non-interactive model-list command verified for Claude Code. Use its interactive /model picker. Existing cache preserved.' };
  try {
    const models = parseAgyModels(await run(executable(provider), ['models']));
    const timestamp = Date.now();
    store.tx(() => {
      store.run('DELETE FROM models WHERE provider=?', provider);
      for (const model of models) store.run('INSERT INTO models VALUES(?,?,?)', provider, model.id, model.name);
      store.run('INSERT OR REPLACE INTO model_refresh VALUES(?,?)', provider, timestamp);
    });
    return { ...cachedModels(store, provider), refreshed: true };
  } catch (error) { return { ...cachedModels(store, provider), refreshed: false, error: String(error.message).slice(0, 500) }; }
}
