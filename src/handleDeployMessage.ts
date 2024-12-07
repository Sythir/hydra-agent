import fs from 'fs'
import { Data } from './types/data';
import { createDeployHash } from './utils/createDeployHash';
import os from 'os';
import path from 'path';
import { logMessage } from './utils/logMessage';
import { execSync } from 'child_process';

export const handleDeployMessage = (data: Data, operatingSystem: "windows" | "linux") => {
  const { script } = data;
  if (!script) return;

  if (operatingSystem === "windows") {
  } else {
    const homeDir = os.homedir();
    const folderLocation = path.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', 'HydraDeploys');
    const folderExists = fs.existsSync(folderLocation);
    if (!folderExists) {
      try {
        fs.mkdirSync(folderLocation, { recursive: true });
      } catch (err) {
        console.error(`Error creating folder: ${err}`);
        return;
      }
    }

    const uniqueHash = createDeployHash();
    const deployFolderName = `${data.project.code}-${data.application.code}-${data.environment.name}-${data.version.version}-${uniqueHash}`;
    const deployFolderLocation = `${folderLocation}/${deployFolderName}`;
    try {
      fs.mkdirSync(`${deployFolderLocation}`, { recursive: true });
    } catch (err) {
      logMessage('_logs', "error", `Error creating deployment folder: ${err}`);
    }

    try {
      fs.writeFileSync(`${deployFolderLocation}/deploy-script.sh`, script);
    } catch (err) {
      logMessage(deployFolderName, "error", `Error writing file: ${err}`);
      return;
    }

    logMessage(deployFolderName, "info", `Deploy script written to ${deployFolderLocation}/deploy-script.sh`);

    // Step 2: Run the script and log the output

    try {
      const output = execSync(`sh ${deployFolderLocation}/deploy-script.sh`, { encoding: 'utf8' });
      console.log('rorororo', output)
      logMessage(deployFolderName, "info", "Output deploy script: " + output.toString());
      logMessage(deployFolderName, "info", `Deploy script completed successfully`);


    } catch (err) {
      logMessage(deployFolderName, "error", `Error running deploy script: ${err}`);
      return;
    }
  }
};
