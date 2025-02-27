import fs from 'fs';
import { logMessage } from './logMessage';
import {ExecutionResultReturnType} from "../types/ExecutionResultReturnType";

export const createDirectoryIfNotExists = (directory: string): ExecutionResultReturnType => {
  if (!fs.existsSync(directory)) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      return { output: logMessage('_logs', 'info', `Created directory: ${directory}`), succeeded: true };
    } catch (err) {
      return { output: logMessage('_logs', 'error', `Error creating directory: ${err}`), succeeded: false };
    }
  }

  logMessage('_logs', 'info', `Directory already exists: ${directory}`);
  return { output: logMessage('_logs', 'info', `Directory already exists: ${directory}`), succeeded: true };
};
