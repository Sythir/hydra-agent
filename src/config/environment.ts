import { DEFAULT_DEPLOY_TIMEOUT_SECONDS, DEFAULT_KEEP_DEPLOYMENTS } from './constants';

interface EnvironmentConfig {
  agentKey: string;
  agentVersion: string | undefined;
  host: string;
  deployLogsDirectory: string;
  deployTimeoutSeconds: number;
}

function getRequiredEnv(key: string, fallback?: string): string {
  const value = process.env[key] || fallback;
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

function getOptionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function getEnvNumber(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export function loadEnvironmentConfig(args: string[]): EnvironmentConfig {
  const tokenIndex = args.indexOf('--agent-key');
  const agentKey = process.env.AGENT_KEY || (tokenIndex !== -1 ? args[tokenIndex + 1] : undefined);

  if (!agentKey) {
    throw new Error(
      'Agent key is not set. Use the AGENT_KEY environment variable or pass it as an argument (e.g. --agent-key <agent-key>)',
    );
  }

  return {
    agentKey,
    agentVersion: process.env.AGENT_VERSION,
    host: getOptionalEnv('HOST', 'https://hydra.sythir.com/api/deployment-gateway'),
    deployLogsDirectory: getOptionalEnv('DEPLOY_LOGS_DIRECTORY', ''),
    deployTimeoutSeconds: getEnvNumber('DEPLOY_TIMEOUT_IN_SECONDS', DEFAULT_DEPLOY_TIMEOUT_SECONDS),
  };
}

export function parseKeepDeployments(args: string[]): number {
  const keepDeploymentsIndex = args.indexOf('--keep-deployments');
  if (keepDeploymentsIndex === -1) {
    return DEFAULT_KEEP_DEPLOYMENTS;
  }

  const parsedValue = parseInt(args[keepDeploymentsIndex + 1], 10);
  if (isNaN(parsedValue) || parsedValue <= 0) {
    console.warn(`Invalid value for --keep-deployments. Using default value of ${DEFAULT_KEEP_DEPLOYMENTS}.`);
    return DEFAULT_KEEP_DEPLOYMENTS;
  }

  return parsedValue;
}
