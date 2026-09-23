import fs from 'node:fs';
const dir = process.env.AI_OC_TEST_DIR;
if (fs.existsSync(`${dir}/fail-notify`)) process.exit(1);
const args = process.argv.slice(2);
const caller = args[args.indexOf('--thread') + 1];
const message = args[args.indexOf('--message') + 1];
fs.appendFileSync(`${dir}/notifications.jsonl`, JSON.stringify({ caller, message }) + '\n');
