export interface IisBinding {
  protocol: 'http' | 'https';
  port: number;
  ipAddress: string;
  hostHeader: string;
  sslCertificateThumbprint?: string;
  requireSni?: boolean;
}

export interface IisVirtualDirectory {
  path: string;
  physicalPath: string;
}

export interface IisSiteConfig {
  name: string;
  createIfNotExists: boolean;
  bindings: IisBinding[];
  preserveSslCertificates: boolean;
  virtualDirectories: IisVirtualDirectory[];
}

export interface IisAppPoolConfig {
  name: string;
  createIfNotExists: boolean;
  identity: string;
  managedRuntimeVersion: string;
  managedPipelineMode: 'Integrated' | 'Classic';
  idleTimeout: number;
  startMode: 'OnDemand' | 'AlwaysRunning';
  username?: string;
  password?: string;
}

export interface IisAuthenticationConfig {
  type: string;
  username?: string;
  password?: string;
  domain?: string;
}

export interface IisDeploymentOptions {
  stopSiteBeforeDeploy: boolean;
  stopAppPoolBeforeDeploy: boolean;
  startAfterSuccessfulDeployment: boolean;
}

export interface IisConfigFile {
  name: string;
  path: string | null;
  type: string;
  data: string;
  deployStrategy: 'merge' | 'override' | 'skip';
}

export interface IisDeploymentMessageDto {
  deployment: { id: string };

  application: {
    id: string;
    name: string;
    code: string;
    appId: string;
    registry: { url: string; name: string; type: string };
  };

  project: { id: string; name: string; code: string };
  environment: { id: string; name: string };
  version: { id: string; version: string };

  site: IisSiteConfig;
  appPool: IisAppPoolConfig;
  authentication: IisAuthenticationConfig;
  options: IisDeploymentOptions;
  configs: IisConfigFile[];
}

export interface IisDeploymentProgress {
  deploymentId: string;
  step: string;
  message: string;
  progress: number;
}

export interface IisDeploymentResult {
  success: boolean;
  physicalPath?: string;
  error?: string;
  logs?: string[];
}

export interface ExistingBinding {
  protocol: string;
  port: number;
  ipAddress: string;
  hostHeader: string;
  thumbprint?: string;
  sslFlags?: number;
}
