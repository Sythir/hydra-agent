"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logMessage = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
/**
 * Logs a message to a logs.txt file in the specified folder.
 * Creates the folder and file if they don't exist.
 *
 * @param {string} folderName - The folder to store the logs.txt file.
 * @param {'info' | 'warning' | 'error'} type - The type of the log message.
 * @param {string} message - The log message to write.
 */
const logMessage = (folderName, type, message) => {
    const homeDir = os_1.default.homedir();
    const folderLocation = path_1.default.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', 'HydraDeploys', folderName);
    console.log(message);
    if (!fs_1.default.existsSync(folderLocation)) {
        fs_1.default.mkdirSync(folderLocation, { recursive: true });
    }
    // Path to the logs.txt file
    const logFilePath = path_1.default.join(folderLocation, 'logs.txt');
    // Format the log message with a timestamp
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
    // Append the log message to the file
    fs_1.default.appendFileSync(logFilePath, logEntry, 'utf8');
    return logEntry;
};
exports.logMessage = logMessage;
