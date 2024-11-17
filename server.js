const io = require('socket.io-client');

const token = process.env.AGENT_KEY;
const socket = io(process.env.HOST, {
    query: {token}
});

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
    console.log('version-status', data);
});
