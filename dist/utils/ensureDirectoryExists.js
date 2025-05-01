"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDirectoryExists = ensureDirectoryExists;
const fs_1 = __importDefault(require("fs"));
function ensureDirectoryExists(directoryPath) {
    if (!fs_1.default.existsSync(directoryPath)) {
        // Recursively create directories
        fs_1.default.mkdirSync(directoryPath, { recursive: true });
    }
}
