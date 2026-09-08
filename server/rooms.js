const TetrisEngine = require('../shared/tetrisEngine');
const PuyoEngine = require('../shared/puyoEngine');
const { createCPU, DIFFICULTIES } = require('../shared/cpu');

const TICK_MS = 50;
const MAX_PLAYERS_CAP = 4;

function makeEngine(mode, seed) {
  return mode === 'puyo' ? new PuyoEngine({ seed }) : new TetrisEngine({ seed });
}

function randomId() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

class Player {
  constructor(socketId, name, isCPU, difficulty) {
    this.id = socketId; // socket id, or 'cpu-<n>' for CPU
    this.name = name;
    this.isCPU = !!isCPU;
    this.difficulty = difficulty || 'normal';
    this.mode = 'tetris';
    this.ready = !!isCPU;
    this.engine = null;
    this.cpu = null;
    this.finished = false;
    this.place = null; // finishing place once game ends
    this.focusTarget = null;
    this.manualTarget = null; // explicit attack-target choice via ZL/ZR, null = auto
    this.disconnected = false;
  }
}

class Room {
  constructor(id, maxPlayers) {
    this.id = id;
    this.maxPlayers = Math.min(Math.max(maxPlayers || 4, 2), MAX_PLAYERS_CAP);
    this.players = new Map(); // id -> Player
    this.spectators = new Map(); // socketId -> {id,name}
    this.hostId = null;
    this.status = 'lobby'; // lobby | playing | results
    this.cpuCounter = 0;
    this.createdAt = Date.now();
  }

  get playerList() { return Array.from(this.players.values()); }

  isFull() { return this.playerList.filter((p) => true).length >= this.maxPlayers; }

  addPlayer(socketId, name) {
    if (this.status !== 'lobby') return { error: 'IN_PROGRESS' };
    if (this.isFull()) return { error: 'ROOM_FULL' };
    const p = new Player(socketId, name, false);
    if (!this.hostId) this.hostId = socketId;
    this.players.set(socketId, p);
    return { player: p };
  }

  addSpectator(socketId, name) {
    this.spectators.set(socketId, { id: socketId, name });
  }

  addCPU(difficulty) {
    if (this.status !== 'lobby') return { error: 'IN_PROGRESS' };
    if (this.isFull()) return { error: 'ROOM_FULL' };
    this.cpuCounter++;
    const id = 'cpu-' + this.cpuCounter + '-' + Date.now().toString(36).slice(-4);
    const names = ['CPUたろう', 'CPUはなこ', 'CPUジロー', 'CPUみさき', 'CPUれん', 'CPUゆい'];
    const name = names[Math.floor(Math.random() * names.length)];
    const p = new Player(id, name, true, DIFFICULTIES.includes(difficulty) ? difficulty : 'normal');
    if (!this.hostId) this.hostId = id;
    this.players.set(id, p);
    return { player: p };
  }

  removeParticipant(socketId) {
    let removed = false;
    if (this.players.has(socketId)) {
      const p = this.players.get(socketId);
      if (this.status === 'playing') {
        p.disconnected = true;
        if (p.engine && !p.engine.gameOver) {
          p.engine.gameOver = true;
          if (!p.finished) { p.finished = true; p.place = this.placeCounter--; }
          this.checkMatchEnd();
        }
      } else {
        this.players.delete(socketId);
      }
      removed = true;
      if (this.hostId === socketId) {
        const remaining = this.playerList.filter((pp) => !pp.isCPU && !pp.disconnected);
        const anyRemaining = this.playerList.filter((pp) => !pp.disconnected);
        this.hostId = remaining.length ? remaining[0].id : (anyRemaining.length ? anyRemaining[0].id : null);
      }
    }
    if (this.spectators.has(socketId)) {
      this.spectators.delete(socketId);
      removed = true;
    }
    return removed;
  }

  isEmpty() { return this.spectators.size === 0 && this.playerList.every((p) => p.isCPU || p.disconnected); }

  humanPlayerCount() { return this.playerList.filter((p) => !p.isCPU).length; }

  allReady() {
    const list = this.playerList;
    if (list.length < 1) return false;
    return list.every((p) => p.ready);
  }

  canStart() {
    return this.status === 'lobby' && this.playerList.length >= 1 && this.allReady() && this.humanPlayerCount() >= 1;
  }

  start() {
    if (!this.canStart()) return false;
    this.status = 'playing';
    const seed = Date.now();
    for (const p of this.playerList) {
      p.engine = makeEngine(p.mode, seed + Math.floor(Math.random() * 1000));
      p.finished = false;
      p.place = null;
      p.focusTarget = null;
      p.manualTarget = null;
      if (p.isCPU) {
        p.cpu = createCPU(p.mode, p.engine, p.difficulty);
      } else {
        p.cpu = null;
      }
    }
    this.placeCounter = this.playerList.length;
    return true;
  }

  resetToLobby() {
    this.status = 'lobby';
    for (const id of Array.from(this.players.keys())) {
      const p = this.players.get(id);
      if (p.disconnected) { this.players.delete(id); continue; }
      p.ready = p.isCPU; // CPUs stay auto-ready, humans must re-ready
      p.engine = null;
      p.cpu = null;
      p.finished = false;
      p.manualTarget = null;
      p.focusTarget = null;
    }
  }

  cycleTarget(socketId, direction) {
    if (this.status !== 'playing') return;
    const me = this.players.get(socketId);
    if (!me || !me.engine || me.engine.gameOver) return;
    const opponents = this.playerList.filter((p) => p.id !== socketId && p.engine);
    if (opponents.length === 0) return;
    const ids = [null, ...opponents.map((p) => p.id)]; // null = auto (revenge/random)
    let idx = ids.indexOf(me.manualTarget);
    if (idx === -1) idx = 0;
    idx = (idx + (direction === 'prev' ? -1 : 1) + ids.length) % ids.length;
    me.manualTarget = ids[idx];
  }

  pickTarget(fromPlayer) {
    const alive = this.playerList.filter((p) => p.id !== fromPlayer.id && p.engine && !p.engine.gameOver);
    if (alive.length === 0) return null;
    if (fromPlayer.manualTarget) {
      const t = alive.find((p) => p.id === fromPlayer.manualTarget);
      if (t) return t;
    }
    if (fromPlayer.focusTarget) {
      const t = alive.find((p) => p.id === fromPlayer.focusTarget);
      if (t) return t;
    }
    return alive[Math.floor(Math.random() * alive.length)];
  }

  handleLockEvent(player, events) {
    if (!events) return;
    if (events.garbageOut > 0) {
      const target = this.pickTarget(player);
      if (target) {
        target.engine.receiveGarbage(events.garbageOut);
        target.focusTarget = player.id;
      }
    }
    if (events.gameOver && !player.finished) {
      player.finished = true;
      player.place = this.placeCounter--;
    }
  }

  aliveCount() {
    return this.playerList.filter((p) => p.engine && !p.engine.gameOver).length;
  }

  checkMatchEnd() {
    if (this.status !== 'playing') return false;
    const totalPlayers = this.playerList.length;
    if (totalPlayers === 1) {
      const solo = this.playerList[0];
      if (solo.engine && solo.engine.gameOver) {
        if (!solo.finished) { solo.finished = true; solo.place = 1; }
        this.status = 'results';
        return true;
      }
      return false;
    }
    const alive = this.playerList.filter((p) => p.engine && !p.engine.gameOver);
    if (alive.length <= 1) {
      for (const p of alive) { if (!p.finished) { p.finished = true; p.place = 1; } }
      this.status = 'results';
      return true;
    }
    return false;
  }

  tick(dtMs) {
    if (this.status !== 'playing') return [];
    const lockEvents = [];
    for (const p of this.playerList) {
      if (!p.engine || p.engine.gameOver) continue;
      if (p.isCPU && p.cpu) p.cpu.update(dtMs);
      const evt = p.engine.tick(dtMs);
      if (evt) { this.handleLockEvent(p, evt); lockEvents.push({ playerId: p.id, evt }); }
    }
    this.checkMatchEnd();
    return lockEvents;
  }

  applyInput(socketId, action) {
    const p = this.players.get(socketId);
    if (!p || !p.engine || this.status !== 'playing' || p.engine.gameOver) return;
    if (typeof p.engine[action] !== 'function') return;
    const evt = p.engine[action]();
    if (evt) {
      this.handleLockEvent(p, evt);
      this.checkMatchEnd();
    }
  }

  publicState() {
    return {
      id: this.id,
      status: this.status,
      maxPlayers: this.maxPlayers,
      hostId: this.hostId,
      players: this.playerList.map((p) => ({
        id: p.id, name: p.name, isCPU: p.isCPU, difficulty: p.difficulty,
        mode: p.mode, ready: p.ready, finished: p.finished, place: p.place,
      })),
      spectatorCount: this.spectators.size,
    };
  }

  gameStateFor() {
    return {
      id: this.id,
      status: this.status,
      players: this.playerList.map((p) => ({
        id: p.id,
        name: p.name,
        isCPU: p.isCPU,
        mode: p.mode,
        finished: p.finished,
        place: p.place,
        manualTarget: p.manualTarget,
        state: p.engine ? p.engine.getState() : null,
      })),
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.socketRoom = new Map(); // socketId -> roomId
  }

  createRoom(maxPlayers) {
    let id;
    let tries = 0;
    do {
      id = randomId();
      tries++;
    } while (this.rooms.has(id) && tries < 20000);
    const room = new Room(id, maxPlayers);
    this.rooms.set(id, room);
    return room;
  }

  get(roomId) { return this.rooms.get(roomId); }

  joinPlayer(roomId, socketId, name) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'NOT_FOUND' };
    const res = room.addPlayer(socketId, name);
    if (!res.error) this.socketRoom.set(socketId, roomId);
    return res.error ? res : { room };
  }

  joinSpectator(roomId, socketId, name) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'NOT_FOUND' };
    room.addSpectator(socketId, name);
    this.socketRoom.set(socketId, roomId);
    return { room };
  }

  leaveSocket(socketId) {
    const roomId = this.socketRoom.get(socketId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    this.socketRoom.delete(socketId);
    if (!room) return null;
    room.removeParticipant(socketId);
    if (room.isEmpty()) {
      this.rooms.delete(roomId);
      return { roomId, deleted: true };
    }
    return { roomId, room, deleted: false };
  }

  tickAll(dtMs) {
    const results = [];
    for (const room of this.rooms.values()) {
      if (room.status === 'playing') {
        room.tick(dtMs);
        results.push(room);
      }
    }
    return results;
  }
}

module.exports = { RoomManager, Room, Player, TICK_MS, MAX_PLAYERS_CAP, DIFFICULTIES };
