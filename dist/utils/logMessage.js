"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const createLogger = (deploymentId, socket) => {
    return (folderName, type, message) => {
        if (!message)
            throw new Error('Message is required');
        const folderLocation = folderName;
        if (!fs_1.default.existsSync(folderLocation)) {
            fs_1.default.mkdirSync(folderLocation, { recursive: true });
        }
        const logFilePath = path_1.default.join(folderLocation, 'logs.txt');
        // Format the log message with a timestamp
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
        fs_1.default.appendFileSync(logFilePath, logEntry, 'utf8');
        socket.emit('log', {
            deploymentId: deploymentId,
            type: type,
            timestamp: new Date().toISOString(),
            log: message,
        });
    };
};
exports.createLogger = createLogger;
