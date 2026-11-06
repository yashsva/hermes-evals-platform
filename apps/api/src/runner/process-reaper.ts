import { readdir, readFile } from 'node:fs/promises';

/**
 * Kills every process whose environment has `HERMES_HOME=<homeDir>`.
 *
 * Each `hermes chat` starts a gateway daemon (`gateway run --idle-exit`, ~330 MB) in its own session.
 * It is outside the chat's process group and outlives the chat, so without this they pile up until the
 * container runs out of memory. The trial's home is unique, so matching on it kills only this trial's processes.
 * Linux only (reads /proc); elsewhere it does nothing.
 */
export async function killProcessesWithHome(homeDir: string, procRoot = '/proc'): Promise<number[]> {
  let entries: string[];
  try {
    entries = await readdir(procRoot);
  } catch {
    return [];
  }
  const needle = `HERMES_HOME=${homeDir}`;
  const killed: number[] = [];
  for (const entry of entries) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
    try {
      const environ = await readFile(`${procRoot}/${entry}/environ`, 'latin1');
      if (!environ.split('\0').includes(needle)) continue;
      process.kill(pid, 'SIGKILL');
      killed.push(pid);
    } catch {
      // exited meanwhile, or not ours to read
    }
  }
  return killed;
}
