import { clip } from './store.js';

export const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['completed', 'waiting_user', 'failed'] },
    summary: { type: 'string', maxLength: 2000 },
    question: { type: 'string', maxLength: 2000 },
  },
  required: ['status', 'summary', 'question'],
};

// Deliberately do not classify arbitrary prose or a zero exit code as success.
export function parseOutcome(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || !['completed', 'waiting_user', 'failed'].includes(value.status) ||
      typeof value.summary !== 'string' || typeof value.question !== 'string') return null;
  if (value.status === 'waiting_user' && !value.question.trim()) return null;
  return { status: value.status, summary: clip(value.summary), question: clip(value.question) };
}

// Bound parser memory even when tools emit megabytes without a newline.
export class JsonLines {
  constructor(onEvent, maxLine = 262144) {
    this.onEvent = onEvent;
    this.maxLine = maxLine;
    this.buffer = '';
    this.dropping = false;
  }
  feed(text) {
    for (const piece of text.split(/(?<=\n)/)) {
      const ends = piece.endsWith('\n');
      if (!this.dropping) {
        if (this.buffer.length + piece.length > this.maxLine) { this.buffer = ''; this.dropping = true; }
        else this.buffer += piece;
      }
      if (ends) {
        if (!this.dropping) this.parse();
        this.buffer = ''; this.dropping = false;
      }
    }
  }
  parse() { try { this.onEvent(JSON.parse(this.buffer)); } catch { /* Non-JSON logs stay on disk. */ } }
  end() { if (this.buffer && !this.dropping) this.parse(); }
}

export function instructions(prompt) {
  return `${prompt}\n\nReturn your final response as JSON matching this schema: ${JSON.stringify(schema)}. ` +
    'If a human decision is needed, return waiting_user with the actual question and stop. ' +
    'Never invent the human answer. Use completed only when the requested work is actually complete. ' +
    'Do not wrap JSON in Markdown.';
}
