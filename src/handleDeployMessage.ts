import fs from 'fs'
import { Data } from './types/data';
import { createDeployHash } from './utils/createDeployHash';
import os from 'os';
import path from 'path';
import { logMessage } from './utils/logMessage';
import { execSync } from 'child_process';
import { createDirectoryIfNotExists } from './utils/createDirectoryIfNotExists';

export const handleDeployMessage = (data: Data, operatingSystem: "windows" | "linux") => {
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

      // Execute the PowerShell script
      const output = execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { encoding: 'utf8' });
      logMessage(deployFolderName, "info", "Output deploy script: " + output.toString());
      logMessage(deployFolderName, "info", `Deploy script completed successfully`);
    } catch (err) {
      logMessage(deployFolderName, "error", `Error handling deploy script: ${err}`);
      return;
    }
  } else {
    try {
      fs.writeFileSync(`${deployFolderLocation}/deploy-script.sh`, script);
      logMessage(deployFolderName, "info", `Deploy script written to ${deployFolderLocation}/deploy-script.sh`);

      const output = execSync(`sh ${deployFolderLocation}/deploy-script.sh`, { encoding: 'utf8' });
      logMessage(deployFolderName, "info", "Output deploy script: " + output.toString());
      logMessage(deployFolderName, "info", `Deploy script completed successfully`);
    } catch (err) {
      logMessage(deployFolderName, "error", `Error handling deploy script: ${err}`);
      return;
    }
  }
};
