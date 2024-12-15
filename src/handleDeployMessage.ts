import fs from 'fs'
import { Data } from './types/data';
import { createDeployHash } from './utils/createDeployHash';
import os from 'os';
import path from 'path';
import { logMessage } from './utils/logMessage';
import { exec } from 'child_process';
import { createDirectoryIfNotExists } from './utils/createDirectoryIfNotExists';
import util from 'util';

const execAsync = util.promisify(exec);

async function runDeployScript(deployScript: string, deployFolderName: string) {
  const timeout = Number(process.env.DEPLOY_TIMEOUT_IN_SECONDS || 10) * 1000;

  logMessage(deployFolderName, "info", `Starting deploy script execution`);
  const scriptExecution = execAsync(deployScript, { encoding: 'utf8' });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Deploy script execution timed out after ${timeout / 1000} seconds`));
    }, timeout);
  });

  try {
    const { stdout, stderr } = await Promise.race([scriptExecution, timeoutPromise]) as any;

    if (stderr) {
      throw new Error(`Error executing deploy script: ${stderr}`);
    } else {
      logMessage(deployFolderName, "info", "Output deploy script: " + stdout.toString());
      logMessage(deployFolderName, "info", `Deploy script completed successfully`);
    }

    return stdout;
  } catch (error: any) {
    if (scriptExecution.child) {
      scriptExecution.child.kill('SIGTERM'); // Terminate the script if still running
    }
    logMessage(deployFolderName, "error", `Deploy execution failed: ${error.message}, if this timeout is too short, you can increase it in the env variables`);
    throw error;
  }
}


export const handleDeployMessage = async (data: Data, operatingSystem: "windows" | "linux") => {
  const { script } = data;
  if (!script) return;

  const homeDir = os.homedir();
  const folderLocation = path.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', 'HydraDeploys');
  if (!createDirectoryIfNotExists(folderLocation)) return;

  const uniqueHash = createDeployHash();
  const deployFolderName = `${data.project.code}-${data.application.code}-${data.environment.name}-${data.version.version}-${uniqueHash}`;
  const deployFolderLocation = `${folderLocation}/${deployFolderName}`;
  if (!createDirectoryIfNotExists(deployFolderLocation)) return;

  if (operatingSystem === "windows") {
    try {
      const scriptPath = `${deployFolderLocation}/deploy-script.ps1`;
      fs.writeFileSync(scriptPath, script);
      logMessage(deployFolderName, "info", `Deploy script written to ${scriptPath}`);

      await runDeployScript(`sh ${deployFolderLocation}/deploy-script.sh`, deployFolderName);
    } catch (err) {
      logMessage(deployFolderName, "error", `Error handling deploy script: ${err}`);
      throw err;
    }
  } else {
    try {
      fs.writeFileSync(`${deployFolderLocation}/deploy-script.sh`, script);
      logMessage(deployFolderName, "info", `Deploy script written to ${deployFolderLocation}/deploy-script.sh`);

      await runDeployScript(`sh ${deployFolderLocation}/deploy-script.sh`, deployFolderName);
    } catch (err) {
      throw err;
    }
  }
};
