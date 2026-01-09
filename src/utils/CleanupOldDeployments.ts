import os from 'os';
import path from 'path';
import fs from 'fs';
import { LoggerFunc } from './logMessage';

export async function cleanupOldDeployments(
  deployFolderName: string,
  projectCode: string,
  applicationCode: string,
  environmentName: string,
  keepDeployments: number,
  logger: LoggerFunc
) {
  const homeDir = os.homedir();
  const environmentDir = path.join(
    homeDir,
    process.env.DEPLOY_LOGS_DIRECTORY || '',
    'HydraDeploys',
    projectCode,
    applicationCode,
    environmentName,
  );

  try {
    const entries = await fs.promises.readdir(environmentDir, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => {
        const aStat = fs.statSync(path.join(environmentDir, a.name));
        const bStat = fs.statSync(path.join(environmentDir, b.name));
        return aStat.birthtimeMs - bStat.birthtimeMs; // Sort by creation time
      });

    if (directories.length > keepDeployments) {
      const oldestDir = directories[0];
      const oldestDirPath = path.join(environmentDir, oldestDir.name);

      // Use a more robust way to delete the directory recursively
      await fs.promises.rm(oldestDirPath, { recursive: true, force: true });
    }
  } catch (error) {
    logger(deployFolderName, 'error', `Error cleaning up old deployments: ${error}`);
  }
}
