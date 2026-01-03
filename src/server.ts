import { io } from 'socket.io-client';
import os from 'os';
import { handleDeployment } from './handleDeployment';
import { createLogger } from './utils/logMessage';
import { loadEnvironmentConfig, parseKeepDeployments } from './config/environment';
import { DEPLOYMENT_STATUS, SOCKET_EVENTS } from './config/constants';

const args = process.argv.slice(2);
const config = loadEnvironmentConfig(args);
const keepDeployments = parseKeepDeployments(args);

console.log(`Agent Key: ${config.agentKey.slice(0, 5)}... (partially shown)`);
console.log(`Agent Version: ${config.agentVersion}`);
console.log(`Keep Deployments: ${keepDeployments}`);

const socket = io(config.host, {
  query: { token: config.agentKey, type: 'agent' },
});

const platform = os.platform();
const operatingSystem = platform === 'win32' ? 'windows' : 'linux';

socket.on(SOCKET_EVENTS.CONNECT, () => {
  console.log('Connected to the Socket.IO server');
  socket.emit(SOCKET_EVENTS.REGISTER_KEY, { version: config.agentVersion });
});

socket.on(SOCKET_EVENTS.DISCONNECT, () => {
  console.log('Disconnected from the server');
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
    appId: string,
    registry: {
      name: string;
      url: string;
      type: string;
    }
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
