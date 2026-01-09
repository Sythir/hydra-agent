import fs from 'fs';
import { ExecutionResultReturnType } from '../types/ExecutionResultReturnType';
import { LoggerFunc } from './logMessage';

export const createDirectoryIfNotExists = (directory: string, logger: LoggerFunc): ExecutionResultReturnType => {
  if (!fs.existsSync(directory)) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      logger('_logs', 'info', `Created directory: ${directory}`);
      return { succeeded: true };
    } catch (err) {
      logger('_logs', 'error', `Error creating directory: ${err}`);

      return { succeeded: false };
    }
  }

  logger('_logs', 'info', `Directory already exists: ${directory}`);
  return { succeeded: true };
};
