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
} as const;

export type DeploymentErrorCode = typeof DeploymentErrorCodes[keyof typeof DeploymentErrorCodes];
