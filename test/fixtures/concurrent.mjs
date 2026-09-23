import { Store } from '../../skills/agent-outsource/scripts/db.mjs';
const store = new Store(process.argv[2]);
const base = { caller: 'test-caller', provider: 'claude', name: 'concurrent', cwd: process.cwd(), prompt: 'hello' };
for (let i = 0; i < 20; i++) store.submit({ ...base, key: `shared-${i}` });
store.close();
