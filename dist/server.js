"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const socket_io_client_1 = require("socket.io-client");
const os_1 = __importDefault(require("os"));
const handleDeployMessage_1 = require("./handleDeployMessage");
const args = process.argv.slice(2);
const tokenIndex = args.indexOf('--agent-key');
const token = process.env.AGENT_KEY || args[tokenIndex + 1];
if (!token) {
    throw new Error('Agent key is not set. Use the AGENT_KEY environment variable or pass it as an argument(e.g. --agent-key <agent-key>)');
}
const keepDeploymentsIndex = args.indexOf('--keep-deployments');
let keepDeployments = 5;
if (keepDeploymentsIndex !== -1) {
    const parsedValue = parseInt(args[keepDeploymentsIndex + 1], 10);
    if (!isNaN(parsedValue) && parsedValue > 0) {
        keepDeployments = parsedValue;
    }
    else {
        console.warn('Invalid value for --keep-deployments. Using default value of 5.');
    }
}
console.log(`Agent Key: ${token.slice(0, 5)}... (partially shown)`);
console.log(`Keep Deployments: ${keepDeployments}`);
const host = process.env.HOST || 'https://hydra.sythir.com/api/deployment-gateway';
const socket = (0, socket_io_client_1.io)(host, {
    query: { token, type: 'agent' },
});
const platform = os_1.default.platform();
const operatingSystem = platform === 'win32' ? 'windows' : 'linux';
socket.on('connect', () => {
    console.log('Connected to the Socket.IO server');
    socket.emit('register-key');
});
// Handle disconnection
socket.on('disconnect', () => {
    console.log('Disconnected from the server');
});
const queue = [];
let isProcessing = false;
let processingItem;
socket.on(`deploy-version-${token}`, async (data) => {
    const queueIndex = queue.findIndex((item) => item.application.id === data.application.id &&
        item.project.id === data.project.id &&
        item.environment.id === data.environment.id &&
        item.version.id === data.version.id);
    if (queueIndex > -1) {
        return;
    }
    // Add the data to the queue
    queue.push(data);
    socket.emit(`version-status`, {
        status: 'pending',
        deploymentId: data.deployment.id,
    });
    if (!isProcessing) {
        processQueue();
    }
});
socket.on(`inprogress-deployments-${token}`, async (data) => {
    const { application, project, environment, version } = data;
    if (!processingItem) {
        socket.emit(`version-status`, {
            status: 'error',
            deploymentId: data.deployment.id,
        });
        return;
    }
    if (application.id === processingItem.application.id &&
        project.id === processingItem.project.id &&
        environment.id === processingItem.environment.id &&
        version.id === processingItem.version.id) {
        return;
    }
    socket.emit(`version-status`, {
        status: 'error',
        deploymentId: data.deployment.id,
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
    console.log('processing', data);
    processingItem = data;
    try {
        socket.emit(`version-status`, {
            status: 'in-progress',
            deploymentId: data.deployment.id,
        });
        const deployScriptOutput = await (0, handleDeployMessage_1.handleDeployMessage)(processingItem, operatingSystem, keepDeployments);
        socket.emit(`version-status`, {
            status: deployScriptOutput.succeeded ? 'success' : 'error',
            deploymentId: data.deployment.id,
            output: deployScriptOutput.output,
        });
        processQueue();
    }
    catch (error) {
        console.log(error);
        socket.emit(`version-status`, {
            status: 'error',
            deploymentId: data.deployment.id,
            output: error.message,
        });
        processQueue();
    }
}
