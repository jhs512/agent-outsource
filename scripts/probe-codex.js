import { spawn } from 'node:child_process';

// Read-only connection test. Never creates a second server or changes the active conversation.
const child = spawn('codex', ['app-server', 'proxy'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '', stdout = '';
const timer = setTimeout(() => { child.kill(); }, 5000);
child.stdin.on('error', () => {});
child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: {
  clientInfo: { name: 'ai-oc-probe', version: '0.1.0' },
} }) + '\n');
child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-4096); });
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
child.on('error', error => { stderr = error.message; });
child.on('close', code => {
  clearTimeout(timer);
  console.log(JSON.stringify({ connected: stdout.includes('"result"'), exitCode: code,
    currentVoiceWakeVerified: false, detail: stderr,
    note: 'A successful transport connection alone does not prove waking an idle desktop voice conversation.' }, null, 2));
});
