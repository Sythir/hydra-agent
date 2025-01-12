import io from "socket.io-client";
import os from "os";
import { handleDeployMessage } from "./handleDeployMessage";

const token = process.env.AGENT_KEY;
const socket = io(process.env.HOST, {
  query: { token, type: 'agent' },
});
const platform = os.platform();
const operatingSystem = platform === "win32" ? "windows" : "linux";

socket.on("connect", () => {
  console.log("Connected to the Socket.IO server");
  socket.emit('register-key');
});

// Handle disconnection
socket.on("disconnect", () => {
  console.log("Disconnected from the server");
});


const queue: any[] = [];
let isProcessing = false;
let processingItem: any;

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
    return
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

  console.log("processing", data);
  processingItem = data;
  try {
    socket.emit(`version-status`, {
      status: "in-progress",
      appCode: data.application.code,
      projectCode: data.project.code,
      envId: data.environment.id,
    });

    const deployScriptOutput = await handleDeployMessage(data, operatingSystem);

    socket.emit(`version-status`, {
      status: "success",
      appCode: data.application.code,
      projectCode: data.project.code,
      envId: data.environment.id,
      output: deployScriptOutput,
    });

    processQueue();
  } catch (error: any) {
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
