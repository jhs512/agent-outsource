import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
const exec = promisify(execFile);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function identity(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  if (process.platform === 'win32') {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){$p.CreationDate.ToUniversalTime().Ticks.ToString()}`], { windowsHide: true, timeout: 8000 });
    return stdout.trim() || null;
  }
  try { const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function killTree(pid, birth) {
  if (!birth || await identity(pid) !== birth) return false;
  if (process.platform === 'win32') {
    await exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }).catch(error => {
      if (!/not found|찾을 수 없|없습니다/i.test(String(error.stderr) + error.message)) throw error;
    });
  } else { try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); } }
  return true;
}
export function boundedCommand(exe, args, timeout = 20000) {
  return new Promise(resolve => {
    let output = '', timedOut = false, spawnError;
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const append = chunk => { output = (output + chunk.toString()).slice(-2048); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', error => { spawnError = error.message; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0 && !timedOut && !spawnError, uncertain: timedOut, detail: spawnError || output }); });
  });
}
