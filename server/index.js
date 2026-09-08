const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RoomManager, TICK_MS, MAX_PLAYERS_CAP, DIFFICULTIES } = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

const manager = new RoomManager();

function sanitizeName(name) {
  let n = (name || '').toString().trim();
  if (!n) n = 'プレイヤー';
  if (n.length > 10) n = n.slice(0, 10);
  return n;
}

function broadcastLobby(room) {
  if (!room) return;
  io.to(room.id).emit('roomUpdate', room.publicState());
}

io.on('connection', (socket) => {
  socket.data.name = 'プレイヤー';

  socket.on('setName', (name) => {
    socket.data.name = sanitizeName(name);
  });

  socket.on('createRoom', ({ name, maxPlayers, mode } = {}, cb) => {
    socket.data.name = sanitizeName(name || socket.data.name);
    const room = manager.createRoom(Math.min(maxPlayers || 4, MAX_PLAYERS_CAP));
    const res = manager.joinPlayer(room.id, socket.id, socket.data.name);
    if (res.error) { if (cb) cb({ error: res.error }); return; }
    const player = room.players.get(socket.id);
    if (mode === 'puyo' || mode === 'tetris') player.mode = mode;
    socket.join(room.id);
    if (cb) cb({ ok: true, roomId: room.id, difficulties: DIFFICULTIES });
    broadcastLobby(room);
  });

  socket.on('joinRoom', ({ roomId, name, asSpectator } = {}, cb) => {
    socket.data.name = sanitizeName(name || socket.data.name);
    roomId = (roomId || '').toString().trim();
    const room = manager.get(roomId);
    if (!room) { if (cb) cb({ error: 'NOT_FOUND' }); return; }
    if (asSpectator) {
      manager.joinSpectator(roomId, socket.id, socket.data.name);
      socket.join(roomId);
      if (cb) cb({ ok: true, roomId, spectator: true, difficulties: DIFFICULTIES });
      broadcastLobby(room);
      if (room.status === 'playing' || room.status === 'results') socket.emit('gameState', room.gameStateFor());
      return;
    }
    const res = manager.joinPlayer(roomId, socket.id, socket.data.name);
    if (res.error) { if (cb) cb({ error: res.error }); return; }
    socket.join(roomId);
    if (cb) cb({ ok: true, roomId, spectator: false, difficulties: DIFFICULTIES });
    broadcastLobby(room);
  });

  socket.on('leaveRoom', () => {
    const result = manager.leaveSocket(socket.id);
    if (result) {
      socket.leave(result.roomId);
      if (!result.deleted) broadcastLobby(result.room);
      else io.to(result.roomId).emit('roomClosed');
    }
  });

  socket.on('setMode', (mode) => {
    const roomId = manager.socketRoom.get(socket.id);
    const room = manager.get(roomId);
    if (!room || room.status !== 'lobby') return;
    const p = room.players.get(socket.id);
    if (!p || (mode !== 'tetris' && mode !== 'puyo')) return;
    p.mode = mode;
    broadcastLobby(room);
  });

  socket.on('setReady', (ready) => {
    const roomId = manager.socketRoom.get(socket.id);
    const room = manager.get(roomId);
    if (!room || room.status !== 'lobby') return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.ready = !!ready;
    broadcastLobby(room);
  });

  socket.on('addCPU', (difficulty) => {
    const roomId = manager.socketRoom.get(socket.id);
    const room = manager.get(roomId);
    if (!room || room.status !== 'lobby' || room.hostId !== socket.id) return;
    room.addCPU(difficulty);
    broadcastLobby(room);
  });

  socket.on('removeCPU', (cpuId) => {
    const roomId = manager.socketRoom.get(socket.id);
    const room = manager.get(roomId);
    if (!room || room.status !== 'lobby' || room.hostId !== socket.id) return;
    if (room.players.has(cpuId) && room.players.get(cpuId).isCPU) {
      room.players.delete(cpuId);
    }
    broadcastLobby(room);
  });

  socket.on('startGame', () => {
    const roomId = manager.socketRoom.get(socket.id);
    const room = manager.get(roomId);
    if (!room || room.hostId !== socket.id) return;
    if (room.start()) {
      io.to(room.id).emit('gameStarted');
      broadcastLobby(room);
    } else {
      socket.emit('errorMsg', 'まだ準備が完了していません');
    }
  });

  socket.on('backToLobby', () => {
    const roomId = manager.socketRoom.get(socket.id);
    const room = manager.get(roomId);
    if (!room || room.hostId !== socket.id) return;
    room.resetToLobby();
    io.to(room.id).emit('lobbyReset');
    broadcastLobby(room);
  });

  socket.on('input', (action) => {
    const roomId = manager.socketRoom.get(socket.id);
    const room = manager.get(roomId);
    if (!room) return;
    room.applyInput(socket.id, action);
  });

  socket.on('disconnect', () => {
    const result = manager.leaveSocket(socket.id);
    if (result && !result.deleted) broadcastLobby(result.room);
  });
});

setInterval(() => {
  const activeRooms = manager.tickAll(TICK_MS);
  for (const room of activeRooms) {
    io.to(room.id).emit('gameState', room.gameStateFor());
    if (room.status === 'results') {
      // one final broadcast happened above; announce once more for clarity next tick will just repeat harmlessly
    }
  }
}, TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Puzzle Battle Online server listening on http://localhost:${PORT}`);
});
