// Cookie helpers + persistent settings (player name, controller bindings)
const Cookies = {
  set(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days || 365) * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
  },
  get(name) {
    const key = name + '=';
    const parts = document.cookie.split(';');
    for (let c of parts) {
      c = c.trim();
      if (c.indexOf(key) === 0) return decodeURIComponent(c.substring(key.length));
    }
    return null;
  },
};

const ACTIONS = [
  { id: 'moveLeft', label: '左移動' },
  { id: 'moveRight', label: '右移動' },
  { id: 'softDrop', label: 'ソフトドロップ（下）' },
  { id: 'hardDrop', label: 'ハードドロップ（即落下・ぷよでは無効）' },
  { id: 'rotateCW', label: '右回転' },
  { id: 'rotateCCW', label: '左回転' },
  { id: 'hold', label: 'ホールド' },
  { id: 'targetPrev', label: '攻撃対象を切替（前）' },
  { id: 'targetNext', label: '攻撃対象を切替（次）' },
  { id: 'pause', label: 'メニューを開く' },
];

const BUTTON_SLOTS = [
  { id: 'dpad-up', label: '十字キー ↑ / スティック上' },
  { id: 'dpad-down', label: '十字キー ↓ / スティック下' },
  { id: 'dpad-left', label: '十字キー ← / スティック左' },
  { id: 'dpad-right', label: '十字キー → / スティック右' },
  { id: 'A', label: 'A ボタン' },
  { id: 'B', label: 'B ボタン' },
  { id: 'X', label: 'X ボタン' },
  { id: 'Y', label: 'Y ボタン' },
  { id: 'L', label: 'L ボタン' },
  { id: 'R', label: 'R ボタン' },
  { id: 'ZL', label: 'ZL ボタン' },
  { id: 'ZR', label: 'ZR ボタン' },
];

const DEFAULT_CONTROLS = {
  keyboard: {
    moveLeft: 'ArrowLeft',
    moveRight: 'ArrowRight',
    softDrop: 'ArrowDown',
    hardDrop: ' ',
    rotateCW: 'ArrowUp',
    rotateCCW: 'z',
    hold: 'c',
    targetPrev: 'q',
    targetNext: 'e',
    pause: 'Escape',
  },
  buttons: {
    'dpad-up': 'hardDrop',
    'dpad-down': 'softDrop',
    'dpad-left': 'moveLeft',
    'dpad-right': 'moveRight',
    A: 'rotateCW',
    Y: 'rotateCW',
    B: 'rotateCCW',
    X: 'rotateCCW',
    L: 'hold',
    R: 'hold',
    ZL: 'targetPrev',
    ZR: 'targetNext',
  },
};

const Settings = {
  KEY: 'pbo_settings',
  load() {
    const raw = Cookies.get(this.KEY);
    let data = { name: '', controls: JSON.parse(JSON.stringify(DEFAULT_CONTROLS)) };
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        data.name = parsed.name || '';
        data.controls = {
          keyboard: Object.assign({}, DEFAULT_CONTROLS.keyboard, parsed.controls && parsed.controls.keyboard),
          buttons: Object.assign({}, DEFAULT_CONTROLS.buttons, parsed.controls && parsed.controls.buttons),
        };
      } catch (e) { /* ignore corrupt cookie */ }
    }
    this.current = data;
    return data;
  },
  save() {
    Cookies.set(this.KEY, JSON.stringify(this.current), 365);
  },
  setName(name) {
    this.current.name = (name || '').slice(0, 10);
    this.save();
  },
  resetControls() {
    this.current.controls = JSON.parse(JSON.stringify(DEFAULT_CONTROLS));
    this.save();
  },
};
