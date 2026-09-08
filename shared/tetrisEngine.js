/**
 * Falling-block puzzle engine (generic 7-piece guideline-style implementation).
 * Runs identically in Node.js (CPU simulation) and in the browser (player boards).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TetrisEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 10;
  const ROWS = 20;
  const HIDDEN = 4; // buffer rows above visible field
  const TOTAL_ROWS = ROWS + HIDDEN;

  // Piece shapes defined on a 4x4 grid per rotation state (0=spawn,1=R,2=2,3=L)
  const SHAPES = {
    I: [
      [[1,1,1,1]],
    ],
    O: [
      [[1,1],[1,1]],
    ],
    T: [[[0,1,0],[1,1,1],[0,0,0]]],
    S: [[[0,1,1],[1,1,0],[0,0,0]]],
    Z: [[[1,1,0],[0,1,1],[0,0,0]]],
    J: [[[1,0,0],[1,1,1],[0,0,0]]],
    L: [[[0,0,1],[1,1,1],[0,0,0]]],
  };

  function rotateMatrix(m) {
    const h = m.length, w = m[0].length;
    const out = [];
    for (let x = 0; x < w; x++) {
      const row = [];
      for (let y = h - 1; y >= 0; y--) row.push(m[y][x]);
      out.push(row);
    }
    return out;
  }

  function buildRotationStates(base) {
    const states = [base];
    let cur = base;
    for (let i = 0; i < 3; i++) {
      cur = rotateMatrix(cur);
      states.push(cur);
    }
    return states;
  }

  const PIECE_STATES = {};
  const PIECE_COLOR = { I: 'cyan', O: 'yellow', T: 'purple', S: 'green', Z: 'red', J: 'blue', L: 'orange' };
  Object.keys(SHAPES).forEach((k) => {
    PIECE_STATES[k] = buildRotationStates(SHAPES[k][0]);
  });

  // Simplified wall-kick offsets (dx, dy) tried in order after a rotation attempt fails.
  const KICKS = [
    [0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, 1], [-1, 1], [1, 1],
    [-2, 0], [2, 0], [0, -2], [-2, -1], [2, -1],
  ];

  const BAG = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  function shuffledBag(rng) {
    const bag = BAG.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Guideline-ish attack table
  function linesToGarbage(lines, backToBack, comboCount, perfectClear) {
    let g = 0;
    if (lines === 1) g = 0;
    else if (lines === 2) g = 1;
    else if (lines === 3) g = 2;
    else if (lines >= 4) g = 4;
    if (lines >= 4 && backToBack) g += 1;
    const comboTable = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
    const comboBonus = comboTable[Math.min(comboCount, comboTable.length - 1)] || 0;
    if (lines > 0) g += comboBonus;
    if (perfectClear) g += 10;
    return g;
  }

  class TetrisEngine {
    constructor(opts) {
      opts = opts || {};
      this.seed = opts.seed || Math.floor(Math.random() * 1e9);
      this.rng = mulberry32(this.seed);
      this.board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(null));
      this.queue = [];
      this._fillQueue();
      this.holdPiece = null;
      this.holdUsed = false;
      this.score = 0;
      this.level = 1;
      this.linesClearedTotal = 0;
      this.combo = -1;
      this.backToBack = false;
      this.pendingGarbage = 0;
      this.garbageTimerMs = 0;
      this.GARBAGE_DELAY_MS = 2200;
      this.gameOver = false;
      this.dropIntervalMs = opts.dropIntervalMs || 800;
      this._gravityAcc = 0;
      this._lockAcc = 0;
      this._locking = false;
      this._lockResets = 0;
      this.pieceId = 0;
      this._spawnPiece();
      this.lastEvents = null;
    }

    _fillQueue() {
      while (this.queue.length < 7) {
        this.queue.push(...shuffledBag(this.rng));
      }
    }

    _spawnPiece() {
      this._fillQueue();
      const type = this.queue.shift();
      this._fillQueue();
      this.cur = {
        type,
        rot: 0,
        x: Math.floor(COLS / 2) - 2,
        y: HIDDEN - 2,
      };
      this.holdUsed = false;
      this.pieceId = (this.pieceId || 0) + 1;
      if (this._collides(this.cur, 0, 0, 0)) {
        this.gameOver = true;
      }
    }

    _cells(piece, rotOverride, xOff, yOff) {
      const rot = rotOverride == null ? piece.rot : rotOverride;
      const shape = PIECE_STATES[piece.type][rot % PIECE_STATES[piece.type].length];
      const cells = [];
      for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
          if (shape[y][x]) {
            cells.push([piece.x + x + (xOff || 0), piece.y + y + (yOff || 0)]);
          }
        }
      }
      return cells;
    }

    _collides(piece, dx, dy, drot) {
      const rot = (piece.rot + (drot || 0) + 4) % 4;
      const cells = this._cells(piece, rot, dx, dy);
      for (const [x, y] of cells) {
        if (x < 0 || x >= COLS || y >= TOTAL_ROWS) return true;
        if (y >= 0 && this.board[y][x]) return true;
      }
      return false;
    }

    moveLeft() { this._tryMove(-1, 0); }
    moveRight() { this._tryMove(1, 0); }

    _tryMove(dx, dy) {
      if (this.gameOver) return false;
      if (!this._collides(this.cur, dx, dy, 0)) {
        this.cur.x += dx;
        this.cur.y += dy;
        if (this._locking) { this._lockAcc = 0; this._lockResets++; if (this._lockResets > 12) this._forceLock(); }
        return true;
      }
      return false;
    }

    softDrop() {
      if (this.gameOver) return;
      if (!this._collides(this.cur, 0, 1, 0)) {
        this.cur.y += 1;
        this.score += 1;
      }
    }

    hardDrop() {
      if (this.gameOver) return null;
      let dist = 0;
      while (!this._collides(this.cur, 0, 1, 0)) { this.cur.y += 1; dist++; }
      this.score += dist * 2;
      return this._forceLock();
    }

    rotateCW() { this._tryRotate(1); }
    rotateCCW() { this._tryRotate(-1); }

    _tryRotate(dir) {
      if (this.gameOver) return false;
      if (this.cur.type === 'O') return false;
      for (const [kx, ky] of KICKS) {
        const dx = kx, dy = ky;
        if (!this._collides(this.cur, dx, dy, dir)) {
          this.cur.rot = (this.cur.rot + dir + 4) % 4;
          this.cur.x += dx;
          this.cur.y += dy;
          if (this._locking) { this._lockAcc = 0; this._lockResets++; if (this._lockResets > 12) this._forceLock(); }
          return true;
        }
      }
      return false;
    }

    hold() {
      if (this.gameOver || this.holdUsed) return;
      this.holdUsed = true;
      const curType = this.cur.type;
      if (this.holdPiece == null) {
        this.holdPiece = curType;
        this._spawnPiece();
      } else {
        const swap = this.holdPiece;
        this.holdPiece = curType;
        this.cur = { type: swap, rot: 0, x: Math.floor(COLS / 2) - 2, y: HIDDEN - 2 };
        if (this._collides(this.cur, 0, 0, 0)) this.gameOver = true;
      }
    }

    getGhostY() {
      let y = this.cur.y;
      const tmp = { ...this.cur };
      let dist = 0;
      while (!this._collides(this.cur, 0, dist + 1, 0)) dist++;
      return this.cur.y + dist;
    }

    _forceLock() {
      this._locking = false;
      this._lockAcc = 0;
      this._lockResets = 0;
      const cells = this._cells(this.cur);
      for (const [x, y] of cells) {
        if (y >= 0) this.board[y][x] = PIECE_COLOR[this.cur.type];
      }
      // clear lines
      let cleared = 0;
      for (let y = TOTAL_ROWS - 1; y >= 0; y--) {
        if (this.board[y].every((c) => c)) {
          this.board.splice(y, 1);
          this.board.unshift(Array(COLS).fill(null));
          cleared++;
          y++;
        }
      }
      this.linesClearedTotal += cleared;
      this.level = 1 + Math.floor(this.linesClearedTotal / 10);
      let garbageOut = 0;
      const perfectClear = cleared > 0 && this.board.every((row) => row.every((c) => !c));
      const wasBackToBack = this.backToBack;
      if (cleared > 0) {
        this.combo++;
        const isTetris = cleared >= 4;
        garbageOut = linesToGarbage(cleared, isTetris && this.backToBack, this.combo, perfectClear);
        this.backToBack = isTetris ? true : (cleared > 0 ? false : this.backToBack);
        this.score += [0, 100, 300, 500, 800][Math.min(cleared, 4)] * this.level;
      } else {
        this.combo = -1;
      }
      // Sending an attack immediately cancels out any garbage still queued
      // against us (real Puyo Tetris "offsetting"). Whatever isn't cancelled
      // keeps counting down and lands later via tick()'s timer, not instantly.
      if (this.pendingGarbage > 0 && garbageOut > 0) {
        const offset = Math.min(this.pendingGarbage, garbageOut);
        garbageOut -= offset;
        this.pendingGarbage -= offset;
        if (this.pendingGarbage <= 0) { this.pendingGarbage = 0; this.garbageTimerMs = 0; }
      }
      this._spawnPiece();
      const events = {
        locked: true, linesCleared: cleared, garbageOut, gameOver: this.gameOver,
        perfectClear, combo: Math.max(this.combo, 0), backToBack: cleared >= 4 && wasBackToBack,
      };
      this.lastEvents = events;
      return events;
    }

    _applyGarbageRows(n) {
      for (let i = 0; i < n; i++) {
        const gapCol = Math.floor(this.rng() * COLS);
        const row = Array(COLS).fill('garbage');
        row[gapCol] = null;
        this.board.shift();
        this.board.push(row);
      }
      // if top rows now occupied above visible spawn area -> death handled on next spawn
    }

    receiveGarbage(n) {
      this.pendingGarbage += n;
      if (this.garbageTimerMs <= 0) this.garbageTimerMs = this.GARBAGE_DELAY_MS;
    }

    tick(dtMs) {
      if (this.gameOver) return { lockEvent: null, garbageLanded: 0 };
      let garbageLanded = 0;
      if (this.garbageTimerMs > 0) {
        this.garbageTimerMs -= dtMs;
        if (this.garbageTimerMs <= 0 && this.pendingGarbage > 0) {
          garbageLanded = this.pendingGarbage;
          this._applyGarbageRows(garbageLanded);
          this.pendingGarbage = 0;
          this.garbageTimerMs = 0;
          if (!this._collides(this.cur, 0, 0, 0)) {
            // piece got pushed up into a wall by the new rows; nudge check handled on next spawn
          }
        }
      }
      let dropMs = this.dropIntervalMs;
      dropMs = Math.max(80, dropMs - (this.level - 1) * 40);
      this._gravityAcc += dtMs;
      let lockEvent = null;
      if (this._gravityAcc >= dropMs) {
        this._gravityAcc = 0;
        if (!this._collides(this.cur, 0, 1, 0)) {
          this.cur.y += 1;
          this._locking = false;
        } else {
          this._locking = true;
          this._lockAcc += dropMs;
          if (this._lockAcc >= 500) {
            lockEvent = this._forceLock();
          }
        }
      }
      return { lockEvent, garbageLanded };
    }

    getState() {
      const visibleBoard = this.board.slice(HIDDEN).map((r) => r.slice());
      const curCells = this._cells(this.cur).filter(([, y]) => y >= HIDDEN).map(([x, y]) => [x, y - HIDDEN]);
      const ghostY = this.getGhostY();
      const ghostCells = this._cells(this.cur, this.cur.rot, 0, ghostY - this.cur.y)
        .filter(([, y]) => y >= HIDDEN).map(([x, y]) => [x, y - HIDDEN]);
      return {
        mode: 'tetris',
        board: visibleBoard,
        current: { type: this.cur.type, color: PIECE_COLOR[this.cur.type], cells: curCells },
        ghost: ghostCells,
        next: this.queue.slice(0, 3),
        hold: this.holdPiece,
        score: this.score,
        level: this.level,
        combo: Math.max(this.combo, 0),
        pendingGarbage: this.pendingGarbage,
        garbageTimerMs: Math.max(0, this.garbageTimerMs),
        garbageDelayMs: this.GARBAGE_DELAY_MS,
        gameOver: this.gameOver,
        pieceId: this.pieceId,
      };
    }
  }

  TetrisEngine.COLS = COLS;
  TetrisEngine.ROWS = ROWS;
  TetrisEngine.HIDDEN = HIDDEN;
  TetrisEngine.TOTAL_ROWS = TOTAL_ROWS;
  TetrisEngine.COLOR_OF = PIECE_COLOR;
  TetrisEngine.cellsFor = function (type, rot, x, y) {
    const states = PIECE_STATES[type];
    const shape = states[((rot % states.length) + states.length) % states.length];
    const out = [];
    for (let yy = 0; yy < shape.length; yy++) {
      for (let xx = 0; xx < shape[yy].length; xx++) {
        if (shape[yy][xx]) out.push([x + xx, y + yy]);
      }
    }
    return out;
  };
  TetrisEngine.rotationCount = function (type) { return PIECE_STATES[type].length; };
  return TetrisEngine;
});
