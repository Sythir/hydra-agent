export const DEFAULT_KEEP_DEPLOYMENTS = 5;
export const DEFAULT_DEPLOY_TIMEOUT_SECONDS = 60;

export const DEPLOYMENT_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in-progress',
  SUCCESS: 'success',
  ERROR: 'error',
} as const;

export type DeploymentStatus = typeof DEPLOYMENT_STATUS[keyof typeof DEPLOYMENT_STATUS];

export const SOCKET_EVENTS = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  REGISTER_KEY: 'register-key',
  VERSION_STATUS: 'version-status',
  LOG: 'log',
} as const;

export const DEPLOY_FOLDER_NAME = 'HydraDeploys';
