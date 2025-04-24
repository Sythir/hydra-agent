import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Logs a message to a logs.txt file in the specified folder.
 * Creates the folder and file if they don't exist.
 *
 * @param {string} folderName - The folder to store the logs.txt file.
 * @param {'info' | 'warning' | 'error'} type - The type of the log message.
 * @param {string} message - The log message to write.
 */
export const logMessage = (folderName: string, type: 'info' | 'warning' | 'error', message: string): string => {
  const homeDir = os.homedir();
  const folderLocation = path.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', 'HydraDeploys', folderName);
console.log(message)
  if (!fs.existsSync(folderLocation)) {
    fs.mkdirSync(folderLocation, { recursive: true });
  }

  // Path to the logs.txt file
  const logFilePath = path.join(folderLocation, 'logs.txt');

  // Format the log message with a timestamp
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;

  // Append the log message to the file
  fs.appendFileSync(logFilePath, logEntry, 'utf8');

  return logEntry;
};
