// Opt-in protocol probes, using only a harmless echo command and a synthetic question.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
const dir = path.resolve('.ai-oc/agy-capabilities-' + Date.now()); fs.mkdirSync(dir, { recursive: true });
const exe = path.join(process.env.LOCALAPPDATA, 'agy/bin/agy.exe');
const evidence = [];
for (const mode of ['control-input', 'bypass-command', 'native-question']) {
  const item = await new Promise(resolve => {
    const args = ['--dangerously-skip-permissions', '--input-format', 'stream-json', '--output-format', 'stream-json', '--print-timeout', '0'];
    const child = spawn(exe, args, { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = fs.createWriteStream(path.join(dir, `${mode}.jsonl`)); child.stdout.pipe(output);
    const decoder = new StringDecoder('utf8'); let buffer = '', stderr = '', result, steps = [];
    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      for (;;) {
        const i = buffer.indexOf('\n'); if (i < 0) break;
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        try {
          const event = JSON.parse(line);
          if (event.event === 'step_update' && event.step_update.tool_info) steps.push(event.step_update.tool_info);
          if (event.event === 'result') { result = event.result; child.stdin.end(); }
        } catch { }
      }
    });
    child.stderr.on('data', c => { stderr = (stderr + c).slice(-4000); });
    child.stdin.on('error', () => {});
    const prompt = mode === 'native-question' ? 'Synthetic protocol test: use ask_question to ask which color I choose, red or blue. Do not decide. If no interactive input is available, report that limitation.'
      : 'Harmless permission protocol test. Use run_command exactly once to run echo BRIDGE_PERMISSION. Do not use any other tools. If permission is denied, report the denial and stop. Do not retry.';
    const event = mode === 'control-input' ? { event: 'control_response', response: { request_id: 'probe', behavior: 'deny' } } : { event: 'user', message: { content: prompt } };
    child.stdin.write(JSON.stringify(event) + '\n');
    const timer = setTimeout(() => { spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }, 45000);
    child.on('close', code => { clearTimeout(timer); resolve({ mode, code, status: result?.status, response: result?.response?.slice(0,1500), error: result?.error, steps, stderr }); });
  });
  evidence.push(item); fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(item));
}
console.log(JSON.stringify({ evidenceDirectory: dir }));
