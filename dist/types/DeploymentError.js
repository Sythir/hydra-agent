"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeploymentErrorCodes = exports.DeploymentError = void 0;
class DeploymentError extends Error {
    constructor(message, code, context) {
        super(message);
        this.name = 'DeploymentError';
        this.code = code;
        this.context = context;
        Object.setPrototypeOf(this, DeploymentError.prototype);
    }
}
exports.DeploymentError = DeploymentError;
exports.DeploymentErrorCodes = {
    SCRIPT_NOT_PROVIDED: 'SCRIPT_NOT_PROVIDED',
    DIRECTORY_CREATION_FAILED: 'DIRECTORY_CREATION_FAILED',
    DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
    UNZIP_FAILED: 'UNZIP_FAILED',
    SCRIPT_EXECUTION_FAILED: 'SCRIPT_EXECUTION_FAILED',
    SCRIPT_TIMEOUT: 'SCRIPT_TIMEOUT',
};
