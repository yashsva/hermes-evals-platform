import { spawn, ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { killProcessesWithHome } from './process-reaper';

const exited = (child: ChildProcess) =>
  new Promise<NodeJS.Signals | null>((resolve) => child.on('exit', (_code, signal) => resolve(signal)));

describe('killProcessesWithHome', () => {
  const children: ChildProcess[] = [];
  let procRoot = '';

  afterEach(async () => {
    for (const child of children) child.kill('SIGKILL');
    children.length = 0;
    if (procRoot) await rm(procRoot, { recursive: true, force: true });
  });

  // A fake /proc: one entry per pid with a NUL-separated environ, as on Linux.
  async function fakeProc(entries: Array<{ pid: number; env: string[] }>) {
    procRoot = await mkdtemp(join(tmpdir(), 'proc-'));
    for (const { pid, env } of entries) {
      await mkdir(join(procRoot, String(pid)));
      await writeFile(join(procRoot, String(pid), 'environ'), env.join('\0') + '\0');
    }
    await mkdir(join(procRoot, 'self'));
  }

  it('kills only processes started with this trial home', async () => {
    const gateway = spawn('sleep', ['60']);
    const other = spawn('sleep', ['60']);
    children.push(gateway, other);
    await fakeProc([
      { pid: gateway.pid!, env: ['PATH=/bin', 'HERMES_HOME=/opt/data/trials/trial-7/home'] },
      // Same prefix, different trial: must survive.
      { pid: other.pid!, env: ['HERMES_HOME=/opt/data/trials/trial-7/home2'] },
    ]);

    const killed = await killProcessesWithHome('/opt/data/trials/trial-7/home', procRoot);

    expect(killed).toEqual([gateway.pid]);
    expect(await exited(gateway)).toBe('SIGKILL');
    expect(other.exitCode).toBeNull();
    expect(other.signalCode).toBeNull();
  });

  it('does nothing when /proc is unavailable', async () => {
    expect(await killProcessesWithHome('/x', '/definitely/not/here')).toEqual([]);
  });
});
