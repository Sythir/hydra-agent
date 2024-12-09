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
console.log(process.env.AGENT_KEY, process.env.HOST);
// Handle connection
socket.on("connect", () => {
  console.log("Connected to the Socket.IO server");
});

// Handle disconnection
socket.on("disconnect", () => {
  console.log("Disconnected from the server");
});

socket.on(`deploy-version-${token}`, async (data: Data) => {
  socket.emit(`version-status`, { status: "in-progress", appCode: data.application.code, projectCode: data.project.code, envId: data.environment.id });
  await handleDeployMessage(data, operatingSystem);

  setTimeout(() => {
    socket.emit(`version-status`, { status: "success", appCode: data.application.code, projectCode: data.project.code, envId: data.environment.id });

  }, 5000)
});

// handle version status this was an old variant
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
