import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { PATHS } from '../config/paths';

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
  return existsSync(PATHS.UPDATE_LOCK);
}
