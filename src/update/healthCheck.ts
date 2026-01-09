import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { PATHS } from '../config/paths';

/**
 * Write health check signal after successful startup.
 * Called once the agent has:
 * 1. Successfully connected to Socket.IO
 * 2. Registered with the server
 */
export async function signalHealthy(): Promise<void> {
  const signal = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    version: process.env.AGENT_VERSION,
  };

  await fs.mkdir(path.dirname(PATHS.HEALTH_CHECK_SIGNAL), { recursive: true });
  await fs.writeFile(PATHS.HEALTH_CHECK_SIGNAL, JSON.stringify(signal));
}

export function isPostUpdateStartup(): boolean {
  // Check if update lock exists (indicates we're in update flow)
  return existsSync(PATHS.UPDATE_LOCK);
}
