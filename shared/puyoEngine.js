/**
 * Falling colored-blob connect-puzzle engine (generic implementation).
 * Runs identically in Node.js (CPU simulation) and in the browser (player boards).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PuyoEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 6;
  const ROWS = 12;
  const HIDDEN = 1;
  const TOTAL_ROWS = ROWS + HIDDEN;
  const COLORS = ['red', 'green', 'blue', 'yellow'];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CHAIN_POWER = [0, 0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480];
  function chainPower(n) {
    if (n < CHAIN_POWER.length) return CHAIN_POWER[n];
    return CHAIN_POWER[CHAIN_POWER.length - 1] + (n - (CHAIN_POWER.length - 1)) * 32;
  }
  const COLOR_BONUS = [0, 0, 3, 6, 12, 24];
  function groupBonus(size) {
    if (size <= 4) return 0;
    if (size === 5) return 2;
    if (size === 6) return 3;
    if (size <= 10) return 4 + (size - 7);
    return 6;
  }

  const ORIENTS = [
    [0, -1], // 0: child above axis
    [1, 0],  // 1: child right
    [0, 1],  // 2: child below
    [-1, 0], // 3: child left
  ];

  class PuyoEngine {
    constructor(opts) {
      opts = opts || {};
      this.seed = opts.seed || Math.floor(Math.random() * 1e9);
      this.rng = mulberry32(this.seed);
      this.board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(null));
      this.queue = [];
      this._fillQueue();
      this.score = 0;
      this.pendingGarbage = 0;
      this.gameOver = false;
      this.chainNow = 0;
      this.dropIntervalMs = opts.dropIntervalMs || 700;
      this._gravityAcc = 0;
      this._resolving = false;
      this._resolveQueue = [];
      this._resolveTimer = 0;
      this._spawnPair();
      this.lastEvents = null;
    }

    _randColorPair() {
      const c1 = COLORS[Math.floor(this.rng() * COLORS.length)];
      const c2 = COLORS[Math.floor(this.rng() * COLORS.length)];
      return [c1, c2];
    }

    _fillQueue() {
      while (this.queue.length < 3) this.queue.push(this._randColorPair());
    }

    _spawnPair() {
      this._fillQueue();
      const [c1, c2] = this.queue.shift();
      this._fillQueue();
      this.axis = { x: 2, y: 0, color: c1 };
      this.orient = 0;
      this.child = { x: 2 + ORIENTS[0][0], y: 0 + ORIENTS[0][1], color: c2 };
      this.pieceId = (this.pieceId || 0) + 1;
      if (this.board[this.axis.y][this.axis.x] || (this.child.y >= 0 && this.board[this.child.y][this.child.x])) {
        this.gameOver = true;
      }
    }

    _cellsFor(ax, ay, orient) {
      const [dx, dy] = ORIENTS[orient];
      return { axis: [ax, ay], child: [ax + dx, ay + dy] };
    }

    _inBounds(x, y) { return x >= 0 && x < COLS && y < TOTAL_ROWS; }
    _occupied(x, y) { return y >= 0 && this.board[y] && this.board[y][x]; }

    _canPlace(ax, ay, orient) {
      const { axis, child } = this._cellsFor(ax, ay, orient);
      for (const [x, y] of [axis, child]) {
        if (!this._inBounds(x, y)) return false;
        if (this._occupied(x, y)) return false;
      }
      return true;
    }

    moveLeft() { this._tryShift(-1, 0); }
    moveRight() { this._tryShift(1, 0); }

    _tryShift(dx, dy) {
      if (this.gameOver || this._resolving) return false;
      if (this._canPlace(this.axis.x + dx, this.axis.y + dy, this.orient)) {
        this.axis.x += dx; this.axis.y += dy;
        return true;
      }
      return false;
    }

    softDrop() {
      if (this.gameOver || this._resolving) return;
      if (this._canPlace(this.axis.x, this.axis.y + 1, this.orient)) {
        this.axis.y += 1;
        this.score += 1;
      } else {
        this._lockPair();
      }
    }

    hardDrop() {
      if (this.gameOver || this._resolving) return;
      let dist = 0;
      while (this._canPlace(this.axis.x, this.axis.y + 1, this.orient)) { this.axis.y += 1; dist++; }
      this.score += dist * 2;
      this._lockPair();
    }

    rotateCW() { this._tryRotate(1); }
    rotateCCW() { this._tryRotate(-1); }

    _tryRotate(dir) {
      if (this.gameOver || this._resolving) return false;
      const newOrient = (this.orient + dir + 4) % 4;
      const kicks = [[0, 0], [1, 0], [-1, 0], [0, -1]];
      for (const [kx, ky] of kicks) {
        if (this._canPlace(this.axis.x + kx, this.axis.y + ky, newOrient)) {
          this.axis.x += kx; this.axis.y += ky;
          this.orient = newOrient;
          return true;
        }
      }
      return false;
    }

    hold() { /* no hold action in this mode */ }

    _lockPair() {
      const { axis, child } = this._cellsFor(this.axis.x, this.axis.y, this.orient);
      if (axis[1] >= 0) this.board[axis[1]][axis[0]] = this.axis.color;
      if (child[1] >= 0) this.board[child[1]][child[0]] = this.child.color;
      this._resolving = true;
      this._resolveTimer = 0;
      this.chainNow = 0;
      this._settleGravityOnce();
    }

    _settleGravityOnce() {
      let moved = false;
      for (let x = 0; x < COLS; x++) {
        let write = TOTAL_ROWS - 1;
        for (let y = TOTAL_ROWS - 1; y >= 0; y--) {
          if (this.board[y][x]) {
            if (write !== y) { this.board[write][x] = this.board[y][x]; this.board[y][x] = null; moved = true; }
            write--;
          }
        }
      }
      return moved;
    }

    _findClearGroups() {
      const visited = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(false));
      const groups = [];
      for (let y = 0; y < TOTAL_ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const c = this.board[y][x];
          if (!c || c === 'garbage' || visited[y][x]) continue;
          const stack = [[x, y]];
          visited[y][x] = true;
          const cells = [];
          while (stack.length) {
            const [cx, cy] = stack.pop();
            cells.push([cx, cy]);
            const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
            for (const [nx, ny] of neighbors) {
              if (nx < 0 || nx >= COLS || ny < 0 || ny >= TOTAL_ROWS) continue;
              if (visited[ny][nx]) continue;
              if (this.board[ny][nx] === c) { visited[ny][nx] = true; stack.push([nx, ny]); }
            }
          }
          if (cells.length >= 4) groups.push({ color: c, cells });
        }
      }
      return groups;
    }

    // step the chain resolution; called repeatedly by tick(). Returns final events when done, else null.
    _stepResolve() {
      const groups = this._findClearGroups();
      if (groups.length === 0) {
        this._resolving = false;
        const totalScore = this._chainScoreAccum || 0;
        const chain = this.chainNow;
        this._chainScoreAccum = 0;
        let garbageOut = Math.floor(totalScore / 70);
        let received = 0;
        if (this.pendingGarbage > 0) {
          const offset = Math.min(this.pendingGarbage, garbageOut);
          garbageOut -= offset;
          this.pendingGarbage -= offset;
          if (garbageOut <= 0 && this.pendingGarbage > 0) {
            received = this.pendingGarbage;
            this._applyGarbage(received);
            this.pendingGarbage = 0;
          }
        }
        this._spawnPair();
        const events = { locked: true, chain, garbageOut, garbageIn: received, gameOver: this.gameOver };
        this.lastEvents = events;
        return events;
      }
      this.chainNow++;
      const clearedCells = new Set();
      const colorsUsed = new Set();
      let clearedCount = 0;
      for (const g of groups) {
        colorsUsed.add(g.color);
        for (const [x, y] of g.cells) clearedCells.add(x + ',' + y);
      }
      // garbage adjacent to any cleared group also clears
      for (const key of Array.from(clearedCells)) {
        const [x, y] = key.split(',').map(Number);
        const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= COLS || ny < 0 || ny >= TOTAL_ROWS) continue;
          if (this.board[ny][nx] === 'garbage') clearedCells.add(nx + ',' + ny);
        }
      }
      clearedCount = clearedCells.size;
      let stepPower = 0;
      for (const g of groups) stepPower += groupBonus(g.cells.length);
      stepPower += chainPower(this.chainNow);
      stepPower += COLOR_BONUS[Math.min(colorsUsed.size, COLOR_BONUS.length - 1)];
      const multiplier = Math.max(stepPower, 1);
      const stepScore = 10 * clearedCount * multiplier;
      this._chainScoreAccum = (this._chainScoreAccum || 0) + stepScore;
      this.score += stepScore;
      for (const key of clearedCells) {
        const [x, y] = key.split(',').map(Number);
        this.board[y][x] = null;
      }
      this._settleGravityOnce();
      return null; // not finished, more resolve steps may follow
    }

    _applyGarbage(n) {
      // drop full rows of 6 first, remainder as a partial bottom row
      let remaining = n;
      const rowsFull = Math.floor(remaining / COLS);
      for (let i = 0; i < rowsFull && remaining > 0; i++) {
        this.board.shift();
        this.board.push(Array(COLS).fill('garbage'));
        remaining -= COLS;
      }
      if (remaining > 0) {
        this.board.shift();
        const row = Array(COLS).fill(null);
        const cols = Array.from({ length: COLS }, (_, i) => i);
        for (let i = cols.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          [cols[i], cols[j]] = [cols[j], cols[i]];
        }
        for (let i = 0; i < remaining; i++) row[cols[i]] = 'garbage';
        this.board.push(row);
      }
    }

    receiveGarbage(n) { this.pendingGarbage += n; }

    tick(dtMs) {
      if (this.gameOver) return null;
      if (this._resolving) {
        this._resolveTimer += dtMs;
        if (this._resolveTimer >= 220) {
          this._resolveTimer = 0;
          return this._stepResolve();
        }
        return null;
      }
      this._gravityAcc += dtMs;
      if (this._gravityAcc >= this.dropIntervalMs) {
        this._gravityAcc = 0;
        if (this._canPlace(this.axis.x, this.axis.y + 1, this.orient)) {
          this.axis.y += 1;
        } else {
          this._lockPair();
        }
      }
      return null;
    }

    getState() {
      const visibleBoard = this.board.slice(HIDDEN).map((r) => r.slice());
      const { axis, child } = this._cellsFor(this.axis.x, this.axis.y, this.orient);
      let ghostDist = 0;
      while (this._canPlace(this.axis.x, this.axis.y + ghostDist + 1, this.orient)) ghostDist++;
      const ghost = {
        axis: [axis[0], axis[1] + ghostDist - HIDDEN],
        child: [child[0], child[1] + ghostDist - HIDDEN],
      };
      return {
        mode: 'puyo',
        board: visibleBoard,
        current: {
          axis: [axis[0], axis[1] - HIDDEN], axisColor: this.axis.color,
          child: [child[0], child[1] - HIDDEN], childColor: this.child.color,
        },
        ghost,
        next: this.queue.slice(0, 2),
        score: this.score,
        chain: this.chainNow,
        pendingGarbage: this.pendingGarbage,
        gameOver: this.gameOver,
        resolving: this._resolving,
        pieceId: this.pieceId,
      };
    }
  }

  PuyoEngine.COLS = COLS;
  PuyoEngine.ROWS = ROWS;
  PuyoEngine.HIDDEN = HIDDEN;
  PuyoEngine.TOTAL_ROWS = TOTAL_ROWS;
  PuyoEngine.COLORS = COLORS;
  PuyoEngine.ORIENTS = ORIENTS;
  PuyoEngine.offsetsFor = function (orient) { return ORIENTS[orient]; };
  return PuyoEngine;
});
