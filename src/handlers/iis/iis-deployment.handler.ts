import path from 'path';
import { Socket } from 'socket.io-client';
import { IisDeploymentMessageDto, IisDeploymentResult, IisDeploymentProgress, ExistingBinding } from '../../types/iis';
import { LoggerFunc } from '../../utils/logMessage';
import { createDirectoryIfNotExists } from '../../utils/createDirectoryIfNotExists';
import { createDeployHash } from '../../utils/createDeployHash';
import { downloadNugetPackage, unzipPackage } from '../../utils/IISUtils';
import { DEPLOYMENT_FOLDER_NAME, SOCKET_EVENTS } from '../../config/constants';
import { cleanupOldDeployments } from '../../utils/CleanupOldDeployments';
import { ExecutionResultReturnType } from '../../types/ExecutionResultReturnType';

import { checkIisAvailable } from './powershell.service';
import { ensureAppPool, stopAppPool, startAppPool, deleteAppPool, appPoolExists } from './iis-app-pool.service';
import { ensureSite, stopSite, startSite, deleteSite, siteExists, getSiteConfig, deleteVirtualDirectory, updateSitePhysicalPath, setSiteAppPool, validateSiteExists } from './iis-site.service';
import { configureBindings, getExistingBindings, restoreBindings } from './iis-binding.service';
import { configureAuthentication } from './iis-auth.service';
import { deployConfigFiles } from './iis-config.service';


function emitProgress(
  socket: Socket,
  deploymentId: string,
  step: string,
  message: string,
  progress: number,
): void {
  const progressEvent: IisDeploymentProgress = {
    deploymentId,
    step,
    message,
    progress: Math.min(100, Math.max(0, progress)),
  };
  socket.emit(SOCKET_EVENTS.IIS_DEPLOYMENT_PROGRESS, progressEvent);
}

function getDeploymentPath(message: IisDeploymentMessageDto): string {
  const uniqueHash = createDeployHash();
  const folderLocation = path.join(process.env.DEPLOYMENT_DIRECTORY || DEPLOYMENT_FOLDER_NAME);

  return path.join(
    folderLocation,
    message.project.code,
    message.application.code,
    `${message.version.version}-${uniqueHash}`,
  );
}

export async function handleIisDeployment(
  message: IisDeploymentMessageDto,
  logger: LoggerFunc,
  socket: Socket,
  keepDeployments: number,
): Promise<ExecutionResultReturnType> {
  const deploymentId = message.deployment.id;
  let deployFolder = '';

  // Track deployment state for rollback
  const deploymentState = {
    appPoolCreated: false,
    siteCreated: false,
    originalSiteConfig: null as { physicalPath: string; appPool: string; bindings: ExistingBinding[] } | null,
    virtualDirectoriesCreated: [] as string[],
    stopped: {
      appPool: false,
      site: false,
    },
  };

  // Rollback actions to execute on failure
  const rollbackActions: Array<() => Promise<void>> = [];

  try {
    // Step 1: Validate IIS is available (5%)
    emitProgress(socket, deploymentId, 'validating', 'Validating IIS availability...', 5);
    deployFolder = getDeploymentPath(message);

    // Create base folder for logging
    if (!createDirectoryIfNotExists(deployFolder, logger)) {
      logger(deployFolder || '.', 'error', `Failed to create deployment folder: ${deployFolder}`);
      return { succeeded: false, output: 'Failed to create deployment folder' };
    }

    logger(deployFolder, 'info', `Starting IIS deployment for: ${message.application.name}`);
    logger(deployFolder, 'info', `Deployment folder: ${deployFolder}`);

    const iisAvailable = await checkIisAvailable(logger, deployFolder);
    if (!iisAvailable) {
      logger(deployFolder, 'error', 'IIS is not available on this system');
      return { succeeded: false, output: 'IIS is not available' };
    }
    logger(deployFolder, 'info', 'IIS availability confirmed');

    // Validate site exists before making any changes (only when not allowed to create)
    if (!message.site.createIfNotExists) {
      await validateSiteExists(message.site.name, logger, deployFolder);
    }

    // Step 2: Download and extract application package (20%)
    emitProgress(socket, deploymentId, 'downloading', 'Downloading application package...', 10);

    if (message.application.registry.type !== 'nuget') {
      const errorMessage = `IIS deployments only work with the Nuget registry`;
      logger(deployFolder, 'error', errorMessage);
      return { succeeded: false, output: errorMessage };
    }

    const downloadUrl = `${message.application.registry.url}/package/${message.application.appId}/${message.version.version}`;
    logger(deployFolder, 'info', `Downloading package from: ${downloadUrl}`);

    try {
      await downloadNugetPackage(downloadUrl, deployFolder);
      logger(deployFolder, 'info', 'Package downloaded successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger(deployFolder, 'error', `Failed to download package: ${errorMessage}`);
      return { succeeded: false, output: `Failed to download package: ${errorMessage}` };
    }

    emitProgress(socket, deploymentId, 'extracting', 'Extracting application package...', 15);

    try {
      const zipPath = path.join(deployFolder, 'app.zip');
      await unzipPackage(zipPath, deployFolder);
      logger(deployFolder, 'info', 'Package extracted successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger(deployFolder, 'error', `Failed to extract package: ${errorMessage}`);
      return { succeeded: false, output: `Failed to extract package: ${errorMessage}` };
    }

    // Step 3: Stop IIS resources if configured (25%)
    emitProgress(socket, deploymentId, 'stopping-resources', 'Stopping IIS resources...', 25);

    if (message.options.stopAppPoolBeforeDeploy) {
      logger(deployFolder, 'info', 'Stopping app pool before deployment');
      await stopAppPool(message.appPool.name, logger, deployFolder);
      deploymentState.stopped.appPool = true;
    }

    if (message.options.stopSiteBeforeDeploy) {
      logger(deployFolder, 'info', 'Stopping site before deployment');
      await stopSite(message.site.name, logger, deployFolder);
      deploymentState.stopped.site = true;
    }

    // Step 4: Configure App Pool (40%)
    emitProgress(socket, deploymentId, 'configuring-app-pool', `Configuring app pool: ${message.appPool.name}...`, 40);

    // Track if app pool existed before
    const appPoolExisted = await appPoolExists(message.appPool.name, logger, deployFolder);
    if (!appPoolExisted) {
      deploymentState.appPoolCreated = true;
    }

    await ensureAppPool(message.appPool, logger, deployFolder);

    emitProgress(socket, deploymentId, 'configuring-site', `Configuring website: ${message.site.name}...`, 55);

    const siteExisted = await siteExists(message.site.name, logger, deployFolder);
    if (siteExisted) {
      const [siteConfig, existingBindings] = await Promise.all([
        getSiteConfig(message.site.name, logger, deployFolder),
        getExistingBindings(message.site.name, logger, deployFolder),
      ]);
      if (siteConfig) {
        deploymentState.originalSiteConfig = { ...siteConfig, bindings: existingBindings };
      }
    } else {
      deploymentState.siteCreated = true;
    }

    const createdVdirs = await ensureSite(message.site, deployFolder, message.appPool.name, logger, deployFolder);
    deploymentState.virtualDirectoriesCreated = createdVdirs;

    emitProgress(socket, deploymentId, 'configuring-bindings', 'Configuring site bindings...', 65);
    await configureBindings(
      message.site.name,
      message.site.bindings,
      message.site.preserveSslCertificates,
      logger,
      deployFolder,
    );

    emitProgress(socket, deploymentId, 'configuring-auth', 'Configuring authentication...', 75);
    await configureAuthentication(message.site.name, message.authentication, logger, deployFolder);

    emitProgress(socket, deploymentId, 'deploying-configs', 'Deploying configuration files...', 85);
    await deployConfigFiles(message.configs, deployFolder, logger);

    if (message.options.startAfterSuccessfulDeployment) {
      emitProgress(socket, deploymentId, 'starting-resources', 'Starting IIS resources...', 95);

      logger(deployFolder, 'info', 'Starting app pool after deployment');
      await startAppPool(message.appPool.name, logger, deployFolder);

      logger(deployFolder, 'info', 'Starting site after deployment');
      await startSite(message.site.name, logger, deployFolder);
    }

    // Clean up old deployment folders
    await cleanupOldDeployments(deployFolder, path.dirname(deployFolder), keepDeployments, logger);

    emitProgress(socket, deploymentId, 'complete', 'IIS deployment completed successfully', 100);
    logger(deployFolder, 'info', 'IIS deployment completed successfully');

    const result: IisDeploymentResult = {
      success: true,
      physicalPath: deployFolder,
    };

    return { succeeded: true, output: JSON.stringify(result) };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger(deployFolder || '.', 'error', `IIS deployment failed: ${errorMessage}`);

    logger(deployFolder || '.', 'info', 'Executing rollback actions...');

    for (const action of rollbackActions.reverse()) {
      try {
        await action();
      } catch (rollbackError) {
        const rollbackErrorMessage = rollbackError instanceof Error ? rollbackError.message : 'Unknown error';
        logger(deployFolder || '.', 'error', `Rollback action failed: ${rollbackErrorMessage}`);
      }
    }

    // Delete created virtual directories
    if (deploymentState.virtualDirectoriesCreated.length > 0) {
      logger(deployFolder || '.', 'info', `Rollback: Deleting ${deploymentState.virtualDirectoriesCreated.length} created virtual directories`);
      for (const vdirName of deploymentState.virtualDirectoriesCreated) {
        try {
          await deleteVirtualDirectory(message.site.name, vdirName, logger, deployFolder || '.');
        } catch (rollbackError) {
          logger(deployFolder || '.', 'error', `Failed to delete virtual directory '${vdirName}': ${rollbackError}`);
        }
      }
    }

    // Rollback site changes
    if (deploymentState.siteCreated) {
      // Site was created by this deployment - delete it
      logger(deployFolder || '.', 'info', `Rollback: Deleting created site '${message.site.name}'`);
      try {
        await deleteSite(message.site.name, logger, deployFolder || '.');
      } catch (rollbackError) {
        logger(deployFolder || '.', 'error', `Failed to delete site: ${rollbackError}`);
      }
    } else if (deploymentState.originalSiteConfig) {
      // Site existed - restore original configuration
      logger(deployFolder || '.', 'info', `Rollback: Restoring original site configuration`);
      try {
        await updateSitePhysicalPath(message.site.name, deploymentState.originalSiteConfig.physicalPath, logger, deployFolder || '.');
        await setSiteAppPool(message.site.name, deploymentState.originalSiteConfig.appPool, logger, deployFolder || '.');
        await restoreBindings(message.site.name, deploymentState.originalSiteConfig.bindings, logger, deployFolder || '.');
      } catch (rollbackError) {
        logger(deployFolder || '.', 'error', `Failed to restore site configuration: ${rollbackError}`);
      }
    }

    // Rollback app pool changes
    if (deploymentState.appPoolCreated) {
      // App pool was created by this deployment - delete it
      logger(deployFolder || '.', 'info', `Rollback: Deleting created app pool '${message.appPool.name}'`);
      try {
        await deleteAppPool(message.appPool.name, logger, deployFolder || '.');
      } catch (rollbackError) {
        logger(deployFolder || '.', 'error', `Failed to delete app pool: ${rollbackError}`);
      }
    }

    // Start stopped resources (only if they still exist and weren't deleted)
    if (deploymentState.stopped.site && !deploymentState.siteCreated) {
      logger(deployFolder || '.', 'info', 'Rollback: Starting site');
      try {
        await startSite(message.site.name, logger, deployFolder || '.');
      } catch (rollbackError) {
        logger(deployFolder || '.', 'error', `Failed to start site: ${rollbackError}`);
      }
    }

    if (deploymentState.stopped.appPool && !deploymentState.appPoolCreated) {
      logger(deployFolder || '.', 'info', 'Rollback: Starting app pool');
      try {
        await startAppPool(message.appPool.name, logger, deployFolder || '.');
      } catch (rollbackError) {
        logger(deployFolder || '.', 'error', `Failed to start app pool: ${rollbackError}`);
      }
    }

    const result: IisDeploymentResult = {
      success: false,
      error: errorMessage,
    };

    return { succeeded: false, output: JSON.stringify(result) };
  }
}
