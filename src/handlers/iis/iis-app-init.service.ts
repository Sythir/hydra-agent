import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentErrorCodes } from '../../types/DeploymentError';
import { executePowerShell, executePowerShellOrThrow, escapePowerShellString } from './powershell.service';

export const DEFAULT_INITIALIZATION_PAGE = '/';

/**
 * Application Initialization ships as a separate IIS role feature (Web-AppInit), so it cannot be
 * assumed. Writing its configuration on a host that lacks the module leaves an unrecognised section
 * behind, which the site then fails to start on - so detection has to come first.
 */
export async function isApplicationInitializationAvailable(
  logger: LoggerFunc,
  deployFolder: string,
): Promise<boolean> {
  const result = await executePowerShell(
    `
    Import-Module WebAdministration
    $module = Get-WebConfiguration -PSPath "IIS:\\" -Filter "/system.webServer/globalModules/add[@name='ApplicationInitializationModule']" -ErrorAction SilentlyContinue
    if ($module) { Write-Output "APPINIT_AVAILABLE" } else { Write-Output "APPINIT_MISSING" }
    `,
    logger,
    deployFolder,
  );

  return result.success && result.stdout.includes('APPINIT_AVAILABLE');
}

/**
 * Makes IIS warm the new worker before it is given traffic.
 *
 * Without this the physical path swap hands the cold release straight to whoever arrives first, and
 * that request pays the application's entire startup cost. With `preloadEnabled` and `doAppStart`,
 * IIS issues the initialization request to the replacement worker itself while the old worker is
 * still answering, and only cuts over once it completes.
 *
 * The configuration is written to applicationHost.config rather than the release's web.config, so
 * it survives every deployment instead of being replaced along with the release folder.
 *
 * Returns false when the feature is unavailable - a missing role feature is not worth failing a
 * deployment over, it just means the cold start stays visible.
 */
export async function configureApplicationInitialization(
  siteName: string,
  initializationPage: string,
  startMode: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<boolean> {
  const available = await isApplicationInitializationAvailable(logger, deployFolder);
  if (!available) {
    logger(
      deployFolder,
      'warning',
      `Application Initialization is not installed on this host, so the new release cannot be warmed ` +
        `before it receives traffic. Install the IIS 'Application Initialization' role feature ` +
        `(Install-WindowsFeature Web-AppInit) to remove the cold start after a deployment.`,
    );
    return false;
  }

  const page = initializationPage || DEFAULT_INITIALIZATION_PAGE;
  const site = escapePowerShellString(siteName);
  const escapedPage = escapePowerShellString(page);

  logger(deployFolder, 'info', `Enabling preload for site '${siteName}' (initialization page: ${page})`);

  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration

    Set-WebConfigurationProperty -PSPath "IIS:\\" -Filter "/system.applicationHost/sites/site[@name='${site}']/application[@path='/']" -Name "preloadEnabled" -Value $true

    Set-WebConfigurationProperty -PSPath "IIS:\\" -Location '${site}' -Filter "/system.webServer/applicationInitialization" -Name "doAppStart" -Value $true

    $existing = Get-WebConfiguration -PSPath "IIS:\\" -Location '${site}' -Filter "/system.webServer/applicationInitialization/add[@initializationPage='${escapedPage}']" -ErrorAction SilentlyContinue
    if (-not $existing) {
      Add-WebConfigurationProperty -PSPath "IIS:\\" -Location '${site}' -Filter "/system.webServer/applicationInitialization" -Name "." -Value @{ initializationPage = '${escapedPage}' }
      Write-Output "INITIALIZATION_PAGE_ADDED"
    } else {
      Write-Output "INITIALIZATION_PAGE_PRESENT"
    }
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_SITE_CONFIG_FAILED,
  );

  if (startMode !== 'AlwaysRunning') {
    logger(
      deployFolder,
      'warning',
      `Preload is configured but the app pool start mode is '${startMode}'. IIS only starts a worker ` +
        `on demand in that mode, so the release will not be warmed until the first request arrives. ` +
        `Set the app pool start mode to AlwaysRunning to get the benefit.`,
    );
  }

  // The initialization request is issued internally over http with no TLS, so a rewrite rule that
  // redirects http to https answers it with a redirect and the application is never touched.
  logger(
    deployFolder,
    'info',
    `If '${page}' redirects (for example an http-to-https rewrite rule), the initialization request ` +
      `is answered by the redirect and the application is not warmed - point the initialization page ` +
      `at a route that responds directly, or exclude the preload request from the rewrite rule.`,
  );

  return true;
}
