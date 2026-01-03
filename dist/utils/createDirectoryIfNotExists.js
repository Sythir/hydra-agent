"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDirectoryIfNotExists = void 0;
const fs_1 = __importDefault(require("fs"));
const createDirectoryIfNotExists = (directory, logger) => {
    if (!fs_1.default.existsSync(directory)) {
        try {
            fs_1.default.mkdirSync(directory, { recursive: true });
            logger('_logs', 'info', `Created directory: ${directory}`);
            return { succeeded: true };
        }
        catch (err) {
            logger('_logs', 'error', `Error creating directory: ${err}`);
            return { succeeded: false };
        }
    }
    logger('_logs', 'info', `Directory already exists: ${directory}`);
    return { succeeded: true };
};
exports.createDirectoryIfNotExists = createDirectoryIfNotExists;
