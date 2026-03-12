import fs from 'fs';
import path from 'path';
import { LoggerFunc } from '../../utils/logMessage';
import { ExecutionResultReturnType } from '../../types/ExecutionResultReturnType';
import { DEFAULT_DEPLOY_TIMEOUT_SECONDS } from '../../config/constants';
import { execSync, spawn } from 'child_process';
import { ScriptDeploymentMessageDto } from '../../types/step-types/script';
import { createDeployHash } from '../../utils/createDeployHash';
import { createDirectoryIfNotExists } from '../../utils/createDirectoryIfNotExists';
import { downloadNugetPackage, unzipPackage } from '../../utils/IISUtils';
import { cleanupOldDeployments } from '../../utils/CleanupOldDeployments';
import { DeploymentHandler } from '../../types/HandlerContext';


async function runDeployScript(
  deployScript: string,
  folderLocation: string,
  logger: LoggerFunc,
): Promise<ExecutionResultReturnType> {
  const timeout = Number(process.env.DEPLOY_TIMEOUT_IN_SECONDS || DEFAULT_DEPLOY_TIMEOUT_SECONDS) * 1000;

  logger(folderLocation, 'info', `Starting deploy script execution`);

  return new Promise((resolve) => {
    const childProcess = spawn(deployScript, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: folderLocation,
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
        folderLocation,
        'error',
        `Deploy script execution timed out after ${timeout / 1000} seconds. If this timeout is too short, you can increase it in the env variables`,
      );
      resolve({ succeeded: false });
    }, timeout);

    // Stream stdout in real-time
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdoutData += output;
      logger(folderLocation, 'info', output);
    });

    // Stream stderr in real-time
    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderrData += output;
      logger(folderLocation, 'error', output);
    });

    // Handle process completion
    childProcess.on('close', (code) => {
      clearTimeout(timeoutId);

      if (hasTimedOut) {
        return; // Already handled by timeout
      }

      if (code === 0) {
        logger(folderLocation, 'info', `Deploy script completed successfully with exit code ${code}`);
        resolve({ succeeded: true });
      } else {
        logger(folderLocation, 'error', `Deploy script exited with code ${code}`);
        resolve({ succeeded: false });
      }
    });

    // Handle process errors
    childProcess.on('error', (error) => {
      clearTimeout(timeoutId);
      logger(folderLocation, 'error', `Deploy script execution error: ${error.message}`);
      resolve({ succeeded: false });
    });
  });
}

export const handleScriptDeployment: DeploymentHandler<ScriptDeploymentMessageDto> = async (
  stepMessage,
  { deploymentMessage, operatingSystem, keepDeployments, logger, deploymentFolder },
): Promise<ExecutionResultReturnType> => {
  const { script } = stepMessage;
  if (!script) return { succeeded: false };

  const stepFolder = path.join(deploymentFolder, createDeployHash());
  if (!createDirectoryIfNotExists(stepFolder, logger))
    return { output: `Error creating folder: ${stepFolder}`, succeeded: false };

  let deployScriptOutput: ExecutionResultReturnType = { output: 'Script did not execute', succeeded: false };

  if (operatingSystem === 'windows') {
    const scriptPath = path.join(stepFolder, 'deploy-script.ps1');
    fs.writeFileSync(scriptPath, script);

    if (deploymentMessage.application.registry.type === 'nuget') {
      const downloadUrl = `${deploymentMessage.application.registry.url}/package/${deploymentMessage.application.appId}/${deploymentMessage.version.version}`;
      try {
        await downloadNugetPackage(downloadUrl, stepFolder);
      } catch (e) {
        console.error(e);
        logger(stepFolder, 'error', 'Failed to download the Nuget packages from: ' + downloadUrl);
        return { succeeded: false };
      }

      try {
        const zipPath = path.join(stepFolder, 'app.zip');
        await unzipPackage(zipPath, stepFolder);
      } catch (e) {
        console.error(e);
        logger(stepFolder, 'error', 'Failed to extract files from .zip');
        return { succeeded: false };
      }
    }

    logger(stepFolder, 'info', `Deploy script written to ${scriptPath}`);
    deployScriptOutput = await runDeployScript(`powershell.exe -File "${scriptPath}"`, stepFolder, logger);
  } else {
    const scriptPath = path.join(stepFolder, 'deploy-script.sh');
    fs.writeFileSync(scriptPath, script);
    execSync(`chmod +x "${scriptPath}"`);
    logger(stepFolder, 'info', `Deploy script written to ${scriptPath}`);

    deployScriptOutput = await runDeployScript(`sh "${scriptPath}"`, stepFolder, logger);
    await cleanupOldDeployments(stepFolder, deploymentFolder, keepDeployments, logger);
  }

  return { succeeded: deployScriptOutput.succeeded };
};
