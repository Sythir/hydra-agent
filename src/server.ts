import io from "socket.io-client";
import os from "os";
import { handleDeployMessage } from "./handleDeployMessage";

const token = process.env.AGENT_KEY;
const socket = io(process.env.HOST, {
  query: { token },
});
const platform = os.platform();
const operatingSystem = platform === "win32" ? "windows" : "linux";

socket.on("connect", () => {
  console.log("Connected to the Socket.IO server");
});

// Handle disconnection
socket.on("disconnect", () => {
  console.log("Disconnected from the server");
});

const queue: any[] = [];
let isProcessing = false;

socket.on(`deploy-version-${token}`, async (data) => {
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
});

async function processQueue() {
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

    await handleDeployMessage(data, operatingSystem);

    socket.emit(`version-status`, {
      status: "success",
      appCode: data.application.code,
      projectCode: data.project.code,
      envId: data.environment.id,
    });

    processQueue();
  } catch (error) {
    socket.emit(`version-status`, {
      status: "error",
      appCode: data.application.code,
      projectCode: data.project.code,
      envId: data.environment.id,
    });

    processQueue();
  }
}
