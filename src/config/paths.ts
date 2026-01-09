import os from 'os';
import path from 'path';

const AGENT_HOME = process.env.AGENT_HOME || path.join(os.homedir(), 'HydraAgent');

export const PATHS = {
  AGENT_HOME,
  CURRENT_DIR: path.join(AGENT_HOME, 'current'),
  BACKUP_DIR: path.join(AGENT_HOME, 'backup'),
  UPDATE_DIR: path.join(AGENT_HOME, 'update'),
  CONFIG_DIR: path.join(AGENT_HOME, 'config'),
  LOGS_DIR: path.join(AGENT_HOME, 'logs'),

  // Signal files
  HEALTH_CHECK_SIGNAL: path.join(AGENT_HOME, 'config', 'health-check.signal'),
  RESTART_SIGNAL: path.join(AGENT_HOME, 'config', 'restart.signal'),
  UPDATE_LOCK: path.join(AGENT_HOME, 'update', 'update.lock'),
} as const;

export function getBinaryName(): string {
  return process.platform === 'win32' ? 'agent.exe' : 'agent';
}

export function getCurrentBinaryPath(): string {
  return path.join(PATHS.CURRENT_DIR, getBinaryName());
}

export function getBackupBinaryPath(): string {
  return path.join(PATHS.BACKUP_DIR, getBinaryName());
}

export function getNewBinaryPath(): string {
  return path.join(PATHS.UPDATE_DIR, getBinaryName() + '.new');
}
