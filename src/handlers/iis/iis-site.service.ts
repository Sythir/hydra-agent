import { IisSiteConfig, IisVirtualDirectory } from '../../types/iis';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentErrorCodes } from '../../types/DeploymentError';
import { executePowerShellOrThrow, escapePowerShellString } from './powershell.service';

/**
 * Checks if a website exists
 */
export async function siteExists(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<boolean> {
  const result = await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    if (Test-Path "IIS:\\Sites\\${escapePowerShellString(siteName)}") {
      Write-Output "EXISTS"
    } else {
      Write-Output "NOT_EXISTS"
    }
    `,
    logger,
    deployFolder,
  );
  return result.includes('EXISTS') && !result.includes('NOT_EXISTS');
}

/**
 * Creates a new website with minimal configuration
 */
export async function createSite(
  siteName: string,
  physicalPath: string,
  appPoolName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Creating website: ${siteName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    New-Website -Name '${escapePowerShellString(siteName)}' -PhysicalPath '${escapePowerShellString(physicalPath)}' -ApplicationPool '${escapePowerShellString(appPoolName)}' -Force
    Write-Output "Website created successfully"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_SITE_CREATION_FAILED,
  );
}

/**
 * Updates the physical path of a website
 */
export async function updateSitePhysicalPath(
  siteName: string,
  physicalPath: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Updating physical path for site '${siteName}' to: ${physicalPath}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    Set-ItemProperty "IIS:\\Sites\\${escapePowerShellString(siteName)}" -Name "physicalPath" -Value '${escapePowerShellString(physicalPath)}'
    Write-Output "Physical path updated successfully"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_SITE_CONFIG_FAILED,
  );
}

/**
 * Sets the application pool for a website
 */
export async function setSiteAppPool(
  siteName: string,
  appPoolName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Setting application pool for site '${siteName}' to: ${appPoolName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    Set-ItemProperty "IIS:\\Sites\\${escapePowerShellString(siteName)}" -Name "applicationPool" -Value '${escapePowerShellString(appPoolName)}'
    Write-Output "Application pool updated successfully"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_SITE_CONFIG_FAILED,
  );
}

/**
 * Stops a website
 */
export async function stopSite(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Stopping website: ${siteName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $site = Get-Item "IIS:\\Sites\\${escapePowerShellString(siteName)}" -ErrorAction SilentlyContinue
    if ($site -and $site.State -eq 'Started') {
      Stop-Website -Name '${escapePowerShellString(siteName)}'
      Write-Output "Website stopped"
    } else {
      Write-Output "Website already stopped or does not exist"
    }
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_STOP_FAILED,
  );
}

/**
 * Starts a website
 */
export async function startSite(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Starting website: ${siteName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $site = Get-Item "IIS:\\Sites\\${escapePowerShellString(siteName)}" -ErrorAction SilentlyContinue
    if ($site -and $site.State -ne 'Started') {
      Start-Website -Name '${escapePowerShellString(siteName)}'
      Write-Output "Website started"
    } else {
      Write-Output "Website already started or does not exist"
    }
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_START_FAILED,
  );
}

/**
 * Configures virtual directories for a website
 */
export async function configureVirtualDirectories(
  siteName: string,
  virtualDirectories: IisVirtualDirectory[],
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  if (virtualDirectories.length === 0) {
    logger(deployFolder, 'info', 'No virtual directories to configure');
    return;
  }

  logger(deployFolder, 'info', `Configuring ${virtualDirectories.length} virtual directory(ies)`);

  for (const vdir of virtualDirectories) {
    // Virtual directory path should start with / and we need to remove it for the name
    const vdirName = vdir.path.startsWith('/') ? vdir.path.substring(1) : vdir.path;

    await executePowerShellOrThrow(
      `
      Import-Module WebAdministration
      $siteName = '${escapePowerShellString(siteName)}'
      $vdirName = '${escapePowerShellString(vdirName)}'
      $vdirPath = '${escapePowerShellString(vdir.physicalPath)}'
      $fullPath = "IIS:\\Sites\\$siteName\\$vdirName"

      # Check if virtual directory exists
      if (Test-Path $fullPath) {
        # Update physical path
        Set-ItemProperty $fullPath -Name "physicalPath" -Value $vdirPath
        Write-Output "Virtual directory '$vdirName' updated"
      } else {
        # Create new virtual directory
        New-WebVirtualDirectory -Site $siteName -Name $vdirName -PhysicalPath $vdirPath
        Write-Output "Virtual directory '$vdirName' created"
      }
      `,
      logger,
      deployFolder,
      DeploymentErrorCodes.IIS_VIRTUAL_DIR_FAILED,
    );

    logger(deployFolder, 'info', `Virtual directory '${vdir.path}' -> '${vdir.physicalPath}' configured`);
  }
}

/**
 * Ensures a website exists (creates if needed) and configures it
 */
export async function ensureSite(
  config: IisSiteConfig,
  physicalPath: string,
  appPoolName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  const exists = await siteExists(config.name, logger, deployFolder);

  if (!exists) {
    if (config.createIfNotExists) {
      await createSite(config.name, physicalPath, appPoolName, logger, deployFolder);
    } else {
      throw new Error(`Website '${config.name}' does not exist and createIfNotExists is false`);
    }
  } else {
    // Update physical path and app pool for existing site
    await updateSitePhysicalPath(config.name, physicalPath, logger, deployFolder);
    await setSiteAppPool(config.name, appPoolName, logger, deployFolder);
  }

  // Configure virtual directories
  await configureVirtualDirectories(config.name, config.virtualDirectories, logger, deployFolder);

  logger(deployFolder, 'info', `Website '${config.name}' configured successfully`);
}
