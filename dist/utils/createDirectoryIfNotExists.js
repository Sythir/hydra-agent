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
            (0, logMessage_1.logMessage)('_logs', "info", `Created directory: ${directory}`);
            return true;
        }
        catch (err) {
            (0, logMessage_1.logMessage)('_logs', "error", `Error creating directory: ${err}`);
            return false;
        }
    }
    (0, logMessage_1.logMessage)('_logs', "info", `Directory already exists: ${directory}`);
    return true;
};
exports.createDirectoryIfNotExists = createDirectoryIfNotExists;
