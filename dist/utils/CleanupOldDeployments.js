"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupOldDeployments = cleanupOldDeployments;
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const logMessage_1 = require("./logMessage");
async function cleanupOldDeployments(deployFolderName, projectCode, applicationCode, environmentName, keepDeployments) {
    const homeDir = os_1.default.homedir();
    const environmentDir = path_1.default.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', 'HydraDeploys', projectCode, applicationCode, environmentName);
    try {
        const entries = await fs_1.default.promises.readdir(environmentDir, { withFileTypes: true });
        const directories = entries
            .filter((entry) => entry.isDirectory())
            .sort((a, b) => {
            const aStat = fs_1.default.statSync(path_1.default.join(environmentDir, a.name));
            const bStat = fs_1.default.statSync(path_1.default.join(environmentDir, b.name));
            return aStat.birthtimeMs - bStat.birthtimeMs; // Sort by creation time
        });
        if (directories.length > keepDeployments) {
            const oldestDir = directories[0];
            const oldestDirPath = path_1.default.join(environmentDir, oldestDir.name);
            // Use a more robust way to delete the directory recursively
            await fs_1.default.promises.rm(oldestDirPath, { recursive: true, force: true });
        }
    }
    catch (error) {
        (0, logMessage_1.logMessage)(deployFolderName, 'error', `Error cleaning up old deployments: ${error}`);
    }
}
