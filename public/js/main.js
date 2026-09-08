(() => {
  'use strict';

  // ---------------- state ----------------
  let currentRoomId = null;
  let isSpectator = false;
  let isHost = false;
  let joinIntent = 'play'; // 'play' | 'spectate'
  let latestRoomPublic = null;
  let capturingAction = null; // action id currently waiting for a keydown while rebinding

  // ---------------- helpers ----------------
  const $ = (id) => document.getElementById(id);

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  function showToast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.add('hidden'), ms || 2600);
  }

  function openModal(id) { $(id).classList.remove('hidden'); }
  function closeModal(id) { $(id).classList.add('hidden'); }

  const ERROR_MESSAGES = {
    NOT_FOUND: 'そのルームIDは見つかりませんでした',
    ROOM_FULL: 'このルームは満員です（観戦は入室できます）',
    IN_PROGRESS: 'このルームはすでに対戦中です',
  };

  // ---------------- name / settings ----------------
  function initNameAndSettings() {
    const s = Settings.load();
    if (!s.name) {
      openModal('modal-name');
    } else {
      $('home-name-input').value = s.name;
      Network.setName(s.name);
    }
    $('settings-name-input').value = s.name || '';
    buildBindingTables();
  }

  $('btn-name-first-confirm').addEventListener('click', () => {
    const v = $('name-first-input').value.trim();
    if (!v) { showToast('名前を入力してください'); return; }
    Settings.setName(v);
    $('home-name-input').value = Settings.current.name;
    $('settings-name-input').value = Settings.current.name;
    Network.setName(Settings.current.name);
    closeModal('modal-name');
  });

  $('home-name-input').addEventListener('change', (e) => {
    Settings.setName(e.target.value.trim());
    e.target.value = Settings.current.name;
    $('settings-name-input').value = Settings.current.name;
    Network.setName(Settings.current.name);
  });

  $('settings-name-input').addEventListener('change', (e) => {
    Settings.setName(e.target.value.trim());
    e.target.value = Settings.current.name;
    $('home-name-input').value = Settings.current.name;
    Network.setName(Settings.current.name);
  });

  $('btn-open-settings-home').addEventListener('click', () => openModal('modal-settings'));
  $('btn-close-settings').addEventListener('click', () => closeModal('modal-settings'));
  $('btn-menu-settings').addEventListener('click', () => openModal('modal-settings'));

  function keyLabel(k) {
    if (k === ' ') return 'Space';
    return k;
  }

  function buildBindingTables() {
    const kbTable = $('settings-keyboard-table');
    kbTable.innerHTML = '';
    ACTIONS.forEach((a) => {
      const row = document.createElement('div');
      row.className = 'bind-row';
      const label = document.createElement('span');
      label.className = 'bind-label';
      label.textContent = a.label;
      const btn = document.createElement('button');
      btn.className = 'bind-key-btn';
      btn.textContent = keyLabel(Settings.current.controls.keyboard[a.id] || '未設定');
      btn.addEventListener('click', () => startCapture(a.id, btn));
      row.appendChild(label); row.appendChild(btn);
      kbTable.appendChild(row);
    });

    const btnTable = $('settings-buttons-table');
    btnTable.innerHTML = '';
    BUTTON_SLOTS.forEach((slot) => {
      const row = document.createElement('div');
      row.className = 'bind-row';
      const label = document.createElement('span');
      label.className = 'bind-label';
      label.textContent = slot.label;
      const sel = document.createElement('select');
      sel.className = 'bind-select';
      const noneOpt = document.createElement('option');
      noneOpt.value = 'none'; noneOpt.textContent = '割り当てなし';
      sel.appendChild(noneOpt);
      ACTIONS.forEach((a) => {
        const opt = document.createElement('option');
        opt.value = a.id; opt.textContent = a.label;
        if (Settings.current.controls.buttons[slot.id] === a.id) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        Settings.current.controls.buttons[slot.id] = sel.value;
        Settings.save();
      });
      row.appendChild(label); row.appendChild(sel);
      btnTable.appendChild(row);
    });
  }

  function startCapture(actionId, btnEl) {
    if (capturingAction) return;
    capturingAction = actionId;
    document.body.classList.add('capturing-key');
    btnEl.classList.add('capturing');
    btnEl.textContent = 'キーを押してください…';
    const onKey = (e) => {
      e.preventDefault();
      Settings.current.controls.keyboard[actionId] = e.key;
      Settings.save();
      btnEl.textContent = keyLabel(e.key);
      btnEl.classList.remove('capturing');
      document.body.classList.remove('capturing-key');
      capturingAction = null;
      window.removeEventListener('keydown', onKey, true);
    };
    window.addEventListener('keydown', onKey, true);
  }

  $('btn-export-config').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Settings.current.controls, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'puzzle-battle-controls.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('btn-import-config').addEventListener('click', () => $('input-import-config').click());
  $('input-import-config').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        Settings.current.controls = {
          keyboard: Object.assign({}, DEFAULT_CONTROLS.keyboard, parsed.keyboard),
          buttons: Object.assign({}, DEFAULT_CONTROLS.buttons, parsed.buttons),
        };
        Settings.save();
        buildBindingTables();
        showToast('操作設定を読み込みました');
      } catch (err) {
        showToast('ファイルの読み込みに失敗しました');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('btn-reset-config').addEventListener('click', () => {
    Settings.resetControls();
    buildBindingTables();
    showToast('初期設定に戻しました');
  });

  // ---------------- HOME ----------------
  $('btn-mode-play').addEventListener('click', () => {
    joinIntent = 'play';
    $('btn-mode-play').classList.add('active');
    $('btn-mode-spectate').classList.remove('active');
    $('panel-play-join').classList.remove('hidden');
    $('panel-spectate-join').classList.add('hidden');
  });
  $('btn-mode-spectate').addEventListener('click', () => {
    joinIntent = 'spectate';
    $('btn-mode-spectate').classList.add('active');
    $('btn-mode-play').classList.remove('active');
    $('panel-spectate-join').classList.remove('hidden');
    $('panel-play-join').classList.add('hidden');
  });

  ['input-room-code', 'input-spectate-code'].forEach((id) => {
    $(id).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
  });

  $('btn-open-create').addEventListener('click', () => openModal('modal-create'));
  $('btn-create-cancel').addEventListener('click', () => closeModal('modal-create'));

  let createMode = 'tetris';
  $('create-mode-tetris').addEventListener('click', () => setCreateMode('tetris'));
  $('create-mode-puyo').addEventListener('click', () => setCreateMode('puyo'));
  function setCreateMode(m) {
    createMode = m;
    $('create-mode-tetris').classList.toggle('active', m === 'tetris');
    $('create-mode-puyo').classList.toggle('active', m === 'puyo');
  }

  $('btn-create-confirm').addEventListener('click', () => {
    const maxPlayers = parseInt($('create-max-players').value, 10);
    Network.createRoom({ name: Settings.current.name, maxPlayers, mode: createMode }, (res) => {
      if (res.error) { showToast(ERROR_MESSAGES[res.error] || 'ルーム作成に失敗しました'); return; }
      closeModal('modal-create');
      enterLobby(res.roomId, false);
    });
  });

  $('btn-join-play').addEventListener('click', () => {
    const code = $('input-room-code').value.trim();
    if (code.length !== 4) { showToast('4桁のルームIDを入力してください'); return; }
    Network.joinRoom({ roomId: code, name: Settings.current.name, asSpectator: false }, (res) => {
      if (res.error) { showToast(ERROR_MESSAGES[res.error] || '参加に失敗しました'); return; }
      enterLobby(code, false);
    });
  });

  $('btn-join-spectate').addEventListener('click', () => {
    const code = $('input-spectate-code').value.trim();
    if (code.length !== 4) { showToast('4桁のルームIDを入力してください'); return; }
    Network.joinRoom({ roomId: code, name: Settings.current.name, asSpectator: true }, (res) => {
      if (res.error) { showToast(ERROR_MESSAGES[res.error] || '観戦に失敗しました'); return; }
      enterLobby(code, true);
    });
  });

  function enterLobby(roomId, asSpectator) {
    currentRoomId = roomId;
    isSpectator = asSpectator;
    $('lobby-room-id').textContent = roomId;
    $('game-room-id-label').textContent = roomId;
    $('lobby-spectate-note').classList.toggle('hidden', !asSpectator);
    $('lobby-my-controls').classList.toggle('hidden', asSpectator);
    showScreen('screen-lobby');
  }

  $('lobby-copy-id').addEventListener('click', () => {
    if (!currentRoomId) return;
    navigator.clipboard && navigator.clipboard.writeText(currentRoomId).then(() => showToast('ルームIDをコピーしました'));
  });

  $('btn-leave-lobby').addEventListener('click', leaveToHome);
  $('btn-menu-leave').addEventListener('click', leaveToHome);

  function leaveToHome() {
    Network.leaveRoom();
    currentRoomId = null;
    $('overlay-menu').classList.add('hidden');
    $('overlay-results').classList.add('hidden');
    showScreen('screen-home');
  }

  // ---------------- LOBBY rendering ----------------
  let myMode = 'tetris';
  let myReady = false;

  $('my-mode-tetris').addEventListener('click', () => setMyMode('tetris'));
  $('my-mode-puyo').addEventListener('click', () => setMyMode('puyo'));
  function setMyMode(m) {
    myMode = m;
    $('my-mode-tetris').classList.toggle('active', m === 'tetris');
    $('my-mode-puyo').classList.toggle('active', m === 'puyo');
    Network.setMode(m);
  }

  $('btn-ready-toggle').addEventListener('click', () => {
    myReady = !myReady;
    Network.setReady(myReady);
  });

  $('btn-add-cpu').addEventListener('click', () => {
    Network.addCPU($('lobby-add-cpu-difficulty').value);
  });

  $('btn-start-game').addEventListener('click', () => Network.startGame());

  const PLAYER_COLOR_CLASS = ['p1', 'p2', 'p3', 'p4'];

  function renderLobby(state) {
    latestRoomPublic = state;
    isHost = state.hostId === Network.socket.id;
    $('lobby-spectator-count').textContent = state.spectatorCount;

    const container = $('lobby-players');
    container.innerHTML = '';
    state.players.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'player-card ' + PLAYER_COLOR_CLASS[idx % 4];
      const mine = p.id === Network.socket.id;
      if (mine) card.classList.add('me');
      const modeLabel = p.mode === 'puyo' ? 'パズルモード' : 'ブロックモード';
      card.innerHTML = `
        <div class="pname">${escapeHtml(p.name)} ${p.isCPU ? `<span class="ptag">CPU ${diffLabel(p.difficulty)}</span>` : ''}</div>
        <div class="pmode">${modeLabel}</div>
        <div class="pready ${p.ready ? 'ok' : 'wait'}">${p.ready ? '準備OK' : '準備中…'}</div>
      `;
      if (p.isCPU && isHost) {
        const rm = document.createElement('button');
        rm.className = 'remove-cpu';
        rm.textContent = '✕';
        rm.title = 'CPUを外す';
        rm.addEventListener('click', () => Network.removeCPU(p.id));
        card.appendChild(rm);
      }
      container.appendChild(card);
      if (mine) { myMode = p.mode; myReady = p.ready; setMyMode(p.mode); $('btn-ready-toggle').textContent = p.ready ? '準備をキャンセル' : '準備OK！'; }
    });
    for (let i = state.players.length; i < state.maxPlayers; i++) {
      const empty = document.createElement('div');
      empty.className = 'player-card empty-slot';
      empty.textContent = '空き枠';
      container.appendChild(empty);
    }

    $('lobby-host-controls').classList.toggle('hidden', isSpectator || !isHost);
    $('lobby-my-controls').classList.toggle('hidden', isSpectator);
    const canAddCPU = state.players.length < state.maxPlayers;
    $('btn-add-cpu').disabled = !canAddCPU;

    const allReady = state.players.length > 0 && state.players.every((p) => p.ready) && state.players.some((p) => !p.isCPU);
    $('btn-start-game').disabled = !allReady;
    $('lobby-status-msg').textContent = state.status === 'playing' ? '対戦が進行中です…' : (allReady ? '対戦を開始できます！' : '全員が準備OKになるとホストが対戦を開始できます');

    if (state.status === 'playing' && document.getElementById('screen-lobby').classList.contains('active')) {
      // joined mid-game (e.g. late spectator) — jump straight to game view
      enterGameScreen();
    }
  }

  function diffLabel(d) {
    return { easy: 'よわい', normal: 'ふつう', hard: 'つよい', expert: '最強' }[d] || 'ふつう';
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  Network.on('roomUpdate', renderLobby);
  Network.on('errorMsg', (msg) => showToast(msg));
  Network.on('roomClosed', () => { showToast('ルームが解散されました'); leaveToHome(); });
  Network.on('gameStarted', () => enterGameScreen());
  Network.on('lobbyReset', () => {
    $('overlay-results').classList.add('hidden');
    showScreen('screen-lobby');
  });

  // ---------------- GAME ----------------
  let controllerInited = false;
  let rafId = null;
  let lastState = null;

  function enterGameScreen() {
    document.body.classList.toggle('is-spectator', isSpectator);
    $('game-main').classList.toggle('hidden', isSpectator);
    $('spectator-grid').classList.toggle('hidden', !isSpectator);
    $('overlay-results').classList.add('hidden');
    $('overlay-menu').classList.add('hidden');
    showScreen('screen-game');
    if (!controllerInited) {
      Controller.init($('vc-left'), $('vc-right'), handleAction);
      controllerInited = true;
    }
    if (!rafId) loop();
  }

  function handleAction(action) {
    if (action === 'pause') { toggleMenu(true); return; }
    if (isSpectator) return;
    Network.sendInput(action);
  }

  function toggleMenu(show) {
    $('overlay-menu').classList.toggle('hidden', !show);
  }
  $('btn-menu').addEventListener('click', () => toggleMenu(true));
  $('btn-menu-resume').addEventListener('click', () => toggleMenu(false));

  function loop() {
    Controller.pollGamepad();
    rafId = requestAnimationFrame(loop);
  }

  const mainCanvas = () => $('main-canvas');

  Network.on('gameState', (payload) => {
    lastState = payload;
    if (payload.status === 'results') { renderResults(payload); return; }
    if (isSpectator) renderSpectatorView(payload);
    else renderMyView(payload);
  });

  function renderMyView(payload) {
    const me = payload.players.find((p) => p.id === Network.socket.id);
    const others = payload.players.filter((p) => p.id !== Network.socket.id);

    if (me && me.state) {
      Renderer.drawBoard(mainCanvas(), me.state, {});
      Renderer.renderNextHold($('next-box'), $('hold-box'), me.state);
      $('score-label').textContent = me.state.score;
      if (me.state.mode === 'tetris') {
        $('level-title').textContent = 'レベル';
        $('level-label').textContent = me.state.level;
      } else {
        $('level-title').textContent = '連鎖';
        $('level-label').textContent = me.state.chain || 0;
      }
      const maxGarbage = 24;
      const pct = Math.min(100, Math.round((me.state.pendingGarbage / maxGarbage) * 100));
      $('garbage-fill').style.height = pct + '%';
    }

    const row = $('opponents-row');
    row.innerHTML = '';
    others.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'opp-card' + (p.finished ? ' finished' : '');
      const canvas = document.createElement('canvas');
      canvas.width = 84; canvas.height = 84;
      card.appendChild(canvas);
      const name = document.createElement('div');
      name.className = 'opp-name';
      name.textContent = p.name + (p.isCPU ? '(CPU)' : '');
      card.appendChild(name);
      if (p.finished && p.place) {
        const place = document.createElement('div');
        place.className = 'opp-place';
        place.textContent = p.place + '位脱落';
        card.appendChild(place);
      }
      row.appendChild(card);
      if (p.state) Renderer.drawBoard(canvas, p.state, { hideGhost: true });
    });
  }

  function renderSpectatorView(payload) {
    const grid = $('spectator-grid');
    let changed = grid.children.length !== payload.players.length;
    if (changed) {
      grid.innerHTML = '';
      payload.players.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'spec-card';
        card.dataset.pid = p.id;
        const canvas = document.createElement('canvas');
        canvas.width = 150; canvas.height = 220;
        card.appendChild(canvas);
        const name = document.createElement('div');
        name.className = 'spec-name';
        name.textContent = p.name + (p.isCPU ? '(CPU)' : '');
        card.appendChild(name);
        const mode = document.createElement('div');
        mode.className = 'spec-mode';
        mode.textContent = p.mode === 'puyo' ? 'パズルモード' : 'ブロックモード';
        card.appendChild(mode);
        grid.appendChild(card);
      });
    }
    payload.players.forEach((p) => {
      const card = grid.querySelector(`[data-pid="${CSS.escape(p.id)}"]`);
      if (!card) return;
      card.classList.toggle('finished', !!p.finished);
      if (p.state) Renderer.drawBoard(card.querySelector('canvas'), p.state, {});
    });
  }

  function renderResults(payload) {
    showScreen('screen-game');
    $('overlay-menu').classList.add('hidden');
    const list = $('results-list');
    list.innerHTML = '';
    const sorted = payload.players.slice().sort((a, b) => (a.place || 99) - (b.place || 99));
    sorted.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `<span class="result-rank">${p.place || '-'}</span>
        <span class="result-name">${escapeHtml(p.name)}${p.isCPU ? '（CPU）' : ''}</span>
        <span class="result-mode">${p.mode === 'puyo' ? 'パズル' : 'ブロック'}</span>`;
      list.appendChild(row);
    });
    $('btn-back-to-lobby').classList.toggle('hidden', !isHost);
    $('results-wait-msg').classList.toggle('hidden', isHost);
    $('overlay-results').classList.remove('hidden');
  }

  $('btn-back-to-lobby').addEventListener('click', () => Network.backToLobby());

  // ---------------- boot ----------------
  initNameAndSettings();
  showScreen('screen-home');
})();
