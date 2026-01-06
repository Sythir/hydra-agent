import fs from 'fs';
import { Data } from './types/data';
import { createDeployHash } from './utils/createDeployHash';
import os from 'os';
import path from 'path';
import { LoggerFunc } from './utils/logMessage';
import { execSync, spawn } from 'child_process';
import { createDirectoryIfNotExists } from './utils/createDirectoryIfNotExists';
import { cleanupOldDeployments } from './utils/CleanupOldDeployments';
import { ExecutionResultReturnType } from './types/ExecutionResultReturnType';
import { downloadNugetPackage, unzipPackage } from './utils/IISUtils';
import { DEFAULT_DEPLOY_TIMEOUT_SECONDS, DEPLOY_FOLDER_NAME } from './config/constants';

async function runDeployScript(
  deployScript: string,
  deployFolderName: string,
  logger: LoggerFunc,
): Promise<ExecutionResultReturnType> {
  const timeout = Number(process.env.DEPLOY_TIMEOUT_IN_SECONDS || DEFAULT_DEPLOY_TIMEOUT_SECONDS) * 1000;

  logger(deployFolderName, 'info', `Starting deploy script execution`);

  return new Promise((resolve) => {
    const childProcess = spawn(deployScript, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: deployFolderName,
      detached: process.platform !== 'win32',
    });

    let stdoutData = '';
    let stderrData = '';
    let hasTimedOut = false;

    const timeoutId = setTimeout(() => {
      hasTimedOut = true;

      // Platform-specific implementation needed because:
      // - spawn with shell: true creates a shell process that spawns the actual script
      // - Killing the shell alone doesn't kill its child processes
      // - Unix: Use negative PID to kill entire process group
      // - Windows: Use taskkill /T to kill process tree
      if (childProcess.pid) {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /T /PID ${childProcess.pid}`, { stdio: 'ignore' });
        } else {
          try {
            process.kill(-childProcess.pid, 'SIGKILL');
          } catch {
            childProcess.kill('SIGKILL');
          }
        }
      }

      logger(
        deployFolderName,
        'error',
        `Deploy script execution timed out after ${timeout / 1000} seconds. If this timeout is too short, you can increase it in the env variables`,
      );
      resolve({ succeeded: false });
    }, timeout);

    // Stream stdout in real-time
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdoutData += output;
      logger(deployFolderName, 'info', output);
    });

    // Stream stderr in real-time
    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderrData += output;
      logger(deployFolderName, 'error', output);
    });

    // Handle process completion
    childProcess.on('close', (code) => {
      clearTimeout(timeoutId);

      if (hasTimedOut) {
        return; // Already handled by timeout
      }

      if (code === 0) {
        logger(deployFolderName, 'info', `Deploy script completed successfully with exit code ${code}`);
        resolve({ succeeded: true });
      } else {
        logger(deployFolderName, 'error', `Deploy script exited with code ${code}`);
        resolve({ succeeded: false });
      }
    });

    // Handle process errors
    childProcess.on('error', (error) => {
      clearTimeout(timeoutId);
      logger(deployFolderName, 'error', `Deploy script execution error: ${error.message}`);
      resolve({ succeeded: false });
    });
  });
}

export const handleDeployment = async (
  data: Data,
  operatingSystem: 'windows' | 'linux',
  keepDeployments: number,
  logger: LoggerFunc,
): Promise<ExecutionResultReturnType> => {
  const { script } = data;
  if (!script) return { succeeded: false };

  const homeDir = os.homedir();
  const folderLocation = path.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', DEPLOY_FOLDER_NAME);
  if (!createDirectoryIfNotExists(folderLocation, logger))
    return { output: `Error creating folder: ${folderLocation}`, succeeded: false };

  const uniqueHash = createDeployHash();
  const deployFolderName = path.join(
    folderLocation,
    data.project.code,
    data.application.code,
    data.environment.name,
    `${data.version.version}-${uniqueHash}`,
  );

  if (!createDirectoryIfNotExists(deployFolderName, logger))
    return { output: `Error creating folder: ${deployFolderName}`, succeeded: false };
  let deployScriptOutput: ExecutionResultReturnType = { output: 'Script did not execute', succeeded: false };

  if (operatingSystem === 'windows') {
    const scriptPath = path.join(deployFolderName, 'deploy-script.ps1');
    console.log(`powershell.exe -File ${scriptPath}`);
    fs.writeFileSync(scriptPath, script);

    console.log(data.config);

    if (data.application.registry.type === 'nuget') {
      const downloadUrl = `${data.application.registry.url}/package/${data.application.appId}/${data.version.version}`;
      try {
        await downloadNugetPackage(downloadUrl, deployFolderName);
      } catch (e) {
        console.error(e);
        logger(deployFolderName, 'error', 'Failed to download the Nuget packages from: ' + downloadUrl);
        return { succeeded: false };
      }

      try {
        const zipPath = path.join(deployFolderName, 'app.zip');
        await unzipPackage(zipPath, deployFolderName);
      } catch (e) {
        console.error(e);
        logger(deployFolderName, 'error', 'Failed to extract files from .zip');
        return { succeeded: false };
      }
    }

    logger(deployFolderName, 'info', `Deploy script written to ${scriptPath}`);
    deployScriptOutput = await runDeployScript(`powershell.exe -File "${scriptPath}"`, deployFolderName, logger);
  } else {
    const scriptPath = path.join(deployFolderName, 'deploy-script.sh');
    fs.writeFileSync(scriptPath, script);
    execSync(`chmod +x "${scriptPath}"`);
    logger(deployFolderName, 'info', `Deploy script written to ${scriptPath}`);

    deployScriptOutput = await runDeployScript(`sh "${scriptPath}"`, deployFolderName, logger);
    await cleanupOldDeployments(
      deployFolderName,
      data.project.code,
      data.application.code,
      data.environment.name,
      keepDeployments,
      logger,
    );
  }
  return { succeeded: deployScriptOutput.succeeded };
};
