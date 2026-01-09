import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { PATHS, getNewBinaryPath } from '../config/paths';

export async function isUpdateLocked(): Promise<boolean> {
  return existsSync(PATHS.UPDATE_LOCK);
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
    // Ignore if doesn't exist
  }
}

export async function writeRestartSignal(
  targetVersion: string,
  newBinaryPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(PATHS.RESTART_SIGNAL), { recursive: true });

  // First line is binary path (for launcher to read)
  // Rest is metadata
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
