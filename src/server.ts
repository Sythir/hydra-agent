// const io = require("socket.io-client");
// const fs = require("fs");
// const { exec } = require("child_process");
import io from "socket.io-client";
import os from "os";
import { handleDeployMessage } from "./handleDeployMessage";
import { Data } from "./types/data";

const token = process.env.AGENT_KEY;
const socket = io(process.env.HOST, {
  query: { token },
});
const platform = os.platform();
const operatingSystem = platform === "win32" ? "windows" : "linux";
// Handle connection
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
  console.log(queue);
  socket.emit(`version-status`, {
    status: "pending",
    appCode: data.application.code,
    projectCode: data.project.code,
    envId: data.environment.id,
  });
  // Process the queue if not already processing
  if (!isProcessing) {
    processQueue();
  }
});

async function processQueue() {
  if (queue.length === 0) {
    isProcessing = false; // No more tasks to process
    return;
  }

  isProcessing = true;
  const data = queue.shift(); // Get the first item in the queue

  try {
    // Emit 'in-progress' status
    socket.emit(`version-status`, {
      status: "in-progress",
      appCode: data.application.code,
      projectCode: data.project.code,
      envId: data.environment.id,
    });

    // Process the deployment
    await handleDeployMessage(data, operatingSystem);

    // Simulate processing delay (if needed)
    setTimeout(() => {
      socket.emit(`version-status`, {
        status: "success",
        appCode: data.application.code,
        projectCode: data.project.code,
        envId: data.environment.id,
      });

      // Continue with the next task in the queue
      processQueue();
    }, 5000);
  } catch (error) {
    socket.emit(`version-status`, {
      status: "error",
      appCode: data.application.code,
      projectCode: data.project.code,
      envId: data.environment.id,
    });

    // Continue with the next task in the queue
    processQueue();
  }
}// handle version status this was an old variant
// socket.on(`deploy-version-${token}`, (data: any) => {
//   fs.writeFile("script.js", data.script, (err: any) => {
//     if (err) throw err;
//     console.log("script.js created.");

//     // Step 2: Run the script
//     exec("node script.js", (err: any, stdout: any) => {
//       if (err) {
//         console.error(`Execution error: ${err}`);
//         return;
//       }

//       console.log(`Output from script.js: ${stdout}`);

//       // Step 3: Remove the script file
//       fs.unlink("script.js", (err: any) => {
//         if (err) throw err;
//         console.log("script.js removed.");
//       });
//     });
//   });
// });
