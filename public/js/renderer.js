const COLOR_HEX = {
  cyan: '#4CE0D2', yellow: '#FFC64C', purple: '#9B6BFF', green: '#8CE04C',
  red: '#FF5F6D', blue: '#4C8CFF', orange: '#FF9A4C', garbage: '#5B5878',
};

function cellColor(v) { return v ? (COLOR_HEX[v] || '#8884b8') : null; }

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBlock(ctx, px, py, size, color, ghost) {
  const pad = Math.max(1, size * 0.06);
  if (ghost) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * 0.08);
    roundRectPath(ctx, px + pad, py + pad, size - pad * 2, size - pad * 2, size * 0.18);
    ctx.stroke();
    return;
  }
  const grad = ctx.createLinearGradient(px, py, px, py + size);
  grad.addColorStop(0, color);
  grad.addColorStop(1, shade(color, -18));
  ctx.fillStyle = grad;
  roundRectPath(ctx, px + pad, py + pad, size - pad * 2, size - pad * 2, size * 0.22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.stroke();
}

function drawPuyoBlob(ctx, px, py, size, color, ghost) {
  const cx = px + size / 2, cy = py + size / 2, r = size * 0.42;
  if (ghost) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * 0.07);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    return;
  }
  if (color === COLOR_HEX.garbage) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * 0.3, cy - r * 0.3, r * 0.18, 0, Math.PI * 2); ctx.fill();
    return;
  }
  const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  grad.addColorStop(0, shade(color, 25));
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(20,15,40,0.55)';
  ctx.beginPath(); ctx.arc(cx - r * 0.28, cy + r * 0.05, r * 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + r * 0.28, cy + r * 0.05, r * 0.12, 0, Math.PI * 2); ctx.fill();
}

function shade(hex, pct) {
  const num = parseInt(hex.replace('#', ''), 16);
  let r = (num >> 16) + Math.round(255 * (pct / 100));
  let g = ((num >> 8) & 0xff) + Math.round(255 * (pct / 100));
  let b = (num & 0xff) + Math.round(255 * (pct / 100));
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

function clearCanvas(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(15,13,35,0.55)';
  ctx.fillRect(0, 0, w, h);
}

const Renderer = {
  drawBoard(canvas, state, opts) {
    if (!state) return;
    opts = opts || {};
    const cols = state.board[0] ? state.board[0].length : (state.mode === 'puyo' ? 6 : 10);
    const rows = state.board.length;
    const size = Math.min(canvas.width / cols, canvas.height / rows);
    const offX = (canvas.width - size * cols) / 2;
    const offY = (canvas.height - size * rows) / 2;
    const ctx = canvas.getContext('2d');
    clearCanvas(ctx, canvas.width, canvas.height);

    // grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath(); ctx.moveTo(offX + x * size, offY); ctx.lineTo(offX + x * size, offY + rows * size); ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath(); ctx.moveTo(offX, offY + y * size); ctx.lineTo(offX + cols * size, offY + y * size); ctx.stroke();
    }

    const draw = state.mode === 'puyo' ? drawPuyoBlob : drawBlock;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = state.board[y][x];
        if (v) draw(ctx, offX + x * size, offY + y * size, size, cellColor(v));
      }
    }

    if (state.mode === 'tetris' && state.current) {
      if (!opts.hideGhost) {
        for (const [x, y] of state.ghost) {
          if (y >= 0) draw(ctx, offX + x * size, offY + y * size, size, cellColor(state.current.color), true);
        }
      }
      for (const [x, y] of state.current.cells) {
        if (y >= 0) draw(ctx, offX + x * size, offY + y * size, size, cellColor(state.current.color));
      }
    } else if (state.mode === 'puyo' && state.current) {
      if (!opts.hideGhost && state.ghost) {
        if (state.ghost.axis[1] >= 0) draw(ctx, offX + state.ghost.axis[0] * size, offY + state.ghost.axis[1] * size, size, cellColor(state.current.axisColor), true);
        if (state.ghost.child[1] >= 0) draw(ctx, offX + state.ghost.child[0] * size, offY + state.ghost.child[1] * size, size, cellColor(state.current.childColor), true);
      }
      const [ax, ay] = state.current.axis;
      const [cx, cy] = state.current.child;
      if (ay >= 0) draw(ctx, offX + ax * size, offY + ay * size, size, cellColor(state.current.axisColor));
      if (cy >= 0) draw(ctx, offX + cx * size, offY + cy * size, size, cellColor(state.current.childColor));
    }

    if (state.gameOver) {
      ctx.fillStyle = 'rgba(10,8,25,0.72)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#F1EFFA';
      ctx.font = `700 ${Math.round(canvas.width * 0.09)}px "M PLUS Rounded 1c", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('脱落', canvas.width / 2, canvas.height / 2);
    }
  },

  renderNextHold(nextEl, holdEl, state) {
    if (!nextEl) return;
    nextEl.innerHTML = '';
    if (state.mode === 'tetris') {
      state.next.forEach((type) => {
        const mini = document.createElement('div');
        mini.className = 'mini-piece';
        mini.style.background = shade(COLOR_HEX[type === 'I' || type === 'O' ? type : type] || '#888', 0);
        mini.style.setProperty('--pc', cellColor(pieceColorOf(type)));
        mini.textContent = '';
        mini.appendChild(makeMiniShape(type));
        nextEl.appendChild(mini);
      });
      if (holdEl) {
        holdEl.innerHTML = '';
        if (state.hold) holdEl.appendChild(makeMiniShape(state.hold));
      }
    } else {
      state.next.forEach((pair) => {
        const mini = document.createElement('div');
        mini.className = 'mini-puyo-pair';
        const b1 = document.createElement('span'); b1.style.background = cellColor(pair[0]);
        const b2 = document.createElement('span'); b2.style.background = cellColor(pair[1]);
        mini.appendChild(b2); mini.appendChild(b1);
        nextEl.appendChild(mini);
      });
      if (holdEl) holdEl.innerHTML = '<span class="hold-na">なし</span>';
    }
  },
};

function pieceColorOf(type) {
  const m = { I: 'cyan', O: 'yellow', T: 'purple', S: 'green', Z: 'red', J: 'blue', L: 'orange' };
  return m[type];
}

const SHAPE_4x2 = {
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
};

function makeMiniShape(type) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-shape';
  const shape = SHAPE_4x2[type];
  const color = cellColor(pieceColorOf(type));
  wrap.style.gridTemplateColumns = `repeat(${shape[0].length}, 1fr)`;
  shape.forEach((row) => {
    row.forEach((cell) => {
      const d = document.createElement('div');
      d.className = 'mini-cell';
      if (cell) d.style.background = color;
      wrap.appendChild(d);
    });
  });
  return wrap;
}
