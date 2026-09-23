import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';

async function probe(exe, args) {
  return new Promise(resolve => execFile(exe, args, { windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024 },
    (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout || ''), output: String(stdout || '') + String(stderr || ''), code: error?.code })));
}
export async function inspectSetup({ bridgeDirectory = fileURLToPath(new URL('../../agent-outsource/', import.meta.url)),
  databasePath, run = probe, platform = process.platform, nodeVersion = process.versions.node } = {}) {
  // script lives in setup/scripts; sibling skills are two levels above the script directory.
  const checks = [], workers = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  if (Number(nodeVersion.split('.')[0]) < 24) { add('Node.js', 'missing', 'Node.js 24 이상을 설치하세요.'); return { configured: false, workers, checks }; }
  add('Node.js', 'ok', nodeVersion);
  if (!['win32', 'linux'].includes(platform)) { add('OS', 'missing', '현재 프로세스 복구는 Windows/Linux만 구현되어 있습니다.'); return { configured: false, workers, checks }; }
  add('OS', platform === 'win32' ? 'ok' : 'manual', platform === 'win32' ? 'Windows' : 'Linux: 실제 CLI 통합은 Windows에서 검증했습니다.');
  if (!fs.existsSync(path.join(bridgeDirectory, 'scripts', 'db.mjs'))) {
    add('작업 스킬', 'missing', 'agent-outsource와 agent-outsource-setup을 같은 skills 폴더에 설치하세요.');
    return { configured: false, workers, checks };
  }
  add('작업 스킬', 'ok', bridgeDirectory);
  const { executable } = await import(pathToFileURL(path.join(bridgeDirectory, 'scripts', 'executables.mjs')));
  try {
    const { Store } = await import(pathToFileURL(path.join(bridgeDirectory, 'scripts', 'db.mjs')));
    const store = new Store(databasePath);
    try {
      const journal = store.get('PRAGMA journal_mode').journal_mode;
      const integrity = store.get('PRAGMA quick_check').quick_check;
      add('SQLite', journal === 'wal' && integrity === 'ok' ? 'ok' : 'missing', `${store.filename} (WAL: ${journal}, 검사: ${integrity})`);
    } finally { store.close(); }
  } catch (error) { add('SQLite', 'missing', `홈 DB를 준비하지 못했습니다: ${error.message}`); }
  const codex = executable('codex');
  const queue = await run(codex, ['queue', '--help']);
  add('Codex 알림', queue.ok && /--thread/.test(queue.output) && /--message/.test(queue.output) ? 'ok' : 'missing',
    queue.ok && /--thread/.test(queue.output) && /--message/.test(queue.output) ? `${codex}: queue 명령 확인` : 'codex queue를 지원하는 Codex CLI가 PATH에 필요합니다. Codex 앱에서 다시 실행하거나 CLI 설치/업데이트를 확인하세요.');
  for (const provider of ['claude', 'antigravity']) {
    const exe = executable(provider);
    const version = await run(exe, ['--version']);
    if (!version.ok) { add(provider, 'optional', `${provider === 'antigravity' ? 'agy' : 'claude'}를 찾지 못했습니다. 이 작업자를 사용하려면 설치하세요.`); continue; }
    const help = await run(exe, ['--help']);
    const required = ['--dangerously-skip-permissions', '--input-format', '--output-format', provider === 'claude' ? '--resume' : '--conversation'];
    if (!help.ok || required.some(option => !help.output.includes(option))) { add(provider, 'missing', '필요한 CLI 옵션이 없습니다. 이 작업자 CLI를 업데이트하세요.'); continue; }
    add(provider, 'ok', `${exe} (${version.output.trim().slice(0, 120)})`);
    workers.push(provider);
    if (provider === 'claude') {
      const auth = await run(exe, ['auth', 'status', '--json']);
      let loggedIn; try { loggedIn = JSON.parse(auth.stdout ?? auth.output).loggedIn; } catch { }
      add('Claude 로그인', loggedIn === true ? 'ok' : 'manual', loggedIn === true ? '로그인 확인됨' : 'claude auth login을 직접 실행해 로그인하세요. 계정 정보는 여기에 입력하지 마세요.');
    } else add('Antigravity 로그인', 'manual', '자동 확인하지 않았습니다. agy를 직접 열어 로그인 완료 여부를 확인하세요.');
  }
  return { configured: !checks.some(c => c.status === 'missing') && workers.length > 0, workers, checks,
    note: '설치·기능 검사는 모델을 호출하지 않습니다. 로그인/실제 알림 수신까지 보장하는 결과는 아닙니다. 작업 실행 시 권한은 자동 승인됩니다.' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  inspectSetup().then(result => {
    if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.configured ? '설치 및 실행 기능 검사 통과. 아래 수동 확인도 완료하세요.' : '아래 준비 항목을 해결한 뒤 셋업을 다시 실행하세요.');
      for (const c of result.checks) console.log(`[${c.status}] ${c.name}: ${c.detail}`);
      if (result.note) console.log(result.note);
    }
    process.exitCode = result.configured ? 0 : 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
