export interface AgentUpdateMessage {
  updateId: string;
  targetVersion: string;
  downloadUrl: string;
  checksum?: string;
  force?: boolean;
}

export interface AgentUpdateStatusMessage {
  updateId: string;
  status: UpdateStatus;
  currentVersion: string;
  targetVersion: string;
  error?: string;
  progress?: number;
}

export type UpdateStatus =
  | 'downloading'
  | 'downloaded'
  | 'restarting'
  | 'health-check'
  | 'success'
  | 'rollback'
  | 'failed';

export const UPDATE_STATUS = {
  DOWNLOADING: 'downloading',
  DOWNLOADED: 'downloaded',
  RESTARTING: 'restarting',
  HEALTH_CHECK: 'health-check',
  SUCCESS: 'success',
  ROLLBACK: 'rollback',
  FAILED: 'failed',
} as const;
