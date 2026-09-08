/**
 * Heuristic CPU controllers. Operate on a live engine instance (TetrisEngine or
 * PuyoEngine) by reading its board + queued pieces, and issuing the same
 * discrete inputs a human player would (move/rotate/drop) paced over time so
 * behaviour looks human rather than instant/teleporting.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./tetrisEngine'), require('./puyoEngine'));
  } else {
    root.CPU = factory(root.TetrisEngine, root.PuyoEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (TetrisEngine, PuyoEngine) {
  'use strict';

  const DIFFICULTIES = {
    easy: { mistakeChance: 0.55, minDelay: 700, maxDelay: 1200, inputGap: 110, lookahead: false },
    normal: { mistakeChance: 0.28, minDelay: 400, maxDelay: 750, inputGap: 80, lookahead: false },
    hard: { mistakeChance: 0.10, minDelay: 200, maxDelay: 380, inputGap: 55, lookahead: true },
    expert: { mistakeChance: 0.0, minDelay: 60, maxDelay: 160, inputGap: 35, lookahead: true },
  };

  function cloneGrid(g) { return g.map((r) => r.slice()); }

  function heights(grid, cols, rows) {
    const h = new Array(cols).fill(0);
    for (let x = 0; x < cols; x++) {
      let top = rows;
      for (let y = 0; y < rows; y++) { if (grid[y][x]) { top = y; break; } }
      h[x] = rows - top;
    }
    return h;
  }

  function holesCount(grid, cols, rows) {
    let holes = 0;
    for (let x = 0; x < cols; x++) {
      let seen = false;
      for (let y = 0; y < rows; y++) {
        if (grid[y][x]) seen = true;
        else if (seen) holes++;
      }
    }
    return holes;
  }

  function bumpiness(h) {
    let b = 0;
    for (let i = 0; i < h.length - 1; i++) b += Math.abs(h[i] - h[i + 1]);
    return b;
  }

  // ---------- Tetris CPU ----------
  function tetrisEvaluate(grid, cols, rows, linesCleared) {
    const h = heights(grid, cols, rows);
    const agg = h.reduce((a, b) => a + b, 0);
    const holes = holesCount(grid, cols, rows);
    const bump = bumpiness(h);
    return 0.760666 * linesCleared - 0.510066 * agg - 0.35663 * holes - 0.184483 * bump;
  }

  function tetrisSimulate(board, cols, totalRows, type, rot, x) {
    const cells0 = TetrisEngine.cellsFor(type, rot, x, 0);
    const minY = Math.min(...cells0.map((c) => c[1]));
    let y = -minY; // start above board
    const fits = (yy) => TetrisEngine.cellsFor(type, rot, x, yy).every(([cx, cy]) => {
      if (cx < 0 || cx >= cols || cy >= totalRows) return false;
      if (cy >= 0 && board[cy][cx]) return false;
      return true;
    });
    if (!fits(y)) return null;
    while (fits(y + 1)) y++;
    const grid = cloneGrid(board);
    for (const [cx, cy] of TetrisEngine.cellsFor(type, rot, x, y)) {
      if (cy >= 0) grid[cy][cx] = 'x';
    }
    let cleared = 0;
    for (let yy = totalRows - 1; yy >= 0; yy--) {
      if (grid[yy].every((c) => c)) { grid.splice(yy, 1); grid.unshift(new Array(cols).fill(null)); cleared++; yy++; }
    }
    return { grid, cleared };
  }

  class TetrisCPU {
    constructor(engine, difficulty) {
      this.engine = engine;
      this.cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
      this.lastPieceId = -1;
      this.state = 'idle';
      this.timer = 0;
      this.inputQueue = [];
      this.inputTimer = 0;
    }

    _decide() {
      const eng = this.engine;
      const cols = TetrisEngine.COLS;
      const totalRows = TetrisEngine.TOTAL_ROWS;
      const type = eng.cur.type;
      const rots = TetrisEngine.rotationCount(type);
      const candidates = [];
      for (let rot = 0; rot < rots; rot++) {
        for (let x = -2; x < cols; x++) {
          const res = tetrisSimulate(eng.board, cols, totalRows, type, rot, x);
          if (!res) continue;
          const score = tetrisEvaluate(res.grid, cols, totalRows, res.cleared);
          candidates.push({ rot, x, score });
        }
      }
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => b.score - a.score);
      let chosen = candidates[0];
      if (Math.random() < this.cfg.mistakeChance) {
        const pool = candidates.slice(0, Math.min(6, candidates.length));
        chosen = pool[Math.floor(Math.random() * pool.length)];
      }
      // build input sequence
      const seq = [];
      let rotDiff = ((chosen.rot - eng.cur.rot) % rots + rots) % rots;
      const rotDiffAlt = rotDiff - rots;
      if (Math.abs(rotDiffAlt) < rotDiff) {
        for (let i = 0; i < Math.abs(rotDiffAlt); i++) seq.push('rotateCCW');
      } else {
        for (let i = 0; i < rotDiff; i++) seq.push('rotateCW');
      }
      let xDiff = chosen.x - eng.cur.x;
      while (xDiff > 0) { seq.push('moveRight'); xDiff--; }
      while (xDiff < 0) { seq.push('moveLeft'); xDiff++; }
      if (this.cfg.lookahead) {
        const softSteps = Math.max(1, Math.min(5, Math.floor((eng.cur.y + 4) / 5)));
        for (let i = 0; i < softSteps; i++) seq.push('softDrop');
      }
      seq.push('hardDrop');
      return seq;
    }

    update(dtMs) {
      const eng = this.engine;
      if (eng.gameOver) return;
      if (eng.pieceId !== this.lastPieceId && this.state === 'idle') {
        this.lastPieceId = eng.pieceId;
        this.state = 'thinking';
        this.timer = this.cfg.minDelay + Math.random() * (this.cfg.maxDelay - this.cfg.minDelay);
      }
      if (this.state === 'thinking') {
        this.timer -= dtMs;
        if (this.timer <= 0) {
          const seq = this._decide();
          this.inputQueue = seq || ['hardDrop'];
          this.inputTimer = 0;
          this.state = 'acting';
        }
      } else if (this.state === 'acting') {
        this.inputTimer -= dtMs;
        if (this.inputTimer <= 0 && this.inputQueue.length) {
          const action = this.inputQueue.shift();
          if (typeof eng[action] === 'function') eng[action]();
          this.inputTimer = this.cfg.inputGap;
        }
        if (this.inputQueue.length === 0) this.state = 'idle';
      }
    }
  }

  // ---------- Puyo CPU ----------
  function puyoFloodFind(grid, cols, totalRows) {
    const visited = Array.from({ length: totalRows }, () => new Array(cols).fill(false));
    let maxGroup = 0;
    let groups = 0;
    for (let y = 0; y < totalRows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = grid[y][x];
        if (!c || c === 'garbage' || visited[y][x]) continue;
        let size = 0;
        const stack = [[x, y]];
        visited[y][x] = true;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          size++;
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (nx < 0 || nx >= cols || ny < 0 || ny >= totalRows) continue;
            if (visited[ny][nx]) continue;
            if (grid[ny][nx] === c) { visited[ny][nx] = true; stack.push([nx, ny]); }
          }
        }
        if (size > maxGroup) maxGroup = size;
        if (size >= 2) groups++;
      }
    }
    return { maxGroup, groups };
  }

  function puyoSettle(grid, cols, totalRows) {
    for (let x = 0; x < cols; x++) {
      let write = totalRows - 1;
      for (let y = totalRows - 1; y >= 0; y--) {
        if (grid[y][x]) {
          if (write !== y) { grid[write][x] = grid[y][x]; grid[y][x] = null; }
          write--;
        }
      }
    }
  }

  function puyoSimulate(board, cols, totalRows, axisColor, childColor, orient, x) {
    const [dx, dy] = PuyoEngine.offsetsFor(orient);
    const fits = (ax, ay) => {
      const cx = ax + dx, cy = ay + dy;
      for (const [px, py] of [[ax, ay], [cx, cy]]) {
        if (px < 0 || px >= cols || py >= totalRows) return false;
        if (py >= 0 && board[py][px]) return false;
      }
      return true;
    };
    let y = -2;
    if (!fits(x, y)) return null;
    while (fits(x, y + 1)) y++;
    const grid = cloneGrid(board);
    const cx = x + dx, cy = y + dy;
    if (y >= 0) grid[y][x] = axisColor;
    if (cy >= 0) grid[cy][cx] = childColor;
    puyoSettle(grid, cols, totalRows);
    return grid;
  }

  function puyoEvaluate(grid, cols, totalRows) {
    const h = heights(grid, cols, totalRows);
    const agg = h.reduce((a, b) => a + b, 0);
    const bump = bumpiness(h);
    const { maxGroup, groups } = puyoFloodFind(grid, cols, totalRows);
    const topOut = h.some((v) => v >= totalRows - 1) ? 1000 : 0;
    let clearBonus = 0;
    if (maxGroup >= 4) clearBonus = 200 + maxGroup * 20;
    return clearBonus + groups * 6 - agg * 1.1 - bump * 2.2 - topOut;
  }

  class PuyoCPU {
    constructor(engine, difficulty) {
      this.engine = engine;
      this.cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
      this.lastPieceId = -1;
      this.state = 'idle';
      this.timer = 0;
      this.inputQueue = [];
      this.inputTimer = 0;
    }

    _decide() {
      const eng = this.engine;
      const cols = PuyoEngine.COLS;
      const totalRows = PuyoEngine.TOTAL_ROWS;
      const axisColor = eng.axis.color;
      const childColor = eng.child.color;
      const candidates = [];
      for (let orient = 0; orient < 4; orient++) {
        for (let x = 0; x < cols; x++) {
          const grid = puyoSimulate(eng.board, cols, totalRows, axisColor, childColor, orient, x);
          if (!grid) continue;
          const score = puyoEvaluate(grid, cols, totalRows);
          candidates.push({ orient, x, score });
        }
      }
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => b.score - a.score);
      let chosen = candidates[0];
      if (Math.random() < this.cfg.mistakeChance) {
        const pool = candidates.slice(0, Math.min(6, candidates.length));
        chosen = pool[Math.floor(Math.random() * pool.length)];
      }
      const seq = [];
      let rotDiff = ((chosen.orient - eng.orient) % 4 + 4) % 4;
      const alt = rotDiff - 4;
      if (Math.abs(alt) < rotDiff) { for (let i = 0; i < Math.abs(alt); i++) seq.push('rotateCCW'); }
      else { for (let i = 0; i < rotDiff; i++) seq.push('rotateCW'); }
      let xDiff = chosen.x - eng.axis.x;
      while (xDiff > 0) { seq.push('moveRight'); xDiff--; }
      while (xDiff < 0) { seq.push('moveLeft'); xDiff++; }
      if (this.cfg.lookahead) {
        const softSteps = Math.max(1, Math.min(4, Math.floor((eng.axis.y + 3) / 6)));
        for (let i = 0; i < softSteps; i++) seq.push('softDrop');
      }
      seq.push('hardDrop');
      return seq;
    }

    update(dtMs) {
      const eng = this.engine;
      if (eng.gameOver) return;
      if (eng._resolving) return;
      if (eng.pieceId !== this.lastPieceId && this.state === 'idle') {
        this.lastPieceId = eng.pieceId;
        this.state = 'thinking';
        this.timer = this.cfg.minDelay + Math.random() * (this.cfg.maxDelay - this.cfg.minDelay);
      }
      if (this.state === 'thinking') {
        this.timer -= dtMs;
        if (this.timer <= 0) {
          const seq = this._decide();
          this.inputQueue = seq || ['hardDrop'];
          this.inputTimer = 0;
          this.state = 'acting';
        }
      } else if (this.state === 'acting') {
        this.inputTimer -= dtMs;
        if (this.inputTimer <= 0 && this.inputQueue.length) {
          const action = this.inputQueue.shift();
          if (typeof eng[action] === 'function') eng[action]();
          this.inputTimer = this.cfg.inputGap;
        }
        if (this.inputQueue.length === 0) this.state = 'idle';
      }
    }
  }

  function createCPU(mode, engine, difficulty) {
    return mode === 'puyo' ? new PuyoCPU(engine, difficulty) : new TetrisCPU(engine, difficulty);
  }

  return { createCPU, DIFFICULTIES: Object.keys(DIFFICULTIES) };
});
