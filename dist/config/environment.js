"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnvironmentConfig = loadEnvironmentConfig;
exports.parseKeepDeployments = parseKeepDeployments;
const constants_1 = require("./constants");
function getRequiredEnv(key, fallback) {
    const value = process.env[key] || fallback;
    if (!value) {
        throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
}
function getOptionalEnv(key, fallback) {
    return process.env[key] || fallback;
}
function getEnvNumber(key, fallback) {
    const value = process.env[key];
    if (!value)
        return fallback;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}
function loadEnvironmentConfig(args) {
    const tokenIndex = args.indexOf('--agent-key');
    const agentKey = process.env.AGENT_KEY || (tokenIndex !== -1 ? args[tokenIndex + 1] : undefined);
    if (!agentKey) {
        throw new Error('Agent key is not set. Use the AGENT_KEY environment variable or pass it as an argument (e.g. --agent-key <agent-key>)');
    }
    return {
        agentKey,
        agentVersion: process.env.AGENT_VERSION,
        host: getOptionalEnv('HOST', 'https://hydra.sythir.com/api/deployment-gateway'),
        deployLogsDirectory: getOptionalEnv('DEPLOY_LOGS_DIRECTORY', ''),
        deployTimeoutSeconds: getEnvNumber('DEPLOY_TIMEOUT_IN_SECONDS', constants_1.DEFAULT_DEPLOY_TIMEOUT_SECONDS),
    };
}
function parseKeepDeployments(args) {
    const keepDeploymentsIndex = args.indexOf('--keep-deployments');
    if (keepDeploymentsIndex === -1) {
        return constants_1.DEFAULT_KEEP_DEPLOYMENTS;
    }
    const parsedValue = parseInt(args[keepDeploymentsIndex + 1], 10);
    if (isNaN(parsedValue) || parsedValue <= 0) {
        console.warn(`Invalid value for --keep-deployments. Using default value of ${constants_1.DEFAULT_KEEP_DEPLOYMENTS}.`);
        return constants_1.DEFAULT_KEEP_DEPLOYMENTS;
    }
    return parsedValue;
}
