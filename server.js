const io = require('socket.io-client');
const fs = require('fs');
const { exec } = require('child_process');

const token = process.env.AGENT_KEY;
const socket = io(process.env.HOST, {
    query: { token }
});
console.log(process.env.AGENT_KEY, process.env.HOST)
// Handle connection
socket.on('connect', () => {
    console.log('Connected to the Socket.IO server');
});

// Handle disconnection
socket.on('disconnect', () => {
    console.log('Disconnected from the server');
});


// handle version status
socket.on(`deploy-version-${token}`, (data) => {
    fs.writeFile('script.js', data.script, (err) => {
        if (err) throw err;
        console.log('script.js created.');

        // Step 2: Run the script
        exec('node script.js', (err, stdout, stderr) => {
            if (err) {
                console.error(`Execution error: ${err}`);
                return;
            }

            console.log(`Output from script.js: ${stdout}`);

            // Step 3: Remove the script file
            fs.unlink('script.js', (err) => {
                if (err) throw err;
                console.log('script.js removed.');
            });
        });
    });
});
