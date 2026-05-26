
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

let rooms = {};

io.on('connection', (socket) => {
  console.log('user connected', socket.id);

  socket.on('join-table', ({ tableId, username }) => {
    socket.join(tableId);

    if (!rooms[tableId]) rooms[tableId] = [];

    rooms[tableId].push({
      id: socket.id,
      username
    });

    io.to(tableId).emit('players-update', rooms[tableId]);
  });

  socket.on('voice-signal', (data) => {
    socket.to(data.tableId).emit('voice-signal', data);
  });

  socket.on('disconnect', () => {
    for (const tableId in rooms) {
      rooms[tableId] = rooms[tableId].filter(
        p => p.id !== socket.id
      );
      io.to(tableId).emit('players-update', rooms[tableId]);
    }
  });
});

server.listen(4000, () => {
  console.log('Server running on port 4000');
});
