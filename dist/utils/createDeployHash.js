"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeployHash = void 0;
const crypto_1 = __importDefault(require("crypto"));
const createDeployHash = () => {
    const currentDateTime = new Date().toISOString();
    return crypto_1.default.createHash('sha256')
        .update(currentDateTime)
        .digest('hex');
};
exports.createDeployHash = createDeployHash;
