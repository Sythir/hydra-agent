import fs from 'fs';
import path from 'path';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentError, DeploymentErrorCodes } from '../../types/DeploymentError';
import { IisConfigFile } from '../../types/step-types/iis';
import { configMerger } from '../../config-merger';

export async function deployConfigFile(
  config: IisConfigFile,
  deployFolder: string,
  logger: LoggerFunc,
): Promise<void> {
  const relativePath = config.path || '';
  const fullPath = path.join(deployFolder, relativePath, config.name);
  const dirPath = path.dirname(fullPath);

  logger(deployFolder, 'info', `Processing config file: ${config.name} (strategy: ${config.deployStrategy})`);

  if (config.deployStrategy === 'skip') {
    logger(deployFolder, 'info', `Skipping config file: ${config.name}`);
    return;
  }

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  try {
    if (config.deployStrategy === 'override') {
      fs.writeFileSync(fullPath, config.data, 'utf8');
      logger(deployFolder, 'info', `Config file overwritten: ${config.name}`);
    } else if (config.deployStrategy === 'merge') {
      let existing = '';
      if (fs.existsSync(fullPath)) {
        existing = fs.readFileSync(fullPath, 'utf8');
      }

      const merged = configMerger(existing, config.data, config.type);
      fs.writeFileSync(fullPath, merged, 'utf8');
      logger(deployFolder, 'info', `Config file merged: ${config.name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new DeploymentError(
      `Failed to deploy config file '${config.name}': ${errorMessage}`,
      DeploymentErrorCodes.CONFIG_MERGE_FAILED,
      { fileName: config.name, strategy: config.deployStrategy },
    );
  }
}

export async function deployConfigFiles(
  configs: IisConfigFile[],
  deployFolder: string,
  logger: LoggerFunc,
): Promise<void> {
  if (configs.length === 0) {
    logger(deployFolder, 'info', 'No config files to deploy');
    return;
  }

  logger(deployFolder, 'info', `Deploying ${configs.length} config file(s)`);

  for (const config of configs) {
    await deployConfigFile(config, deployFolder, logger);
  }

  logger(deployFolder, 'info', 'All config files deployed successfully');
}
