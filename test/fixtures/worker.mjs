import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
const [provider, resume] = process.argv.slice(2);
const session = resume || randomUUID();
const rl = readline.createInterface({ input: process.stdin });
let pending, timer;
function emit(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function result(status = 'completed', summary = 'fixture completed', question = '') {
  const value = { status, summary, question };
  if (provider === 'claude') emit({ type: 'result', session_id: session, is_error: false, structured_output: value });
  else emit({ event: 'result', result: { status: 'SUCCESS', conversation_id: session, structured_output: value } });
}
if (provider === 'claude') emit({ type: 'system', subtype: 'init', session_id: session });
else emit({ event: 'init', conversation_id: session });
rl.on('line', line => {
  const event = JSON.parse(line);
  if (event.type === 'control_response') {
    result('completed', `live reply ${event.response.response.behavior}: ${JSON.stringify(event.response.response.updatedInput || {})}`); return;
  }
  const text = event.message.content;
  if (text.startsWith('CRASH')) return process.exit(7);
  if (text.startsWith('EMPTY')) return process.exit(0);
  if (text.startsWith('SILENT')) { timer = setTimeout(() => result(), 60000); return; }
  if (text.startsWith('HUGE')) { process.stdout.write('X'.repeat(2 * 1024 * 1024) + '\n'); return result(); }
  if (text.startsWith('QUESTION_END')) return result('waiting_user', 'Need an actual answer', 'red or blue?');
  if (text.startsWith('QUESTION_LIVE') || text.startsWith('PERMISSION')) {
    pending = text.startsWith('QUESTION_LIVE') ? 'AskUserQuestion' : 'Write';
    emit({ type: 'control_request', request_id: 'test-permission', request: { subtype: 'can_use_tool', tool_name: pending,
      input: pending === 'AskUserQuestion' ? { questions: [{ question: 'red or blue?' }] } : { file_path: 'test.txt', content: 'safe' } } }); return;
  }
  result('completed', resume ? 'same session resumed' : 'fixture completed');
});
rl.on('close', () => { if (!timer) process.exit(0); });
