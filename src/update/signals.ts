import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { PATHS } from '../config/paths';

// A lock older than this is treated as leftover from an update that never finished (the agent was
// killed, or an older build wrote the lock somewhere the launcher could not clean up). Without
// this, one broken update blocks every future update with "Update already in progress".
const STALE_LOCK_MS = 15 * 60 * 1000;

export async function isUpdateLocked(): Promise<boolean> {
  if (!existsSync(PATHS.UPDATE_LOCK)) {
    return false;
  }

  try {
    const stats = await fs.stat(PATHS.UPDATE_LOCK);
    if (Date.now() - stats.mtimeMs > STALE_LOCK_MS) {
      console.warn(`Ignoring stale update lock at ${PATHS.UPDATE_LOCK}`);
      await releaseUpdateLock();
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

export async function acquireUpdateLock(updateId: string): Promise<void> {
  await fs.mkdir(path.dirname(PATHS.UPDATE_LOCK), { recursive: true });

  const lockData = {
    updateId,
    timestamp: new Date().toISOString(),
    pid: process.pid,
  };

  await fs.writeFile(PATHS.UPDATE_LOCK, JSON.stringify(lockData));
}

export async function releaseUpdateLock(): Promise<void> {
  try {
    await fs.unlink(PATHS.UPDATE_LOCK);
  } catch {
  }
}

export async function writeRestartSignal(
  targetVersion: string,
  newBinaryPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(PATHS.RESTART_SIGNAL), { recursive: true });

  const content = [
    newBinaryPath,
    `version=${targetVersion}`,
    `timestamp=${new Date().toISOString()}`,
  ].join('\n');

  await fs.writeFile(PATHS.RESTART_SIGNAL, content);
}

export async function ensureUpdateDirectories(): Promise<void> {
  await fs.mkdir(PATHS.CURRENT_DIR, { recursive: true });
  await fs.mkdir(PATHS.BACKUP_DIR, { recursive: true });
  await fs.mkdir(PATHS.UPDATE_DIR, { recursive: true });
  await fs.mkdir(PATHS.CONFIG_DIR, { recursive: true });
  await fs.mkdir(PATHS.LOGS_DIR, { recursive: true });
}
