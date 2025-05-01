import { io } from 'socket.io-client';
import os from 'os';
import { handleDeployMessage } from './handleDeployMessage';

const args = process.argv.slice(2);

const tokenIndex = args.indexOf('--agent-key');
const token = process.env.AGENT_KEY || args[tokenIndex + 1];

if (!token) {
  throw new Error(
    'Agent key is not set. Use the AGENT_KEY environment variable or pass it as an argument(e.g. --agent-key <agent-key>)',
  );
}

const keepDeploymentsIndex = args.indexOf('--keep-deployments');
let keepDeployments = 5;

if (keepDeploymentsIndex !== -1) {
  const parsedValue = parseInt(args[keepDeploymentsIndex + 1], 10);
  if (!isNaN(parsedValue) && parsedValue > 0) {
    keepDeployments = parsedValue;
  } else {
    console.warn('Invalid value for --keep-deployments. Using default value of 5.');
  }
}

console.log(`Agent Key: ${token.slice(0, 5)}... (partially shown)`);
console.log(`Keep Deployments: ${keepDeployments}`);
const host = process.env.HOST || 'https://hydra.sythir.com/api/deployment-gateway';

const socket = io(host, {
  query: { token, type: 'agent' },
});

const platform = os.platform();
const operatingSystem = platform === 'win32' ? 'windows' : 'linux';

socket.on('connect', () => {
  console.log('Connected to the Socket.IO server');
  socket.emit('register-key');
});

// Handle disconnection
socket.on('disconnect', () => {
  console.log('Disconnected from the server');
});

const queue: Message[] = [];
let isProcessing = false;
let processingItem: any;

export interface AgentDeployMessageDto {
  deployment: { id: string };
  script: string;
  application: { id: string; name: string; code: string; appId: string };
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

socket.on(`deploy-version-${token}`, async (data: Message) => {

  console.log('rorororo new deployment', data.id, queue.length)
  const queueIndex = queue.findIndex(
    (item) =>
      item.id === data.id,
  );

  console.log('roproro', queueIndex, isProcessing)

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

socket.on(`inprogress-deployments-${token}`, async (data: AgentDeployMessageDto) => {
  const { application, project, environment, version } = data;
  if (!processingItem) {
    socket.emit(`version-status`, {
      status: 'error',
      deploymentId: data.deployment.id,
    });
    return;
  }
  if (
    application.id === processingItem.application.id &&
    project.id === processingItem.project.id &&
    environment.id === processingItem.environment.id &&
    version.id === processingItem.version.id
  ) {
    return;
  }

  socket.emit(`version-status`, {
    status: 'error',
    deploymentId: data.deployment.id,
  });
});

async function processQueue() {
  console.log('processQueue', queue)
  if (queue.length === 0) {
    isProcessing = false;
    processingItem = null;
    return;
  }

  isProcessing = true;
  const data = queue.shift()!;
  console.log('processing', data);
  processingItem = data;
  try {
    socket.emit(`version-status`, {
      status: 'in-progress',
      deploymentId: data.id,
    });

    const output: any[] = [];
    for (const step of data.steps) {
      console.log('processing step', step);
      if ((step.type === 'script' || step.type === 'derived') && step.message) {
        const deployScriptOutput = await handleDeployMessage(step.message, operatingSystem, keepDeployments);
        output.push(deployScriptOutput);
      } else {
        console.log('Send server api call to execute step with id ' + step.id)
      }

    }
    console.log('output', output)
    const allSucceeded = output.every((item) => item.succeeded);
    console.log('allSucceeded', allSucceeded)
    console.log('rororor data', data)
    //const deployScriptOutput = await handleDeployMessage(processingItem, operatingSystem, keepDeployments);

    socket.emit(`version-status`, {
      status: allSucceeded ? 'success' : 'error',
      deploymentId: data.id,
      output: output.map(x => x.output).join('\n'),
    });

    processQueue();
  } catch (error: any) {
    console.log('rororor error', error);
    socket.emit(`version-status`, {
      status: 'error',
      deploymentId: data.id,
      output: error.message,
    });

    processQueue();
  }
}
