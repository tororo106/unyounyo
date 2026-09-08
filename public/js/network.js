const Network = (() => {
  const socket = io({ transports: ['websocket', 'polling'] });
  const handlers = {};

  function on(event, cb) {
    if (!handlers[event]) {
      handlers[event] = [];
      socket.on(event, (...args) => handlers[event].forEach((h) => h(...args)));
    }
    handlers[event].push(cb);
  }

  return {
    socket,
    on,
    setName: (name) => socket.emit('setName', name),
    createRoom: (opts, cb) => socket.emit('createRoom', opts, cb),
    joinRoom: (opts, cb) => socket.emit('joinRoom', opts, cb),
    leaveRoom: () => socket.emit('leaveRoom'),
    setMode: (mode) => socket.emit('setMode', mode),
    setReady: (ready) => socket.emit('setReady', ready),
    addCPU: (difficulty, mode) => socket.emit('addCPU', { difficulty, mode }),
    removeCPU: (cpuId) => socket.emit('removeCPU', cpuId),
    startGame: () => socket.emit('startGame'),
    backToLobby: () => socket.emit('backToLobby'),
    sendInput: (action) => socket.emit('input', action),
    cycleTarget: (direction) => socket.emit('cycleTarget', direction),
  };
})();
