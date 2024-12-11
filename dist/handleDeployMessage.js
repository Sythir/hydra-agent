"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDeployMessage = void 0;
const fs_1 = __importDefault(require("fs"));
const createDeployHash_1 = require("./utils/createDeployHash");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const logMessage_1 = require("./utils/logMessage");
const child_process_1 = require("child_process");
const createDirectoryIfNotExists_1 = require("./utils/createDirectoryIfNotExists");
const handleDeployMessage = (data, operatingSystem) => __awaiter(void 0, void 0, void 0, function* () {
    const { script } = data;
    if (!script)
        return;
    const homeDir = os_1.default.homedir();
    const folderLocation = path_1.default.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', 'HydraDeploys');
    if (!(0, createDirectoryIfNotExists_1.createDirectoryIfNotExists)(folderLocation))
        return;
    const uniqueHash = (0, createDeployHash_1.createDeployHash)();
    const deployFolderName = `${data.project.code}-${data.application.code}-${data.environment.name}-${data.version.version}-${uniqueHash}`;
    const deployFolderLocation = `${folderLocation}/${deployFolderName}`;
    if (!(0, createDirectoryIfNotExists_1.createDirectoryIfNotExists)(deployFolderLocation))
        return;
    if (operatingSystem === "windows") {
        try {
            const scriptPath = `${deployFolderLocation}/deploy-script.ps1`;
            fs_1.default.writeFileSync(scriptPath, script);
            (0, logMessage_1.logMessage)(deployFolderName, "info", `Deploy script written to ${scriptPath}`);
            // Execute the PowerShell script
            const output = (0, child_process_1.execSync)(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { encoding: 'utf8' });
            (0, logMessage_1.logMessage)(deployFolderName, "info", "Output deploy script: " + output.toString());
            (0, logMessage_1.logMessage)(deployFolderName, "info", `Deploy script completed successfully`);
        }
        catch (err) {
            (0, logMessage_1.logMessage)(deployFolderName, "error", `Error handling deploy script: ${err}`);
            return;
        }
    }
    else {
        try {
            fs_1.default.writeFileSync(`${deployFolderLocation}/deploy-script.sh`, script);
            (0, logMessage_1.logMessage)(deployFolderName, "info", `Deploy script written to ${deployFolderLocation}/deploy-script.sh`);
            const output = (0, child_process_1.execSync)(`sh ${deployFolderLocation}/deploy-script.sh`, { encoding: 'utf8' });
            (0, logMessage_1.logMessage)(deployFolderName, "info", "Output deploy script: " + output.toString());
            (0, logMessage_1.logMessage)(deployFolderName, "info", `Deploy script completed successfully`);
        }
        catch (err) {
            (0, logMessage_1.logMessage)(deployFolderName, "error", `Error handling deploy script: ${err}`);
            return;
        }
    }
});
exports.handleDeployMessage = handleDeployMessage;
