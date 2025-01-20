"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const socket_io_client_1 = __importDefault(require("socket.io-client"));
const os_1 = __importDefault(require("os"));
const handleDeployMessage_1 = require("./handleDeployMessage");
const args = process.argv.slice(2); // Get arguments after the script name
const tokenIndex = args.indexOf('--agent-key');
const token = process.env.AGENT_KEY || args[tokenIndex + 1];
if (!token) {
    throw new Error('Agent key is not set. Use the AGENT_KEY environment variable or pass it as an argument(e.g. --agent-key <agent-key>)');
}
console.log('token', token);
const host = process.env.HOST || 'https://kvdels.nl/api/deployment-gateway';
const socket = (0, socket_io_client_1.default)(host, {
    query: { token, type: 'agent' },
});
const platform = os_1.default.platform();
const operatingSystem = platform === "win32" ? "windows" : "linux";
socket.on("connect", () => {
    console.log("Connected to the Socket.IO server");
    socket.emit('register-key');
});
// Handle disconnection
socket.on("disconnect", () => {
    console.log("Disconnected from the server");
});
const queue = [];
let isProcessing = false;
let processingItem;
socket.on(`deploy-version-${token}`, async (data) => {
    // Add the data to the queue
    console.log("deploy-version", data);
    queue.push(data);
    socket.emit(`version-status`, {
        status: "pending",
        appCode: data.application.code,
        projectCode: data.project.code,
        envId: data.environment.id,
    });
    if (!isProcessing) {
        processQueue();
    }
});
socket.on(`pending-deployments-${token}`, async (data) => {
    const queueIndex = queue.findIndex((item) => item.application.id === data.application.id && item.project.id === data.project.id && item.environment.id === data.environment.id && item.version.id === data.version.id);
    console.log("queueIndex", queueIndex);
    if (queueIndex > -1) {
        return;
    }
    queue.push(data);
    socket.emit(`version-status`, {
        status: "pending",
        appCode: data.application.code,
        projectCode: data.project.code,
        envId: data.environment.id,
    });
    if (!isProcessing) {
        processQueue();
    }
});
socket.on(`inprogress-deployments-${token}`, async (data) => {
    const { application, project, environment, version } = data;
    if (!processingItem) {
        socket.emit(`version-status`, {
            status: "error",
            appCode: application.code,
            projectCode: project.code,
            envId: environment.id,
        });
        return;
    }
    if (application.id === processingItem.application.id && project.id === processingItem.project.id && environment.id === processingItem.environment.id && version.id === processingItem.version.id) {
        return;
    }
    socket.emit(`version-status`, {
        status: "error",
        appCode: data.application.code,
        projectCode: data.project.code,
        envId: data.environment.id,
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
            status: "in-progress",
            appCode: data.application.code,
            projectCode: data.project.code,
            envId: data.environment.id,
        });
        const deployScriptOutput = await (0, handleDeployMessage_1.handleDeployMessage)(processingItem, operatingSystem);
        socket.emit(`version-status`, {
            status: "success",
            appCode: data.application.code,
            projectCode: data.project.code,
            envId: data.environment.id,
            output: deployScriptOutput,
        });
        processQueue();
    }
    catch (error) {
        socket.emit(`version-status`, {
            status: "error",
            appCode: data.application.code,
            projectCode: data.project.code,
            envId: data.environment.id,
            output: error.message,
        });
        processQueue();
    }
}
