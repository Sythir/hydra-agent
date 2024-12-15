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
const socket_io_client_1 = __importDefault(require("socket.io-client"));
const os_1 = __importDefault(require("os"));
const handleDeployMessage_1 = require("./handleDeployMessage");
const token = process.env.AGENT_KEY;
const socket = (0, socket_io_client_1.default)(process.env.HOST, {
    query: { token },
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
socket.on(`deploy-version-${token}`, (data) => __awaiter(void 0, void 0, void 0, function* () {
    // Add the data to the queue
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
}));
function processQueue() {
    return __awaiter(this, void 0, void 0, function* () {
        if (queue.length === 0) {
            isProcessing = false;
            return;
        }
        isProcessing = true;
        const data = queue.shift();
        try {
            socket.emit(`version-status`, {
                status: "in-progress",
                appCode: data.application.code,
                projectCode: data.project.code,
                envId: data.environment.id,
            });
            yield (0, handleDeployMessage_1.handleDeployMessage)(data, operatingSystem);
            socket.emit(`version-status`, {
                status: "success",
                appCode: data.application.code,
                projectCode: data.project.code,
                envId: data.environment.id,
            });
            processQueue();
        }
        catch (error) {
            socket.emit(`version-status`, {
                status: "error",
                appCode: data.application.code,
                projectCode: data.project.code,
                envId: data.environment.id,
            });
            processQueue();
        }
    });
}
