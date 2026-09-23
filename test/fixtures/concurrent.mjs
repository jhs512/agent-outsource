import { Store } from '../../skills/cli-worker-bridge/scripts/db.mjs';
const store = new Store(process.argv[2]);
const base = { caller: 'test-caller', provider: 'claude', name: 'concurrent', cwd: process.cwd(), prompt: 'hello' };
for (let i = 0; i < 20; i++) store.submit({ ...base, key: `shared-${i}` });
store.close();
