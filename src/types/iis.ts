/**
 * IIS Deployment Message Types
 * Defines the structure of messages received from the backend for IIS deployments
 */

export interface IisBinding {
  protocol: 'http' | 'https';
  port: number;
  ipAddress: string; // "*" for all IPs
  hostHeader: string;
  sslCertificateThumbprint?: string; // for HTTPS bindings
  requireSni?: boolean; // enable Server Name Indication (-SslFlags 1)
}

export interface IisVirtualDirectory {
  path: string; // e.g., "/api"
  physicalPath: string; // e.g., "C:\apps\myapp\api"
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
  identity: string; // "ApplicationPoolIdentity", "NetworkService", "LocalService", "LocalSystem", or "SpecificUser"
  managedRuntimeVersion: string; // "v4.0", "v2.0", "" (for .NET Core)
  managedPipelineMode: 'Integrated' | 'Classic';
  idleTimeout: number; // minutes
  startMode: 'OnDemand' | 'AlwaysRunning';
}

export interface IisAuthenticationConfig {
  type: string; // "Anonymous", "Windows", "Basic", etc.
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
  name: string; // filename, e.g., "appsettings.json"
  path: string | null; // relative path, e.g., "config/" or null for root
  type: string; // "json", "xml", "dotenv", "text", etc.
  data: string; // file content
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
  progress: number; // 0-100
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
}
