// Persistent player name and input bindings.
const ACTIONS = Object.freeze([
  { id: 'moveLeft', label: '左へ移動' },
  { id: 'moveRight', label: '右へ移動' },
  { id: 'softDrop', label: 'ソフトドロップ' },
  { id: 'hardDrop', label: 'ハードドロップ' },
  { id: 'rotateLeft', label: '左回転' },
  { id: 'rotateRight', label: '右回転' },
  { id: 'hold', label: 'ホールド' },
]);

const BUTTON_SLOTS = Object.freeze([
  { id: 'dpad-up', label: '十字キー 上' },
  { id: 'dpad-down', label: '十字キー 下' },
  { id: 'dpad-left', label: '十字キー 左' },
  { id: 'dpad-right', label: '十字キー 右' },
  { id: 'A', label: 'A ボタン' },
  { id: 'B', label: 'B ボタン' },
  { id: 'X', label: 'X ボタン' },
  { id: 'Y', label: 'Y ボタン' },
  { id: 'L', label: 'L ボタン' },
  { id: 'R', label: 'R ボタン' },
  { id: 'ZL', label: 'ZL ボタン' },
  { id: 'ZR', label: 'ZR ボタン' },
]);

const DEFAULT_CONTROLS = Object.freeze({
  keyboard: Object.freeze({
    moveLeft: 'ArrowLeft',
    moveRight: 'ArrowRight',
    softDrop: 'ArrowDown',
    hardDrop: ' ',
    rotateLeft: 'z',
    rotateRight: 'x',
    hold: 'c',
  }),
  buttons: Object.freeze({
    'dpad-up': 'hardDrop',
    'dpad-down': 'softDrop',
    'dpad-left': 'moveLeft',
    'dpad-right': 'moveRight',
    A: 'rotateRight',
    B: 'rotateLeft',
    X: 'hold',
    Y: 'none',
    L: 'rotateLeft',
    R: 'rotateRight',
    ZL: 'hold',
    ZR: 'hardDrop',
  }),
});

const Settings = (() => {
  const STORAGE_KEY = 'puzzle-battle-settings';

  function defaultSettings() {
    return {
      name: '',
      controls: {
        keyboard: { ...DEFAULT_CONTROLS.keyboard },
        buttons: { ...DEFAULT_CONTROLS.buttons },
      },
    };
  }

  function normalize(value) {
    const defaults = defaultSettings();
    if (!value || typeof value !== 'object') return defaults;

    return {
      name: typeof value.name === 'string' ? value.name.trim().slice(0, 10) : '',
      controls: {
        keyboard: {
          ...defaults.controls.keyboard,
          ...(value.controls && value.controls.keyboard),
        },
        buttons: {
          ...defaults.controls.buttons,
          ...(value.controls && value.controls.buttons),
        },
      },
    };
  }

  const api = {
    current: defaultSettings(),

    load() {
      try {
        api.current = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
      } catch (_error) {
        api.current = defaultSettings();
      }
      return api.current;
    },

    save() {
      api.current = normalize(api.current);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(api.current));
      } catch (_error) {
        // The game remains usable when browser storage is unavailable.
      }
      return api.current;
    },

    setName(name) {
      api.current.name = String(name || '').trim().slice(0, 10);
      api.save();
    },

    resetControls() {
      api.current.controls = defaultSettings().controls;
      api.save();
    },
  };

  return api;
})();
