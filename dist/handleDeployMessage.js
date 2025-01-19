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
const util_1 = __importDefault(require("util"));
const execAsync = util_1.default.promisify(child_process_1.exec);
function runDeployScript(deployScript, deployFolderName) {
    return __awaiter(this, void 0, void 0, function* () {
        const timeout = Number(process.env.DEPLOY_TIMEOUT_IN_SECONDS || 10) * 1000;
        (0, logMessage_1.logMessage)(deployFolderName, "info", `Starting deploy script execution`);
        const scriptExecution = execAsync(deployScript, { encoding: 'utf8' });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Deploy script execution timed out after ${timeout / 1000} seconds`));
            }, timeout);
        });
        try {
            const { stdout, stderr } = yield Promise.race([scriptExecution, timeoutPromise]);
            if (stderr) {
                throw new Error(`Error executing deploy script: ${stderr}`);
            }
            else {
                (0, logMessage_1.logMessage)(deployFolderName, "info", "Output deploy script: " + stdout.toString());
                (0, logMessage_1.logMessage)(deployFolderName, "info", `Deploy script completed successfully`);
            }
            return stdout.toString();
        }
        catch (error) {
            if (scriptExecution.child) {
                scriptExecution.child.kill('SIGTERM'); // Terminate the script if still running
            }
            (0, logMessage_1.logMessage)(deployFolderName, "error", `Deploy execution failed: ${error.message}, if this timeout is too short, you can increase it in the env variables`);
            throw error;
        }
    });
}
const handleDeployMessage = (data, operatingSystem) => __awaiter(void 0, void 0, void 0, function* () {
    const { script } = data;
    if (!script)
        return;
    const updatedScript = script.replace('$VERSION', data.version.version).replace('$PACKAGENAME', data.application.appId).replace('$PROJECTNAME', data.project.name);
    const homeDir = os_1.default.homedir();
    const folderLocation = path_1.default.join(homeDir, process.env.DEPLOY_LOGS_DIRECTORY || '', 'HydraDeploys');
    if (!(0, createDirectoryIfNotExists_1.createDirectoryIfNotExists)(folderLocation))
        return;
    const uniqueHash = (0, createDeployHash_1.createDeployHash)();
    const deployFolderName = `${data.project.code}-${data.application.code}-${data.environment.name}-${data.version.version}-${uniqueHash}`;
    const deployFolderLocation = `${folderLocation}/${deployFolderName}`;
    if (!(0, createDirectoryIfNotExists_1.createDirectoryIfNotExists)(deployFolderLocation))
        return;
    let deployScriptOutput;
    if (operatingSystem === "windows") {
        try {
            const scriptPath = `${deployFolderLocation}/deploy-script.ps1`;
            fs_1.default.writeFileSync(scriptPath, updatedScript);
            (0, logMessage_1.logMessage)(deployFolderName, "info", `Deploy script written to ${scriptPath}`);
            deployScriptOutput = yield runDeployScript(`sh ${deployFolderLocation}/deploy-script.sh`, deployFolderName);
        }
        catch (err) {
            (0, logMessage_1.logMessage)(deployFolderName, "error", `Error handling deploy script: ${err}`);
            throw err;
        }
    }
    else {
        try {
            fs_1.default.writeFileSync(`${deployFolderLocation}/deploy-script.sh`, updatedScript);
            (0, logMessage_1.logMessage)(deployFolderName, "info", `Deploy script written to ${deployFolderLocation}/deploy-script.sh`);
            deployScriptOutput = yield runDeployScript(`sh ${deployFolderLocation}/deploy-script.sh`, deployFolderName);
        }
        catch (err) {
            throw err;
        }
        return deployScriptOutput;
    }
});
exports.handleDeployMessage = handleDeployMessage;
