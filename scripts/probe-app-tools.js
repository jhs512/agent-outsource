import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import os from 'node:os';

const server = process.env.AI_OC_APP_TOOLS_SERVER || path.join(os.homedir(), '.codex', 'plugins', 'cache',
  'openai-bundled', 'codex-app-tools', '0.1.4', 'server.mjs');
const client = new Client({ name: 'ai-oc-notification-probe', version: '0.1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [server],
  env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
  stderr: 'ignore' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const tool = tools.find(tool => tool.name === 'send_message_to_thread');
  console.log(JSON.stringify({ externalConnection: true, sendMessageTool: tool || null }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ externalConnection: false, error: error.message }));
  process.exitCode = 1;
} finally { await client.close(); }
