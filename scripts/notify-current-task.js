import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Experimental: reuses the installed app-tools bridge and inherited app environment.
// This is not a documented public external API, and may change with app updates.
const delay = Number(process.argv[2] || 20000);
if (!Number.isFinite(delay) || delay < 0 || delay > 60000) throw new Error('Invalid delay');
const threadId = process.env.CODEX_THREAD_ID;
if (!threadId || !process.env.CODEX_APP_TOOLS_PIPE_PATH) throw new Error('Run from the target Codex task environment');
const dir = path.resolve('.ai-oc');
fs.mkdirSync(dir, { recursive: true });
const record = data => fs.appendFileSync(path.join(dir, 'notification-probe.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...data }) + '\n');
record({ phase: 'scheduled', delay });
await new Promise(resolve => setTimeout(resolve, delay));
const server = process.env.AI_OC_APP_TOOLS_SERVER || path.join(os.homedir(), '.codex', 'plugins', 'cache',
  'openai-bundled', 'codex-app-tools', '0.1.4', 'server.mjs');
const client = new Client({ name: 'ai-oc-external-notifier', version: '0.1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server],
    env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
    stderr: 'ignore' }));
  record({ phase: 'sending' });
  const result = await client.callTool({ name: 'send_message_to_thread', arguments: {
    threadId,
    prompt: '외부 알림 실험: ai-oc의 별도 Node.js 프로세스가 대기 후 이 메시지를 현재 작업에 전달했습니다. 작업자 실행 완료 알림을 흉내 낸 단발 테스트입니다. 실제 작업자 작업 완료를 의미하지 않습니다.',
  }, _meta: { 'openai/threadId': threadId } });
  record({ phase: 'response', result });
} catch (error) {
  record({ phase: 'failed', error: error.message }); process.exitCode = 1;
} finally { await client.close(); }
