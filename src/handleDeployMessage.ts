import fs from 'fs';
import { Data } from './types/data';
import { createDeployHash } from './utils/createDeployHash';
import os from 'os';
import path from 'path';
import { logMessage } from './utils/logMessage';
import { exec, execSync } from 'child_process';
import { createDirectoryIfNotExists } from './utils/createDirectoryIfNotExists';
import util from 'util';
import { ensureDirectoryExists } from './utils/ensureDirectoryExists';
import { cleanupOldDeployments } from './utils/CleanupOldDeployments';
import { ExecutionResultReturnType } from './types/ExecutionResultReturnType';

const execAsync = util.promisify(exec);

async function runDeployScript(deployScript: string, deployFolderName: string): Promise<ExecutionResultReturnType> {
  let output = '';
  const timeout = Number(process.env.DEPLOY_TIMEOUT_IN_SECONDS || 60) * 1000;

  output += logMessage(deployFolderName, 'info', `Starting deploy script execution`);
  const scriptExecution = execAsync(deployScript, { encoding: 'utf8' });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Deploy script execution timed out after ${timeout / 1000} seconds`));
    }, timeout);
  });

  try {
    const result = (await Promise.race([scriptExecution, timeoutPromise])) as Awaited<ReturnType<typeof execAsync>>;

    output += logMessage(deployFolderName, 'info', 'Output deploy script: ' + result.stdout.toString());

    output += logMessage(deployFolderName, 'info', `Deploy script completed successfully`);
    return { succeeded: true, output: output };
  } catch (error: any) {
    if (scriptExecution.child) {
      scriptExecution.child.kill('SIGTERM'); // Terminate the script if still running
    }

    if (error.code !== 0) {
      output += logMessage(deployFolderName, 'info', 'Output deploy script: ' + error.stdout.toString());
      output += logMessage(deployFolderName, 'error', `Deploy script exited with code ${error.code}: ${error.stderr.toString()}`);
      return { succeeded: false, output: output };
    }

    output += logMessage(
      deployFolderName,
      'error',
      `Deploy execution failed: ${error.message} if this timeout is too short, you can increase it in the env variables`,
    );
    return { succeeded: false, output: output };
  }
}

export const handleDeployMessage = async (
  data: Data,
  operatingSystem: 'windows' | 'linux',
  keepDeployments: number,
): Promise<ExecutionResultReturnType> => {
  let output = '';
  const { script } = data;
  if (!script) return { output: 'NO DEPLOY SCRIPT FOUND', succeeded: false };

  const homeDir = os.homedir();
  const folderLocation = path.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', 'HydraDeploys');
  if (!createDirectoryIfNotExists(folderLocation))
    return { output: `Error creating folder: ${folderLocation}`, succeeded: false };

  const uniqueHash = createDeployHash();
  ensureDirectoryExists(
    `${folderLocation}/${data.project.code}/${data.application.code}/${data.environment.name}/${data.version.version}-${uniqueHash}`,
  );
  const deployFolderName = `${folderLocation}/${data.project.code}/${data.application.code}/${data.environment.name}/${data.version.version}-${uniqueHash}`;

  if (!createDirectoryIfNotExists(deployFolderName))
    return { output: `Error creating folder: ${deployFolderName}`, succeeded: false };
  let deployScriptOutput: ExecutionResultReturnType = { output: 'Script did not execute', succeeded: false };
  if (operatingSystem === 'windows') {
    const scriptPath = `${deployFolderName}/deploy-script.ps1`;
    fs.writeFileSync(scriptPath, script);
    output += logMessage(deployFolderName, 'info', `Deploy script written to ${scriptPath}`);

    deployScriptOutput = await runDeployScript(`sh ${deployFolderName}/deploy-script.sh`, deployFolderName);
    output += deployScriptOutput.output;
  } else {
    fs.writeFileSync(`${deployFolderName}/deploy-script.sh`, script);
    execSync(`chmod +x ${deployFolderName}/deploy-script.sh`);
    output += logMessage(deployFolderName, 'info', `Deploy script written to ${deployFolderName}/deploy-script.sh`);

    deployScriptOutput = await runDeployScript(`sh ${deployFolderName}/deploy-script.sh`, deployFolderName);
    output += deployScriptOutput.output;
    await cleanupOldDeployments(
      deployFolderName,
      data.project.code,
      data.application.code,
      data.environment.name,
      keepDeployments,
    );
  }
  return { output: output, succeeded: deployScriptOutput.succeeded };
};
