export class DeploymentError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'DeploymentError';
    this.code = code;
    this.context = context;
    Object.setPrototypeOf(this, DeploymentError.prototype);
  }
}

export const DeploymentErrorCodes = {
  SCRIPT_NOT_PROVIDED: 'SCRIPT_NOT_PROVIDED',
  DIRECTORY_CREATION_FAILED: 'DIRECTORY_CREATION_FAILED',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  UNZIP_FAILED: 'UNZIP_FAILED',
  SCRIPT_EXECUTION_FAILED: 'SCRIPT_EXECUTION_FAILED',
  SCRIPT_TIMEOUT: 'SCRIPT_TIMEOUT',
  // IIS-specific error codes
  IIS_NOT_AVAILABLE: 'IIS_NOT_AVAILABLE',
  IIS_APP_POOL_CREATION_FAILED: 'IIS_APP_POOL_CREATION_FAILED',
  IIS_APP_POOL_CONFIG_FAILED: 'IIS_APP_POOL_CONFIG_FAILED',
  IIS_SITE_CREATION_FAILED: 'IIS_SITE_CREATION_FAILED',
  IIS_SITE_CONFIG_FAILED: 'IIS_SITE_CONFIG_FAILED',
  IIS_BINDING_CONFIG_FAILED: 'IIS_BINDING_CONFIG_FAILED',
  IIS_VIRTUAL_DIR_FAILED: 'IIS_VIRTUAL_DIR_FAILED',
  IIS_AUTH_CONFIG_FAILED: 'IIS_AUTH_CONFIG_FAILED',
  IIS_START_FAILED: 'IIS_START_FAILED',
  IIS_STOP_FAILED: 'IIS_STOP_FAILED',
  IIS_POWERSHELL_ERROR: 'IIS_POWERSHELL_ERROR',
  CONFIG_MERGE_FAILED: 'CONFIG_MERGE_FAILED',
} as const;

export type DeploymentErrorCode = typeof DeploymentErrorCodes[keyof typeof DeploymentErrorCodes];
