"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDeployment = void 0;
const fs_1 = __importDefault(require("fs"));
const createDeployHash_1 = require("./utils/createDeployHash");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const createDirectoryIfNotExists_1 = require("./utils/createDirectoryIfNotExists");
const ensureDirectoryExists_1 = require("./utils/ensureDirectoryExists");
const CleanupOldDeployments_1 = require("./utils/CleanupOldDeployments");
const IISUtils_1 = require("./utils/IISUtils");
async function runDeployScript(deployScript, deployFolderName, logger) {
    const timeout = Number(process.env.DEPLOY_TIMEOUT_IN_SECONDS || 60) * 1000;
    logger(deployFolderName, 'info', `Starting deploy script execution`);
    return new Promise((resolve) => {
        const childProcess = (0, child_process_1.spawn)(deployScript, {
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: deployFolderName
        });
        let stdoutData = '';
        let stderrData = '';
        let hasTimedOut = false;
        const timeoutId = setTimeout(() => {
            hasTimedOut = true;
            childProcess.kill('SIGTERM');
            logger(deployFolderName, 'error', `Deploy script execution timed out after ${timeout / 1000} seconds. If this timeout is too short, you can increase it in the env variables`);
            resolve({ succeeded: false });
        }, timeout);
        // Stream stdout in real-time
        childProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdoutData += output;
            logger(deployFolderName, 'info', output);
        });
        // Stream stderr in real-time
        childProcess.stderr.on('data', (data) => {
            const output = data.toString();
            stderrData += output;
            logger(deployFolderName, 'error', output);
        });
        // Handle process completion
        childProcess.on('close', (code) => {
            clearTimeout(timeoutId);
            if (hasTimedOut) {
                return; // Already handled by timeout
            }
            if (code === 0) {
                logger(deployFolderName, 'info', `Deploy script completed successfully with exit code ${code}`);
                resolve({ succeeded: true });
            }
            else {
                logger(deployFolderName, 'error', `Deploy script exited with code ${code}`);
                resolve({ succeeded: false });
            }
        });
        // Handle process errors
        childProcess.on('error', (error) => {
            clearTimeout(timeoutId);
            logger(deployFolderName, 'error', `Deploy script execution error: ${error.message}`);
            resolve({ succeeded: false });
        });
    });
}
const handleDeployment = async (data, operatingSystem, keepDeployments, logger) => {
    const { script } = data;
    if (!script)
        return { succeeded: false };
    const homeDir = os_1.default.homedir();
    const folderLocation = path_1.default.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', 'HydraDeploys');
    if (!(0, createDirectoryIfNotExists_1.createDirectoryIfNotExists)(folderLocation, logger))
        return { output: `Error creating folder: ${folderLocation}`, succeeded: false };
    const uniqueHash = (0, createDeployHash_1.createDeployHash)();
    (0, ensureDirectoryExists_1.ensureDirectoryExists)(`${folderLocation}/${data.project.code}/${data.application.code}/${data.environment.name}/${data.version.version}-${uniqueHash}`);
    const deployFolderName = `${folderLocation}/${data.project.code}/${data.application.code}/${data.environment.name}/${data.version.version}-${uniqueHash}`;
    if (!(0, createDirectoryIfNotExists_1.createDirectoryIfNotExists)(deployFolderName, logger))
        return { output: `Error creating folder: ${deployFolderName}`, succeeded: false };
    let deployScriptOutput = { output: 'Script did not execute', succeeded: false };
    if (operatingSystem === 'windows') {
        const scriptPath = `${deployFolderName}/deploy-script.ps1`;
        console.log(`powershell.exe -File ${scriptPath}`);
        fs_1.default.writeFileSync(scriptPath, script);
        if (data.application.registry.type === 'nuget') {
            const downloadUrl = data.application.registry.url + '/package/' + data.application.appId + '/' + data.version.version;
            try {
                (0, IISUtils_1.downloadNugetPackage)(downloadUrl, deployFolderName);
            }
            catch (e) {
                logger(deployFolderName, 'error', 'Failed to download the Nuget packages from: ' + downloadUrl);
                return { succeeded: false };
            }
        }
        logger(deployFolderName, 'info', `Deploy script written to ${scriptPath}`);
        deployScriptOutput = await runDeployScript(`powershell.exe -File ${scriptPath}`, deployFolderName, logger);
    }
    else {
        fs_1.default.writeFileSync(`${deployFolderName}/deploy-script.sh`, script);
        (0, child_process_1.execSync)(`chmod +x ${deployFolderName}/deploy-script.sh`);
        logger(deployFolderName, 'info', `Deploy script written to ${deployFolderName}/deploy-script.sh`);
        deployScriptOutput = await runDeployScript(`sh ${deployFolderName}/deploy-script.sh`, deployFolderName, logger);
        await (0, CleanupOldDeployments_1.cleanupOldDeployments)(deployFolderName, data.project.code, data.application.code, data.environment.name, keepDeployments, logger);
    }
    return { succeeded: deployScriptOutput.succeeded };
};
exports.handleDeployment = handleDeployment;
