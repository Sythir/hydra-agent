"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEPLOY_FOLDER_NAME = exports.SOCKET_EVENTS = exports.DEPLOYMENT_STATUS = exports.DEFAULT_DEPLOY_TIMEOUT_SECONDS = exports.DEFAULT_KEEP_DEPLOYMENTS = void 0;
exports.DEFAULT_KEEP_DEPLOYMENTS = 5;
exports.DEFAULT_DEPLOY_TIMEOUT_SECONDS = 60;
exports.DEPLOYMENT_STATUS = {
    PENDING: 'pending',
    IN_PROGRESS: 'in-progress',
    SUCCESS: 'success',
    ERROR: 'error',
};
exports.SOCKET_EVENTS = {
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    REGISTER_KEY: 'register-key',
    VERSION_STATUS: 'version-status',
    LOG: 'log',
};
exports.DEPLOY_FOLDER_NAME = 'HydraDeploys';
