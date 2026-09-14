import { IisAuthenticationConfig } from '../../types/iis';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentErrorCodes } from '../../types/DeploymentError';
import { executePowerShellOrThrow, escapePowerShellString } from './powershell.service';

const SUPPORTED_AUTH_TYPES = ['anonymous', 'windows', 'basic', 'digest'] as const;

export type AuthType = (typeof SUPPORTED_AUTH_TYPES)[number];

export interface AuthenticationState {
  anonymous: boolean;
  windows: boolean;
  basic: boolean;
  digest: boolean;
  basicDefaultLogonDomain: string;
  windowsAuthPersistNonNTLM: boolean;
}

export interface AuthenticationChangePlan {
  enable: AuthType[];
  disable: AuthType[];
  unchanged: AuthType[];
  /** Basic auth's defaultLogonDomain, when it differs from what the site already has. */
  setBasicLogonDomain: string | null;
  /** Windows auth's authPersistNonNTLM, when it differs from what the site already has. */
  setWindowsAuthPersistNonNTLM: boolean | null;
}

/**
 * The state to assume when the site's current authentication cannot be read: every provider but the
 * wanted one reads as enabled, and the wanted one reads as disabled. The plan that follows then
 * writes all four explicitly - exactly what the old unconditional code did.
 *
 * Both halves matter. Assuming the others are off would skip their disables and could leave a stale
 * provider such as anonymous switched on; assuming the wanted one is already on would skip its
 * enable and could leave the site with no authentication provider at all.
 */
export function conservativeAuthenticationState(desiredType: AuthType): AuthenticationState {
  return {
    anonymous: desiredType !== 'anonymous',
    windows: desiredType !== 'windows',
    basic: desiredType !== 'basic',
    digest: desiredType !== 'digest',
    basicDefaultLogonDomain: '',
    windowsAuthPersistNonNTLM: true,
  };
}

/**
 * Reads which authentication providers the site currently has enabled.
 *
 * A provider whose module is not installed reports as disabled rather than failing, so a host
 * without, say, Digest installed is simply left alone instead of erroring on every deployment.
 *
 * Returns null when the state cannot be read, so the caller can fall back to rewriting everything
 * rather than acting on a state it does not actually know.
 */
export async function getAuthenticationState(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<AuthenticationState | null> {
  const site = escapePowerShellString(siteName);

  const result = await executePowerShellOrThrow(
    `
    Import-Module WebAdministration

    function Read-AuthProperty($filter, $name) {
      $raw = Get-WebConfigurationProperty -Filter $filter -Name $name -PSPath "IIS:\\" -Location '${site}' -ErrorAction SilentlyContinue
      if ($null -eq $raw) { return $null }
      if ($null -ne $raw.Value) { return $raw.Value }
      return $raw
    }

    $state = @{}
    foreach ($type in @('anonymous','windows','basic','digest')) {
      $value = Read-AuthProperty "/system.webServer/security/authentication/$($type)Authentication" "enabled"
      $state[$type] = if ($null -eq $value) { $false } else { [bool]$value }
    }

    $domain = Read-AuthProperty "/system.webServer/security/authentication/basicAuthentication" "defaultLogonDomain"
    $state['basicDefaultLogonDomain'] = if ($null -eq $domain) { '' } else { [string]$domain }

    $persist = Read-AuthProperty "/system.webServer/security/authentication/windowsAuthentication" "authPersistNonNTLM"
    $state['windowsAuthPersistNonNTLM'] = if ($null -eq $persist) { $false } else { [bool]$persist }

    $state | ConvertTo-Json -Compress
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_AUTH_CONFIG_FAILED,
  );

  try {
    const parsed = JSON.parse(result);
    if (!isAuthenticationStatePayload(parsed)) {
      throw new Error(`unexpected shape: ${result.substring(0, 120)}`);
    }
    return {
      anonymous: parsed.anonymous,
      windows: parsed.windows,
      basic: parsed.basic,
      digest: parsed.digest,
      basicDefaultLogonDomain: String(parsed.basicDefaultLogonDomain ?? ''),
      windowsAuthPersistNonNTLM: Boolean(parsed.windowsAuthPersistNonNTLM),
    };
  } catch (error) {
    logger(
      deployFolder,
      'warning',
      `Could not read current authentication state of site '${siteName}' ` +
        `(${error instanceof Error ? error.message : String(error)}), ` +
        `falling back to rewriting every authentication provider`,
    );
    return null;
  }
}

function isAuthenticationStatePayload(
  value: unknown,
): value is Record<'anonymous' | 'windows' | 'basic' | 'digest', boolean> & Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return SUPPORTED_AUTH_TYPES.every((type) => typeof record[type] === 'boolean');
}

/**
 * Works out the smallest set of authentication changes. Pure, so the decisions can be tested
 * without an IIS host.
 *
 * The site keeps exactly one provider enabled, so anything else that is on gets turned off - but
 * only if it is actually on. Rewriting all four providers on every deployment means the site spends
 * the gap between "everything disabled" and "the right one enabled" with no authentication method
 * at all, which IIS answers with 401.2.
 */
export function planAuthenticationChanges(
  desiredType: AuthType,
  domain: string | undefined,
  current: AuthenticationState,
): AuthenticationChangePlan {
  const plan: AuthenticationChangePlan = {
    enable: [],
    disable: [],
    unchanged: [],
    setBasicLogonDomain: null,
    setWindowsAuthPersistNonNTLM: null,
  };

  for (const type of SUPPORTED_AUTH_TYPES) {
    const wanted = type === desiredType;
    if (current[type] === wanted) {
      plan.unchanged.push(type);
    } else if (wanted) {
      plan.enable.push(type);
    } else {
      plan.disable.push(type);
    }
  }

  if (desiredType === 'basic' && domain && current.basicDefaultLogonDomain !== domain) {
    plan.setBasicLogonDomain = domain;
  }

  if (desiredType === 'windows' && domain && current.windowsAuthPersistNonNTLM !== false) {
    plan.setWindowsAuthPersistNonNTLM = false;
  }

  return plan;
}

async function setAuthenticationEnabled(
  siteName: string,
  authType: AuthType,
  enabled: boolean,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `${enabled ? 'Enabling' : 'Disabling'} ${authType} authentication`);

  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $filter = "/system.webServer/security/authentication/${authType}Authentication"
    Set-WebConfigurationProperty -Filter $filter -Name "enabled" -Value "${enabled}" -PSPath "IIS:\\" -Location '${escapePowerShellString(siteName)}'
    Write-Output "${authType} authentication ${enabled ? 'enabled' : 'disabled'}"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_AUTH_CONFIG_FAILED,
  );
}

async function configureBasicAuthCredentials(
  siteName: string,
  domain: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Setting Basic auth defaultLogonDomain for site: ${siteName}`);

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

async function configureWindowsAuthDomain(
  siteName: string,
  domain: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Setting Windows auth domain settings for site: ${siteName}`);

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

export async function configureAuthentication(
  siteName: string,
  authConfig: IisAuthenticationConfig,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  if (!authConfig.type) {
    logger(deployFolder, 'info', 'No authentication type specified, skipping authentication configuration');
    return;
  }

  const desiredType = authConfig.type.toLowerCase() as AuthType;
  if (!SUPPORTED_AUTH_TYPES.includes(desiredType)) {
    // Leave the site's authentication exactly as it is - an unrecognised type is no reason to
    // strip a site of the authentication it is running with.
    logger(
      deployFolder,
      'warning',
      `Unknown authentication type '${authConfig.type}', leaving the site's authentication unchanged`,
    );
    return;
  }

  const current =
    (await getAuthenticationState(siteName, logger, deployFolder)) ?? conservativeAuthenticationState(desiredType);
  const plan = planAuthenticationChanges(desiredType, authConfig.domain, current);

  if (
    plan.enable.length === 0 &&
    plan.disable.length === 0 &&
    plan.setBasicLogonDomain === null &&
    plan.setWindowsAuthPersistNonNTLM === null
  ) {
    logger(deployFolder, 'info', `Authentication already set to ${desiredType}, leaving it untouched`);
    return;
  }

  logger(
    deployFolder,
    'info',
    `Reconciling authentication for site '${siteName}': ${plan.enable.length} to enable, ${plan.disable.length} to disable`,
  );

  // Providers that should be off go first. Turning the new one on first would, for the moment
  // before the old one is removed, leave the site accepting both - and if the one being removed is
  // anonymous, that means briefly serving a site that is meant to require credentials.
  for (const authType of plan.disable) {
    await setAuthenticationEnabled(siteName, authType, false, logger, deployFolder);
  }

  for (const authType of plan.enable) {
    await setAuthenticationEnabled(siteName, authType, true, logger, deployFolder);
  }

  if (plan.setBasicLogonDomain !== null) {
    await configureBasicAuthCredentials(siteName, plan.setBasicLogonDomain, logger, deployFolder);
  }

  if (plan.setWindowsAuthPersistNonNTLM !== null && authConfig.domain) {
    await configureWindowsAuthDomain(siteName, authConfig.domain, logger, deployFolder);
  }

  logger(deployFolder, 'info', `Authentication configured successfully: ${desiredType}`);
}
