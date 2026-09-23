import fs from 'node:fs';
import { start, answer, cancel, list, wait } from './manager.js';
import { readJob, publicJob, tail } from './store.js';

const [action, arg, extra] = process.argv.slice(2);
try {
  let result;
  switch (action) {
    case 'start': result = start(JSON.parse(fs.readFileSync(arg, 'utf8'))); break;
    case 'answer': result = answer(JSON.parse(fs.readFileSync(arg, 'utf8'))); break;
    case 'status': result = publicJob(readJob(arg)); break;
    case 'list': result = list(); break;
    case 'cancel': result = cancel(arg); break;
    case 'wait': result = await wait(arg); break;
    case 'log': result = tail(arg, extra); break;
    default: result = { usage: 'start <request.json> | answer <answer.json> | status <id> | list | cancel <id> | wait <id> | log <id> [stdout.log|stderr.log|events.jsonl]' };
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
