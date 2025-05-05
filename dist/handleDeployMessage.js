"use strict";
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
const util_1 = __importDefault(require("util"));
const ensureDirectoryExists_1 = require("./utils/ensureDirectoryExists");
const CleanupOldDeployments_1 = require("./utils/CleanupOldDeployments");
const execAsync = util_1.default.promisify(child_process_1.exec);
async function runDeployScript(deployScript, deployFolderName) {
    let output = '';
    const timeout = Number(process.env.DEPLOY_TIMEOUT_IN_SECONDS || 60) * 1000;
    output += (0, logMessage_1.logMessage)(deployFolderName, 'info', `Starting deploy script execution`);
    const scriptExecution = execAsync(deployScript, { encoding: 'utf8' });
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Deploy script execution timed out after ${timeout / 1000} seconds`));
        }, timeout);
    });
    try {
        const result = (await Promise.race([scriptExecution, timeoutPromise]));
        output += (0, logMessage_1.logMessage)(deployFolderName, 'info', 'Output deploy script:\n' + result.stdout.toString());
        output += (0, logMessage_1.logMessage)(deployFolderName, 'info', `Deploy script completed successfully`);
        return { succeeded: true, output: output };
    }
    catch (error) {
        if (scriptExecution.child) {
            scriptExecution.child.kill('SIGTERM'); // Terminate the script if still running
        }
        if (error.code !== 0) {
            output += (0, logMessage_1.logMessage)(deployFolderName, 'info', 'Output deploy script:\n ' + error.stdout.toString());
            output += (0, logMessage_1.logMessage)(deployFolderName, 'error', `Deploy script exited with code ${error.code}: ${error.stderr.toString()}`);
            return { succeeded: false, output: output };
        }
        output += (0, logMessage_1.logMessage)(deployFolderName, 'error', `Deploy execution failed: ${error.message} if this timeout is too short, you can increase it in the env variables`);
        return { succeeded: false, output: output };
    }
}
const handleDeployMessage = async (data, operatingSystem, keepDeployments) => {
    let output = '';
    const { script } = data;
    if (!script)
        return { output: 'NO DEPLOY SCRIPT FOUND', succeeded: false };
    const homeDir = os_1.default.homedir();
    const folderLocation = path_1.default.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', 'HydraDeploys');
    if (!(0, createDirectoryIfNotExists_1.createDirectoryIfNotExists)(folderLocation))
        return { output: `Error creating folder: ${folderLocation}`, succeeded: false };
    const uniqueHash = (0, createDeployHash_1.createDeployHash)();
    (0, ensureDirectoryExists_1.ensureDirectoryExists)(`${folderLocation}/${data.project.code}/${data.application.code}/${data.environment.name}/${data.version.version}-${uniqueHash}`);
    const deployFolderName = `${folderLocation}/${data.project.code}/${data.application.code}/${data.environment.name}/${data.version.version}-${uniqueHash}`;
    if (!(0, createDirectoryIfNotExists_1.createDirectoryIfNotExists)(deployFolderName))
        return { output: `Error creating folder: ${deployFolderName}`, succeeded: false };
    let deployScriptOutput = { output: 'Script did not execute', succeeded: false };
    if (operatingSystem === 'windows') {
        const scriptPath = `${deployFolderName}/deploy-script.ps1`;
        fs_1.default.writeFileSync(scriptPath, script);
        output += (0, logMessage_1.logMessage)(deployFolderName, 'info', `Deploy script written to ${scriptPath}`);
        deployScriptOutput = await runDeployScript(`sh ${deployFolderName}/deploy-script.sh`, deployFolderName);
        output += deployScriptOutput.output;
    }
    else {
        fs_1.default.writeFileSync(`${deployFolderName}/deploy-script.sh`, script);
        (0, child_process_1.execSync)(`chmod +x ${deployFolderName}/deploy-script.sh`);
        output += (0, logMessage_1.logMessage)(deployFolderName, 'info', `Deploy script written to ${deployFolderName}/deploy-script.sh`);
        deployScriptOutput = await runDeployScript(`sh ${deployFolderName}/deploy-script.sh`, deployFolderName);
        output += deployScriptOutput.output;
        await (0, CleanupOldDeployments_1.cleanupOldDeployments)(deployFolderName, data.project.code, data.application.code, data.environment.name, keepDeployments);
    }
    return { output: output, succeeded: deployScriptOutput.succeeded };
};
exports.handleDeployMessage = handleDeployMessage;
