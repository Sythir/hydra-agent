import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentErrorCodes } from '../../types/DeploymentError';
import { executePowerShellOrThrow, escapePowerShellString } from './powershell.service';
import { IisAuthenticationConfig } from '../../types/step-types/iis';

/**
 * List of supported authentication types
 */
const SUPPORTED_AUTH_TYPES = ['anonymous', 'windows', 'basic', 'digest'];

/**
 * Disables all authentication types for a website
 */
async function disableAllAuthentication(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', 'Disabling all authentication types');

  for (const authType of SUPPORTED_AUTH_TYPES) {
    await executePowerShellOrThrow(
      `
      Import-Module WebAdministration
      $filter = "/system.webServer/security/authentication/${authType}Authentication"
      Set-WebConfigurationProperty -Filter $filter -Name "enabled" -Value "false" -PSPath "IIS:\\" -Location '${escapePowerShellString(siteName)}' -ErrorAction SilentlyContinue
      Write-Output "${authType} authentication disabled"
      `,
      logger,
      deployFolder,
      DeploymentErrorCodes.IIS_AUTH_CONFIG_FAILED,
    );
  }
}

/**
 * Enables a specific authentication type for a website
 */
async function enableAuthentication(
  siteName: string,
  authType: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  const normalizedAuthType = authType.toLowerCase();

  if (!SUPPORTED_AUTH_TYPES.includes(normalizedAuthType)) {
    logger(deployFolder, 'warning', `Unknown authentication type: ${authType}, skipping`);
    return;
  }

  logger(deployFolder, 'info', `Enabling ${authType} authentication`);

  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $filter = "/system.webServer/security/authentication/${normalizedAuthType}Authentication"
    Set-WebConfigurationProperty -Filter $filter -Name "enabled" -Value "true" -PSPath "IIS:\\" -Location '${escapePowerShellString(siteName)}'
    Write-Output "${authType} authentication enabled"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_AUTH_CONFIG_FAILED,
  );
}

/**
 * Configures the defaultLogonDomain for Basic authentication
 */
async function configureBasicAuthCredentials(
  siteName: string,
  domain: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Configuring Basic auth defaultLogonDomain for site: ${siteName}`);

  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    Set-WebConfigurationProperty \`
      -Filter "/system.webServer/security/authentication/basicAuthentication" \`
      -Name "defaultLogonDomain" \`
      -Value '${escapePowerShellString(domain)}' \`
      -PSPath "IIS:\\" -Location '${escapePowerShellString(siteName)}'
    Write-Output "Basic auth defaultLogonDomain set to: ${escapePowerShellString(domain)}"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_AUTH_CONFIG_FAILED,
  );
}

/**
 * Configures Windows authentication domain settings
 */
async function configureWindowsAuthDomain(
  siteName: string,
  domain: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Configuring Windows auth domain settings for site: ${siteName}`);

  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    Set-WebConfigurationProperty \`
      -Filter "/system.webServer/security/authentication/windowsAuthentication" \`
      -Name "authPersistNonNTLM" \`
      -Value $false \`
      -PSPath "IIS:\\" -Location '${escapePowerShellString(siteName)}'
    Write-Output "Windows auth domain configured: ${escapePowerShellString(domain)}"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_AUTH_CONFIG_FAILED,
  );
}

/**
 * Configures authentication for a website
 */
export async function configureAuthentication(
  siteName: string,
  authConfig: IisAuthenticationConfig | null,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  if (!authConfig || !authConfig?.type) {
    logger(deployFolder, 'info', 'No authentication type specified, skipping authentication configuration');
    return;
  }

  logger(deployFolder, 'info', `Configuring authentication for site: ${siteName}`);

  // First, disable all authentication types
  await disableAllAuthentication(siteName, logger, deployFolder);

  // Then enable the specified authentication type
  await enableAuthentication(siteName, authConfig.type, logger, deployFolder);

  if (authConfig.type === 'basic' && authConfig.domain) {
    await configureBasicAuthCredentials(siteName, authConfig.domain, logger, deployFolder);
  }

  if (authConfig.type === 'windows' && authConfig.domain) {
    await configureWindowsAuthDomain(siteName, authConfig.domain, logger, deployFolder);
  }

  logger(deployFolder, 'info', `Authentication configured successfully: ${authConfig.type}`);
}
