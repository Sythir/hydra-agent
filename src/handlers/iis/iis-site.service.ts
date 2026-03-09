import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentErrorCodes } from '../../types/DeploymentError';
import { executePowerShellOrThrow, escapePowerShellString } from './powershell.service';
import { IisSiteConfig, IisVirtualDirectory } from '../../types/step-types/iis';

/**
 * Validates that a website exists using Get-Website, throwing a descriptive error if it does not.
 * Use this for early-exit checks before any modifications are made.
 */
export async function validateSiteExists(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  const result = await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $site = Get-Website -Name '${escapePowerShellString(siteName)}'
    if ($site) {
      Write-Output "EXISTS"
    } else {
      Write-Output "NOT_EXISTS"
    }
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_SITE_CONFIG_FAILED,
  );

  if (!result.includes('EXISTS') || result.includes('NOT_EXISTS')) {
    throw new Error(`IIS site '${siteName}' does not exist and createIfNotExists is false`);
  }
}

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
 * Gets the current physical path and app pool of a site
 */
export async function getSiteConfig(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<{ physicalPath: string; appPool: string } | null> {
  try {
    const result = await executePowerShellOrThrow(
      `
      Import-Module WebAdministration
      $site = Get-Item "IIS:\\Sites\\${escapePowerShellString(siteName)}" -ErrorAction Stop
      $config = @{
        physicalPath = $site.physicalPath
        appPool = $site.applicationPool
      }
      $config | ConvertTo-Json -Compress
      `,
      logger,
      deployFolder,
    );
    return JSON.parse(result);
  } catch {
    return null;
  }
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
 * Deletes a website
 */
export async function deleteSite(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Deleting website: ${siteName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $site = Get-Item "IIS:\\Sites\\${escapePowerShellString(siteName)}" -ErrorAction SilentlyContinue
    if ($site) {
      Remove-Website -Name '${escapePowerShellString(siteName)}'
      Write-Output "Website deleted"
    } else {
      Write-Output "Website does not exist"
    }
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_SITE_CONFIG_FAILED,
  );
}

/**
 * Deletes a virtual directory
 */
export async function deleteVirtualDirectory(
  siteName: string,
  vdirName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Deleting virtual directory: ${vdirName} from site: ${siteName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $existing = Get-WebVirtualDirectory -Site '${escapePowerShellString(siteName)}' -Name '${escapePowerShellString(vdirName)}'
    if ($existing) {
      Remove-WebVirtualDirectory -Site '${escapePowerShellString(siteName)}' -Name '${escapePowerShellString(vdirName)}'
      Write-Output "Virtual directory deleted"
    } else {
      Write-Output "Virtual directory does not exist"
    }
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_VIRTUAL_DIR_FAILED,
  );
}

/**
 * Configures virtual directories for a website
 * @returns Array of virtual directory names that were created (not updated)
 */
export async function configureVirtualDirectories(
  siteName: string,
  virtualDirectories: IisVirtualDirectory[],
  logger: LoggerFunc,
  deployFolder: string,
): Promise<string[]> {
  if (virtualDirectories.length === 0) {
    logger(deployFolder, 'info', 'No virtual directories to configure');
    return [];
  }

  logger(deployFolder, 'info', `Configuring ${virtualDirectories.length} virtual directory(ies)`);
  const createdVdirs: string[] = [];

  for (const vdir of virtualDirectories) {
    // Virtual directory path should start with / and we need to remove it for the name
    const vdirName = vdir.path.startsWith('/') ? vdir.path.substring(1) : vdir.path;

    // Ensure the physical path exists before creating the virtual directory
    const result = await executePowerShellOrThrow(
      `
      if (-not (Test-Path '${escapePowerShellString(vdir.physicalPath)}')) {
        New-Item -Path '${escapePowerShellString(vdir.physicalPath)}' -ItemType Directory -Force | Out-Null
        Write-Output "DIRECTORY_CREATED"
      }
      `,
      logger,
      deployFolder,
      DeploymentErrorCodes.IIS_VIRTUAL_DIR_FAILED,
    );

    if (result.includes('DIRECTORY_CREATED')) {
      logger(deployFolder, 'info', `Created missing physical path: ${vdir.physicalPath}`);
    }

    const vdirResult = await executePowerShellOrThrow(
      `
      Import-Module WebAdministration
      $siteName = '${escapePowerShellString(siteName)}'
      $vdirName = '${escapePowerShellString(vdirName)}'
      $vdirPath = '${escapePowerShellString(vdir.physicalPath)}'

      # Check if virtual directory exists using Get-WebVirtualDirectory (avoids IIS PSDrive path resolution issues)
      $existing = Get-WebVirtualDirectory -Site $siteName -Name $vdirName
      if ($existing) {
        # Update physical path
        Set-WebConfigurationProperty -Filter "/system.applicationHost/sites/site[@name='$siteName']/application[@path='/']/virtualDirectory[@path='/$vdirName']" -Name "physicalPath" -Value $vdirPath -PSPath "IIS:\\"
        Write-Output "UPDATED"
      } else {
        # Create new virtual directory
        New-WebVirtualDirectory -Site $siteName -Name $vdirName -PhysicalPath $vdirPath
        Write-Output "CREATED"
      }
      `,
      logger,
      deployFolder,
      DeploymentErrorCodes.IIS_VIRTUAL_DIR_FAILED,
    );

    if (vdirResult.includes('CREATED')) {
      createdVdirs.push(vdirName);
    }

    logger(deployFolder, 'info', `Virtual directory '${vdir.path}' -> '${vdir.physicalPath}' configured`);
  }

  return createdVdirs;
}

/**
 * Ensures a website exists (creates if needed) and configures it
 * @returns Array of virtual directory names that were created (not updated)
 */
export async function ensureSite(
  config: IisSiteConfig,
  physicalPath: string,
  appPoolName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<string[]> {
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

  // Configure virtual directories and track which were created
  const createdVdirs = await configureVirtualDirectories(config.name, config.virtualDirectories, logger, deployFolder);

  logger(deployFolder, 'info', `Website '${config.name}' configured successfully`);

  return createdVdirs;
}
