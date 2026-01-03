"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const socket_io_client_1 = require("socket.io-client");
const os_1 = __importDefault(require("os"));
const handleDeployment_1 = require("./handleDeployment");
const logMessage_1 = require("./utils/logMessage");
const environment_1 = require("./config/environment");
const constants_1 = require("./config/constants");
const args = process.argv.slice(2);
const config = (0, environment_1.loadEnvironmentConfig)(args);
const keepDeployments = (0, environment_1.parseKeepDeployments)(args);
console.log(`Agent Key: ${config.agentKey.slice(0, 5)}... (partially shown)`);
console.log(`Agent Version: ${config.agentVersion}`);
console.log(`Keep Deployments: ${keepDeployments}`);
const socket = (0, socket_io_client_1.io)(config.host, {
    query: { token: config.agentKey, type: 'agent' },
});
const platform = os_1.default.platform();
const operatingSystem = platform === 'win32' ? 'windows' : 'linux';
socket.on(constants_1.SOCKET_EVENTS.CONNECT, () => {
    console.log('Connected to the Socket.IO server');
    socket.emit(constants_1.SOCKET_EVENTS.REGISTER_KEY, { version: config.agentVersion });
});
socket.on(constants_1.SOCKET_EVENTS.DISCONNECT, () => {
    console.log('Disconnected from the server');
});
const queue = [];
let isProcessing = false;
let processingItem = null;
socket.on(`deploy-version-${config.agentKey}`, async (data) => {
    const queueIndex = queue.findIndex((item) => item.id === data.id);
    if (queueIndex > -1) {
        return;
    }
    queue.push(data);
    socket.emit(constants_1.SOCKET_EVENTS.VERSION_STATUS, {
        status: constants_1.DEPLOYMENT_STATUS.PENDING,
        deploymentId: data.id,
    });
    if (!isProcessing) {
        processQueue();
    }
});
socket.on(`inprogress-deployments-${config.agentKey}`, async (data) => {
    if (!processingItem) {
        socket.emit(constants_1.SOCKET_EVENTS.VERSION_STATUS, {
            status: constants_1.DEPLOYMENT_STATUS.ERROR,
            deploymentId: data,
        });
        return;
    }
    if (processingItem.id === data) {
        return;
    }
    socket.emit(constants_1.SOCKET_EVENTS.VERSION_STATUS, {
        status: constants_1.DEPLOYMENT_STATUS.ERROR,
        deploymentId: data,
    });
});
async function processQueue() {
    if (queue.length === 0) {
        isProcessing = false;
        processingItem = null;
        return;
    }
    isProcessing = true;
    const data = queue.shift();
    processingItem = data;
    try {
        console.log('version status: in-progress', data);
        socket.emit(constants_1.SOCKET_EVENTS.VERSION_STATUS, {
            status: constants_1.DEPLOYMENT_STATUS.IN_PROGRESS,
            deploymentId: data.id,
        });
        const logger = (0, logMessage_1.createLogger)(data.id, socket);
        let isFailed = false;
        for (const step of data.steps) {
            if ((step.type === 'script' || step.type === 'derived') && step.message) {
                const deployScriptOutput = await (0, handleDeployment_1.handleDeployment)(step.message, operatingSystem, keepDeployments, logger);
                if (!deployScriptOutput.succeeded) {
                    isFailed = true;
                    break;
                }
            }
            else {
                console.log('Send server api call to execute step with id ' + step.id);
            }
        }
        console.log('sending status', isFailed ? 'error' : 'success');
        socket.emit(constants_1.SOCKET_EVENTS.VERSION_STATUS, {
            status: isFailed ? constants_1.DEPLOYMENT_STATUS.ERROR : constants_1.DEPLOYMENT_STATUS.SUCCESS,
            deploymentId: data.id,
        });
        processQueue();
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        socket.emit(constants_1.SOCKET_EVENTS.VERSION_STATUS, {
            status: constants_1.DEPLOYMENT_STATUS.ERROR,
            deploymentId: data.id,
            output: errorMessage,
        });
        processQueue();
    }
}
