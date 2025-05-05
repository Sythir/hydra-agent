"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDirectoryIfNotExists = void 0;
const fs_1 = __importDefault(require("fs"));
const logMessage_1 = require("./logMessage");
const createDirectoryIfNotExists = (directory) => {
    if (!fs_1.default.existsSync(directory)) {
        try {
            fs_1.default.mkdirSync(directory, { recursive: true });
            return { output: (0, logMessage_1.logMessage)('_logs', 'info', `Created directory: ${directory}`), succeeded: true };
        }
        catch (err) {
            return { output: (0, logMessage_1.logMessage)('_logs', 'error', `Error creating directory: ${err}`), succeeded: false };
        }
    }
    (0, logMessage_1.logMessage)('_logs', 'info', `Directory already exists: ${directory}`);
    return { output: (0, logMessage_1.logMessage)('_logs', 'info', `Directory already exists: ${directory}`), succeeded: true };
};
exports.createDirectoryIfNotExists = createDirectoryIfNotExists;
