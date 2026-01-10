import fs from 'fs';
import os from 'os';
import path from 'path';
import { Socket } from 'socket.io-client';
import { IisDeploymentMessageDto, IisDeploymentResult, IisDeploymentProgress } from '../../types/iis';
import { LoggerFunc } from '../../utils/logMessage';
import { createDirectoryIfNotExists } from '../../utils/createDirectoryIfNotExists';
import { createDeployHash } from '../../utils/createDeployHash';
import { downloadNugetPackage, unzipPackage } from '../../utils/IISUtils';
import { DEPLOY_FOLDER_NAME, SOCKET_EVENTS } from '../../config/constants';
import { ExecutionResultReturnType } from '../../types/ExecutionResultReturnType';

import { checkIisAvailable } from './powershell.service';
import { ensureAppPool, stopAppPool, startAppPool } from './iis-app-pool.service';
import { ensureSite, stopSite, startSite } from './iis-site.service';
import { configureBindings } from './iis-binding.service';
import { configureAuthentication } from './iis-auth.service';
import { deployConfigFiles } from './iis-config.service';

/**
 * Emits progress events for IIS deployment
 */
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

/**
 * Creates the deployment directory path
 */
function getDeploymentPath(message: IisDeploymentMessageDto): string {
  const homeDir = os.homedir();
  const uniqueHash = createDeployHash();
  const folderLocation = path.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', DEPLOY_FOLDER_NAME);

  return path.join(
    folderLocation,
    message.project.code,
    message.application.code,
    `${message.version.version}-${uniqueHash}`,
  );
}

/**
 * Handles IIS deployment orchestration
 */
export async function handleIisDeployment(
  message: IisDeploymentMessageDto,
  logger: LoggerFunc,
  socket: Socket,
): Promise<ExecutionResultReturnType> {
  const deploymentId = message.deployment.id;
  let deployFolder = '';

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

    // Step 2: Download and extract application package (20%)
    emitProgress(socket, deploymentId, 'downloading', 'Downloading application package...', 10);

    if (message.application.registry.type === 'nuget') {
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
    }

    // Step 3: Stop IIS resources if configured (25%)
    emitProgress(socket, deploymentId, 'stopping-resources', 'Stopping IIS resources...', 25);

    if (message.options.stopAppPoolBeforeDeploy) {
      logger(deployFolder, 'info', 'Stopping app pool before deployment');
      await stopAppPool(message.appPool.name, logger, deployFolder);
      // Add rollback to restart app pool
      rollbackActions.push(async () => {
        logger(deployFolder, 'info', 'Rollback: Starting app pool');
        await startAppPool(message.appPool.name, logger, deployFolder).catch(() => {});
      });
    }

    if (message.options.stopSiteBeforeDeploy) {
      logger(deployFolder, 'info', 'Stopping site before deployment');
      await stopSite(message.site.name, logger, deployFolder);
      // Add rollback to restart site
      rollbackActions.push(async () => {
        logger(deployFolder, 'info', 'Rollback: Starting site');
        await startSite(message.site.name, logger, deployFolder).catch(() => {});
      });
    }

    // Step 4: Configure App Pool (40%)
    emitProgress(socket, deploymentId, 'configuring-app-pool', `Configuring app pool: ${message.appPool.name}...`, 40);
    await ensureAppPool(message.appPool, logger, deployFolder);

    // Step 5: Configure Site (55%)
    emitProgress(socket, deploymentId, 'configuring-site', `Configuring website: ${message.site.name}...`, 55);
    await ensureSite(message.site, deployFolder, message.appPool.name, logger, deployFolder);

    // Step 6: Configure Bindings (65%)
    emitProgress(socket, deploymentId, 'configuring-bindings', 'Configuring site bindings...', 65);
    await configureBindings(
      message.site.name,
      message.site.bindings,
      message.site.preserveSslCertificates,
      logger,
      deployFolder,
    );

    // Step 7: Configure Authentication (75%)
    emitProgress(socket, deploymentId, 'configuring-auth', 'Configuring authentication...', 75);
    await configureAuthentication(message.site.name, message.authentication, logger, deployFolder);

    // Step 8: Deploy Config Files (85%)
    emitProgress(socket, deploymentId, 'deploying-configs', 'Deploying configuration files...', 85);
    await deployConfigFiles(message.configs, deployFolder, logger);

    // Step 9: Start IIS resources if configured (95%)
    if (message.options.startAfterSuccessfulDeployment) {
      emitProgress(socket, deploymentId, 'starting-resources', 'Starting IIS resources...', 95);

      logger(deployFolder, 'info', 'Starting app pool after deployment');
      await startAppPool(message.appPool.name, logger, deployFolder);

      logger(deployFolder, 'info', 'Starting site after deployment');
      await startSite(message.site.name, logger, deployFolder);
    }

    // Step 10: Complete (100%)
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

    // Execute rollback actions in reverse order
    logger(deployFolder || '.', 'info', 'Executing rollback actions...');
    for (const action of rollbackActions.reverse()) {
      try {
        await action();
      } catch (rollbackError) {
        const rollbackErrorMessage = rollbackError instanceof Error ? rollbackError.message : 'Unknown error';
        logger(deployFolder || '.', 'error', `Rollback action failed: ${rollbackErrorMessage}`);
      }
    }

    const result: IisDeploymentResult = {
      success: false,
      error: errorMessage,
    };

    return { succeeded: false, output: JSON.stringify(result) };
  }
}
