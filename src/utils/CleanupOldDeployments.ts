import path from 'path';
import fs from 'fs';
import { LoggerFunc } from './logMessage';

export async function cleanupOldDeployments(
  deployFolderName: string,
  parentDir: string,
  keepDeployments: number,
  logger: LoggerFunc
) {
  try {
    const entries = await fs.promises.readdir(parentDir, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => {
        const aStat = fs.statSync(path.join(parentDir, a.name));
        const bStat = fs.statSync(path.join(parentDir, b.name));
        return aStat.birthtimeMs - bStat.birthtimeMs; // Sort by creation time
      });

    if (directories.length > keepDeployments) {
      const oldestDir = directories[0];
      const oldestDirPath = path.join(parentDir, oldestDir.name);

      // Use a more robust way to delete the directory recursively
      await fs.promises.rm(oldestDirPath, { recursive: true, force: true });
    }
  } catch (error) {
    logger(deployFolderName, 'error', `Error cleaning up old deployments: ${error}`);
  }
}
