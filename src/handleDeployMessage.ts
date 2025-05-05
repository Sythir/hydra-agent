import fs from 'fs';
import { Data } from './types/data';
import { createDeployHash } from './utils/createDeployHash';
import os from 'os';
import path from 'path';
import { LoggerFunc } from './utils/logMessage';
import { exec, execSync, spawn } from 'child_process';
import { createDirectoryIfNotExists } from './utils/createDirectoryIfNotExists';
import util from 'util';
import { ensureDirectoryExists } from './utils/ensureDirectoryExists';
import { cleanupOldDeployments } from './utils/CleanupOldDeployments';
import { ExecutionResultReturnType } from './types/ExecutionResultReturnType';

const execAsync = util.promisify(exec);

async function runDeployScript(deployScript: string, deployFolderName: string, logger: LoggerFunc): Promise<ExecutionResultReturnType> {
  const timeout = Number(process.env.DEPLOY_TIMEOUT_IN_SECONDS || 60) * 1000;

  logger(deployFolderName, 'info', `Starting deploy script execution`);

  return new Promise((resolve) => {
    // Split the command and arguments
    const [command, ...args] = deployScript.split(' ');

    // Spawn the process
    const childProcess = spawn(command, args, { 
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutData = '';
    let stderrData = '';
    let hasTimedOut = false;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      hasTimedOut = true;
      childProcess.kill('SIGTERM');
      logger(
        deployFolderName,
        'error',
        `Deploy script execution timed out after ${timeout / 1000} seconds. If this timeout is too short, you can increase it in the env variables`
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

export const handleDeployMessage = async (
  data: Data,
  operatingSystem: 'windows' | 'linux',
  keepDeployments: number,
  logger: LoggerFunc
): Promise<ExecutionResultReturnType> => {
  const { script } = data;
  if (!script) return { succeeded: false };

  const homeDir = os.homedir();
  const folderLocation = path.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', 'HydraDeploys');
  if (!createDirectoryIfNotExists(folderLocation, logger))
    return { output: `Error creating folder: ${folderLocation}`, succeeded: false };

  const uniqueHash = createDeployHash();
  ensureDirectoryExists(
    `${folderLocation}/${data.project.code}/${data.application.code}/${data.environment.name}/${data.version.version}-${uniqueHash}`,
  );
  const deployFolderName = `${folderLocation}/${data.project.code}/${data.application.code}/${data.environment.name}/${data.version.version}-${uniqueHash}`;

  if (!createDirectoryIfNotExists(deployFolderName, logger))
    return { output: `Error creating folder: ${deployFolderName}`, succeeded: false };
  let deployScriptOutput: ExecutionResultReturnType = { output: 'Script did not execute', succeeded: false };
  if (operatingSystem === 'windows') {
    const scriptPath = `${deployFolderName}/deploy-script.ps1`;
    fs.writeFileSync(scriptPath, script);
    logger(deployFolderName, 'info', `Deploy script written to ${scriptPath}`);

    deployScriptOutput = await runDeployScript(`sh ${deployFolderName}/deploy-script.sh`, deployFolderName, logger);
  } else {
    fs.writeFileSync(`${deployFolderName}/deploy-script.sh`, script);
    execSync(`chmod +x ${deployFolderName}/deploy-script.sh`);
    logger(deployFolderName, 'info', `Deploy script written to ${deployFolderName}/deploy-script.sh`);

    deployScriptOutput = await runDeployScript(`sh ${deployFolderName}/deploy-script.sh`, deployFolderName, logger);
    await cleanupOldDeployments(
      deployFolderName,
      data.project.code,
      data.application.code,
      data.environment.name,
      keepDeployments,
      logger
    );
  }
  return { succeeded: deployScriptOutput.succeeded };
};
