import { executable } from './executables.mjs';
export const schema = { type: 'object', additionalProperties: false, properties: {
  status: { type: 'string', enum: ['completed', 'waiting_user', 'failed'] },
  summary: { type: 'string' }, question: { type: 'string' },
}, required: ['status', 'summary', 'question'] };
export function providerCommand(job, run) {
  // An execution invariant, including old DB runs whose options still say manual.
  const common = ['--dangerously-skip-permissions', '--input-format', 'stream-json', '--output-format', 'stream-json'];
  if (job.provider === 'claude') {
    const args = ['-p', '--verbose', ...common, '--json-schema', JSON.stringify(schema), '--permission-prompt-tool', 'stdio'];
    if (job.session) args.push('--resume', job.session);
    return { exe: executable('claude'), args };
  }
  const args = [...common, '--print-timeout', '0'];
  if (job.session) args.push('--conversation', job.session);
  return { exe: executable('antigravity'), args };
}
export function promptMessage(provider, prompt) {
  const text = `${prompt}\n\nFinal response must match this JSON schema: ${JSON.stringify(schema)}. ` +
    'Use waiting_user if a human answer is needed and put the actual question in question. Never invent human decisions. ' +
    'Use failed if the work could not be completed. A denied tool is not task success. Otherwise use completed, with question empty.';
  return provider === 'claude' ? { type: 'user', message: { role: 'user', content: text } } : { event: 'user', message: { content: text } };
}
export function outcome(event, provider) {
  const result = provider === 'claude' ? event : event.result;
  if (!result) return null;
  let parsed = result.structured_output;
  if (!parsed) { try { parsed = JSON.parse(provider === 'claude' ? result.result : result.response); } catch { /* Review below. */ } }
  const providerFailed = provider === 'claude' ? result.is_error : !['SUCCESS', 'WAITING'].includes(result.status);
  if (providerFailed) return { status: result.status === 'INTERRUPTED' ? 'interrupted' : 'failed', summary: result.error || result.result || 'Provider failure', raw: result };
  if (parsed && ['completed', 'waiting_user', 'failed'].includes(parsed.status) && typeof parsed.summary === 'string' && typeof parsed.question === 'string') {
    if (parsed.status === 'waiting_user' && !parsed.question.trim()) return { status: 'needs_review', summary: 'Empty question', raw: result };
    return { ...parsed, raw: result };
  }
  return { status: 'needs_review', summary: 'Provider returned no valid task outcome; inspect bounded result.', raw: result };
}
export function liveReply(question) {
  const payload = JSON.parse(question.payload), answer = JSON.parse(question.answer);
  let response;
  if (question.kind === 'permission') {
    response = answer.decision === 'allow' ? { behavior: 'allow', updatedInput: payload.input || {} }
      : { behavior: 'deny', message: answer.text || 'Human denied this action' };
  } else {
    const questions = payload.input?.questions || [];
    const answers = answer.answers || (questions.length === 1 ? { [questions[0].question]: answer.text } : null);
    if (!answers || questions.some(q => typeof answers[q.question] !== 'string')) throw new Error('An explicit answer for each question is required');
    response = { behavior: 'allow', updatedInput: { ...payload.input, answers } };
  }
  return { type: 'control_response', response: { subtype: 'success', request_id: question.provider_id, response } };
}
export class JsonLines {
  constructor(onEvent, onOversize = () => {}, max = 1024 * 1024) { this.onEvent = onEvent; this.onOversize = onOversize; this.max = max; this.buffer = ''; this.dropping = false; }
  feed(text) {
    for (const part of text.split(/(?<=\n)/)) {
      if (!this.dropping) {
        if (this.buffer.length + part.length > this.max) { this.buffer = ''; this.dropping = true; this.onOversize(); }
        else this.buffer += part;
      }
      if (part.endsWith('\n')) { if (!this.dropping) this.parse(); this.buffer = ''; this.dropping = false; }
    }
  }
  parse() { let event; try { event = JSON.parse(this.buffer); } catch { return; } this.onEvent(event); }
  end() { if (this.buffer && !this.dropping) this.parse(); }
}
