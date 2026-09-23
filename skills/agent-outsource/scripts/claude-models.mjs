import { executable } from './executables.mjs';

export async function queryClaudeModels(load = () => import('@anthropic-ai/claude-agent-sdk'), timeoutMs = 30000) {
  let sdk;
  try { sdk = await load(); }
  catch { throw new Error('Claude model-list SDK missing. Run npm install --ignore-scripts inside the installed agent-outsource skill folder, then explicitly refresh again.'); }
  const abortController = new AbortController();
  let release, timer, session;
  const waiting = new Promise(resolve => { release = resolve; });
  // Initialization/control only: never yield a user prompt or start model inference.
  async function* empty() { await waiting; }
  try {
    session = sdk.query({ prompt: empty(), options: {
      pathToClaudeCodeExecutable: executable('claude'), abortController,
      permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,
      persistSession: false, tools: [], settingSources: ['user'],
    } });
    const rows = await Promise.race([session.supportedModels(), new Promise((_, reject) => {
      timer = setTimeout(() => { reject(new Error('Claude model-list initialization timed out')); abortController.abort(); }, timeoutMs);
    })]);
    if (!Array.isArray(rows) || !rows.length) throw new Error('Empty Claude model list');
    const models = rows.map(row => {
      if (typeof row.value !== 'string' || !row.value.trim() || typeof row.displayName !== 'string' || !row.displayName.trim()) throw new Error('Invalid Claude model list');
      return { id: row.value, name: row.displayName };
    });
    if (new Set(models.map(m => m.id)).size !== models.length) throw new Error('Duplicate Claude model IDs');
    return models;
  } finally { clearTimeout(timer); release(); session?.close(); }
}
