import fs from 'fs'
import { Data } from './types/data';
import { createDeployHash } from './utils/createDeployHash';

export const handleDeployMessage = (data: Data, os: "windows" | "linux") => {
  const { script } = data;
  if (!script) return;

  if (os === "windows") {
  } else {
    const folderLocation = `${process.env.DEPLOY_LOGS_DIRECTORY}/HydraDeploys`;
    if (!fs.existsSync(folderLocation)) {
      fs.mkdirSync(folderLocation);
    }
    const uniqueHash = createDeployHash();
    const deployFolderName = `${data.project.code}-${data.application.code}-${data.environment.name}-${data.version.version}-${uniqueHash}`
    // create a forlder in a specific location
    const folderPath = '~'
    //fs.writeFile();
  }
};
