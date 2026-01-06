import { io } from 'socket.io-client';
import os from 'os';
import { handleDeployment } from './handleDeployment';
import { createLogger } from './utils/logMessage';
import { loadEnvironmentConfig, parseKeepDeployments, parseDeployTimeout } from './config/environment';
import { DEPLOYMENT_STATUS, SOCKET_EVENTS } from './config/constants';
import { handleAgentUpdate, signalHealthy, isPostUpdateStartup } from './update';
import { AgentUpdateMessage, UPDATE_STATUS } from './types/update';

const args = process.argv.slice(2);
const config = loadEnvironmentConfig(args);
const keepDeployments = parseKeepDeployments(args);
const deployTimeout = parseDeployTimeout(args);

process.env.DEPLOY_TIMEOUT_IN_SECONDS = deployTimeout.toString();

console.log(`Agent Key: ${config.agentKey.slice(0, 5)}... (partially shown)`);
console.log(`Agent Version: ${config.agentVersion}`);
console.log(`Keep Deployments: ${keepDeployments}`);
console.log(`Deploy Timeout: ${deployTimeout}s`);

const socket = io(config.host, {
  query: { token: config.agentKey, type: 'agent' },
});

const platform = os.platform();
const operatingSystem = platform === 'win32' ? 'windows' : 'linux';

socket.on(SOCKET_EVENTS.CONNECT, async () => {
  console.log('Connected to the Socket.IO server');
  socket.emit(SOCKET_EVENTS.REGISTER_KEY, { version: config.agentVersion, os: operatingSystem });

  // Signal health after successful connection (for post-update health check)
  if (isPostUpdateStartup()) {
    try {
      await signalHealthy();
      console.log('Health check signal sent to launcher');
    } catch (err) {
      console.error('Failed to signal health:', err);
    }
  }
});

socket.on(SOCKET_EVENTS.DISCONNECT, () => {
  console.log('Disconnected from the server');
});

socket.on(`agent-update-${config.agentKey}`, async (data: AgentUpdateMessage) => {
  console.log('Received update command:', data);

  // Don't process update if we're currently deploying
  if (isProcessing) {
    socket.emit(SOCKET_EVENTS.AGENT_UPDATE_STATUS, {
      updateId: data.updateId,
      status: UPDATE_STATUS.FAILED,
      currentVersion: config.agentVersion,
      targetVersion: data.targetVersion,
      error: 'Agent is currently processing a deployment. Try again later.',
    });
    return;
  }

  if (config.agentVersion === data.targetVersion && !data.force) {
    socket.emit(SOCKET_EVENTS.AGENT_UPDATE_STATUS, {
      updateId: data.updateId,
      status: UPDATE_STATUS.SUCCESS,
      currentVersion: config.agentVersion,
      targetVersion: data.targetVersion,
    });
    return;
  }

  await handleAgentUpdate({
    socket,
    message: data,
    currentVersion: config.agentVersion || 'unknown',
  });
});

const queue: Message[] = [];
let isProcessing = false;
let processingItem: Message | null = null;

export interface AgentDeployMessageDto {
  deployment: { id: string };
  script: string;
  application: {
    id: string;
    name: string;
    code: string;
    appId: string;
    registry: {
      name: string;
      url: string;
      type: string;
    };
  };
  project: { id: string; name: string; code: string };
  environment: { id: string; name: string };
  version: { id: string; version: string };
  config: { type: string; data: string; name: string }[];
}

interface Step {
  id: string;
  name: string;
  type: string;
  message: AgentDeployMessageDto | null;
}

interface Message {
  id: string;
  steps: Step[];
}

socket.on(`deploy-version-${config.agentKey}`, async (data: Message) => {
  const queueIndex = queue.findIndex((item) => item.id === data.id);

  if (queueIndex > -1) {
    return;
  }

  queue.push(data);
  socket.emit(SOCKET_EVENTS.VERSION_STATUS, {
    status: DEPLOYMENT_STATUS.PENDING,
    deploymentId: data.id,
  });
  if (!isProcessing) {
    processQueue();
  }
});

socket.on(`inprogress-deployments-${config.agentKey}`, async (data: string) => {
  if (!processingItem) {
    socket.emit(SOCKET_EVENTS.VERSION_STATUS, {
      status: DEPLOYMENT_STATUS.ERROR,
      deploymentId: data,
    });
    return;
  }
  if (processingItem.id === data) {
    return;
  }

  socket.emit(SOCKET_EVENTS.VERSION_STATUS, {
    status: DEPLOYMENT_STATUS.ERROR,
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
  const data = queue.shift()!;
  processingItem = data;
  try {
    console.log('version status: in-progress', data);
    socket.emit(SOCKET_EVENTS.VERSION_STATUS, {
      status: DEPLOYMENT_STATUS.IN_PROGRESS,
      deploymentId: data.id,
    });

    const logger = createLogger(data.id, socket);
    let isFailed = false;
    for (const step of data.steps) {
      if ((step.type === 'script' || step.type === 'derived') && step.message) {
        const deployScriptOutput = await handleDeployment(step.message, operatingSystem, keepDeployments, logger);
        if (!deployScriptOutput.succeeded) {
          isFailed = true;
          break;
        }
      } else {
        console.log('Send server api call to execute step with id ' + step.id);
      }
    }
    console.log('sending status', isFailed ? 'error' : 'success');
    socket.emit(SOCKET_EVENTS.VERSION_STATUS, {
      status: isFailed ? DEPLOYMENT_STATUS.ERROR : DEPLOYMENT_STATUS.SUCCESS,
      deploymentId: data.id,
    });

    processQueue();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    socket.emit(SOCKET_EVENTS.VERSION_STATUS, {
      status: DEPLOYMENT_STATUS.ERROR,
      deploymentId: data.id,
      output: errorMessage,
    });

    processQueue();
  }
}
