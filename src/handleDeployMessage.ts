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
  try {
    const { stdout, stderr } = await execAsync(deployScript, { encoding: 'utf8' });
    if (stderr) {
      logMessage(deployFolderName, "error", `Error executing deploy script: ${stderr}`);
    } else {
      logMessage(deployFolderName, "info", "Output deploy script: " + stdout.toString());
      logMessage(deployFolderName, "info", `Deploy script completed successfully`);
    }
    return stdout;
  } catch (error: any) {
    logMessage(deployFolderName, "error", `Deploy execution failed: ${error.message}`);
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
      return;
    }
  } else {
    try {
      fs.writeFileSync(`${deployFolderLocation}/deploy-script.sh`, script);
      logMessage(deployFolderName, "info", `Deploy script written to ${deployFolderLocation}/deploy-script.sh`);

      await runDeployScript(`sh ${deployFolderLocation}/deploy-script.sh`, deployFolderName);
    } catch (err) {
      logMessage(deployFolderName, "error", `Error handling deploy script: ${err}`);
      return;
    }
  }
};
