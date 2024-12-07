import fs from 'fs';
import { logMessage } from './logMessage';

export const createDirectoryIfNotExists = (directory: string) => {
  if (!fs.existsSync(directory)) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      logMessage('_logs', "info", `Created directory: ${directory}`);
      return true;
    } catch (err) {
      logMessage('_logs', "error", `Error creating directory: ${err}`);
      return false;
    }
  }

  logMessage('_logs', "info", `Directory already exists: ${directory}`);
  return true;
};
