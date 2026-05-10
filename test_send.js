const io = require('socket.io-client');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('Connected. Sending user_command...');
    socket.emit('user_command', 'Test Mission');
});

socket.on('agent_message', (data) => {
    console.log('RECEIVED:', data);
});

socket.on('disconnect', () => {
    console.log('Disconnected');
});
