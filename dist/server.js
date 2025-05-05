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
const version = process.env.PACKAGE_VERSION;
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
console.log(`Agent Version: ${version}`);
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
    const queueIndex = queue.findIndex((item) => item.id === data.id);
    if (queueIndex > -1) {
        return;
    }
    // Add the data to the queue
    queue.push(data);
    socket.emit(`version-status`, {
        status: 'pending',
        deploymentId: data.id,
    });
    if (!isProcessing) {
        processQueue();
    }
});
socket.on(`inprogress-deployments-${token}`, async (data) => {
    if (!processingItem) {
        socket.emit(`version-status`, {
            status: 'error',
            deploymentId: data
        });
        return;
    }
    if (processingItem.id === data) {
        return;
    }
    socket.emit(`version-status`, {
        status: 'error',
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
        socket.emit(`version-status`, {
            status: 'in-progress',
            deploymentId: data.id,
        });
        const output = [];
        for (const step of data.steps) {
            if ((step.type === 'script' || step.type === 'derived') && step.message) {
                const deployScriptOutput = await (0, handleDeployMessage_1.handleDeployMessage)(step.message, operatingSystem, keepDeployments);
                output.push(deployScriptOutput);
            }
            else {
                console.log('Send server api call to execute step with id ' + step.id);
            }
        }
        const allSucceeded = output.every((item) => item.succeeded);
        socket.emit(`version-status`, {
            status: allSucceeded ? 'success' : 'error',
            deploymentId: data.id,
            output: output.map(x => x.output).join('\n'),
        });
        processQueue();
    }
    catch (error) {
        socket.emit(`version-status`, {
            status: 'error',
            deploymentId: data.id,
            output: error.message,
        });
        processQueue();
    }
}
