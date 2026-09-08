// Handles all input sources (on-screen virtual controller, keyboard, physical
// gamepad) and turns them into game actions according to the user's bindings.
const Controller = (() => {
  let onAction = null; // callback(actionId, pressed)
  const heldKeys = new Set();
  const activeSlots = new Set();
  const REPEATABLE = new Set(['moveLeft', 'moveRight', 'softDrop']);
  const repeatTimers = new Map();

  function reverseKeyMap() {
    const map = {};
    const kb = Settings.current.controls.keyboard;
    for (const action in kb) map[kb[action]] = action;
    return map;
  }

  function fireStart(actionId) {
    if (!actionId || actionId === 'none') return;
    if (onAction) onAction(actionId, true);
    if (REPEATABLE.has(actionId)) {
      clearRepeat(actionId);
      const t1 = setTimeout(() => {
        const t2 = setInterval(() => { if (onAction) onAction(actionId, true); }, 45);
        repeatTimers.set(actionId, { interval: t2 });
      }, 170);
      repeatTimers.set(actionId, { timeout: t1 });
    }
  }

  function clearRepeat(actionId) {
    const r = repeatTimers.get(actionId);
    if (r) {
      if (r.timeout) clearTimeout(r.timeout);
      if (r.interval) clearInterval(r.interval);
      repeatTimers.delete(actionId);
    }
  }

  function fireStop(actionId) {
    if (!actionId || actionId === 'none') return;
    clearRepeat(actionId);
  }

  function slotToAction(slot) {
    return Settings.current.controls.buttons[slot];
  }

  function pressSlot(slot) {
    if (activeSlots.has(slot)) return;
    activeSlots.add(slot);
    fireStart(slotToAction(slot));
    const el = document.querySelector(`[data-slot="${slot}"]`);
    if (el) el.classList.add('is-active');
  }

  function releaseSlot(slot) {
    if (!activeSlots.has(slot)) return;
    activeSlots.delete(slot);
    fireStop(slotToAction(slot));
    const el = document.querySelector(`[data-slot="${slot}"]`);
    if (el) el.classList.remove('is-active');
  }

  function initButtons(root) {
    root.querySelectorAll('[data-slot]').forEach((el) => {
      const slot = el.getAttribute('data-slot');
      const down = (e) => { e.preventDefault(); e.stopPropagation(); pressSlot(slot); };
      const up = (e) => { e.preventDefault(); releaseSlot(slot); };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  function initStick(root) {
    const stick = root.querySelector('.stick-base');
    const knob = root.querySelector('.stick-knob');
    if (!stick || !knob) return;
    let dragging = false;
    let activeDir = null;
    const R = 34; // px max travel
    const THRESH = 0.45;

    function setDir(dir) {
      if (activeDir === dir) return;
      if (activeDir) releaseSlot('dpad-' + activeDir);
      activeDir = dir;
      if (activeDir) pressSlot('dpad-' + activeDir);
    }

    function handleMove(clientX, clientY) {
      const rect = stick.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.min(Math.hypot(dx, dy), R);
      const angle = Math.atan2(dy, dx);
      const kx = Math.cos(angle) * dist;
      const ky = Math.sin(angle) * dist;
      knob.style.transform = `translate(${kx}px, ${ky}px)`;
      const norm = dist / R;
      if (norm < THRESH) { setDir(null); return; }
      const deg = angle * 180 / Math.PI;
      if (deg > -45 && deg <= 45) setDir('right');
      else if (deg > 45 && deg <= 135) setDir('down');
      else if (deg > 135 || deg <= -135) setDir('left');
      else setDir('up');
    }

    function reset() {
      knob.style.transform = 'translate(0px, 0px)';
      setDir(null);
      dragging = false;
    }

    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = true;
      stick.setPointerCapture(e.pointerId);
      handleMove(e.clientX, e.clientY);
    });
    stick.addEventListener('pointermove', (e) => { e.preventDefault(); if (dragging) handleMove(e.clientX, e.clientY); });
    stick.addEventListener('pointerup', reset);
    stick.addEventListener('pointercancel', reset);
  }

  function initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (document.body.classList.contains('capturing-key')) return;
      const map = reverseKeyMap();
      const action = map[e.key];
      if (!action) return;
      e.preventDefault();
      if (heldKeys.has(e.key)) return;
      heldKeys.add(e.key);
      fireStart(action);
    });
    window.addEventListener('keyup', (e) => {
      const map = reverseKeyMap();
      const action = map[e.key];
      heldKeys.delete(e.key);
      if (!action) return;
      fireStop(action);
    });
  }

  // Physical gamepad passthrough — reuses the same on-screen button bindings.
  const GP_BUTTON_SLOTS = ['A', 'B', 'X', 'Y', 'L', 'R', 'ZL', 'ZR'];
  const GP_DPAD_SLOTS = { 12: 'dpad-up', 13: 'dpad-down', 14: 'dpad-left', 15: 'dpad-right' };
  let gpPrevPressed = {};

  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      GP_BUTTON_SLOTS.forEach((slot, i) => {
        const btn = pad.buttons[i];
        const pressed = btn && btn.pressed;
        const key = pad.index + ':' + slot;
        if (pressed && !gpPrevPressed[key]) pressSlot(slot);
        if (!pressed && gpPrevPressed[key]) releaseSlot(slot);
        gpPrevPressed[key] = pressed;
      });
      for (const idx in GP_DPAD_SLOTS) {
        const slot = GP_DPAD_SLOTS[idx];
        const btn = pad.buttons[idx];
        const pressed = btn && btn.pressed;
        const key = pad.index + ':' + slot;
        if (pressed && !gpPrevPressed[key]) pressSlot(slot);
        if (!pressed && gpPrevPressed[key]) releaseSlot(slot);
        gpPrevPressed[key] = pressed;
      }
      // left stick axes as analog dpad fallback
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const dirs = { left: ax < -0.5, right: ax > 0.5, up: ay < -0.5, down: ay > 0.5 };
      for (const d in dirs) {
        const slot = 'dpad-' + d;
        const key = pad.index + ':axis:' + slot;
        if (dirs[d] && !gpPrevPressed[key]) pressSlot(slot);
        if (!dirs[d] && gpPrevPressed[key]) releaseSlot(slot);
        gpPrevPressed[key] = dirs[d];
      }
    }
  }

  function init(rootLeft, rootRight, actionCallback) {
    onAction = actionCallback;
    initButtons(rootLeft);
    initButtons(rootRight);
    initStick(rootLeft);
    initKeyboard();
  }

  return { init, pollGamepad };
})();
