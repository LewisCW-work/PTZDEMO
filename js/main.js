/*
 *  Copyright (c) 2020 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

// Put variables in global scope to make them available to the browser console.
const constraints = window.constraints = {
  video: {
    pan: true, tilt: true, zoom: true
  }
};
// Multiplier to make fine-step adjustments a bit faster.
const SPEED_MULT = 2;

// Default ranges when no camera is attached (standalone controls).
const DEFAULT_RANGES = {
  pan: {min: -180, max: 180, step: 0.05, value: 0},
  tilt: {min: -90, max: 90, step: 0.05, value: 0},
  zoom: {min: 1, max: 10, step: 0.1, value: 1}
};

function handleSuccess(stream) {
  const video = document.querySelector('video');
  const videoTracks = stream.getVideoTracks();
  console.log('Got stream with constraints:', constraints);
  console.log(`Using video device: ${videoTracks[0].label}`);
  if (video) video.srcObject = stream;

  // make track variable available to browser console.
  const [track] = [window.track] = stream.getVideoTracks();
  initControls(track);
}

// Initialize controls; if `track` is null use sensible defaults so UI works without camera.
function initControls(track = null) {
  const capabilities = track ? track.getCapabilities() : {};
  const settings = track ? track.getSettings() : {};
  const supported = {pan: false, tilt: false, zoom: false};

  for (const ptz of ['pan', 'tilt', 'zoom']) {
    const input = document.querySelector(`input[name=${ptz}]`);
    if (!input) continue;
    const display = document.querySelector(`.value[data-for=${ptz}]`);
    const stepDown = document.querySelector(`.step-down[data-for=${ptz}]`);
    const stepUp = document.querySelector(`.step-up[data-for=${ptz}]`);

    const cap = capabilities[ptz] || DEFAULT_RANGES[ptz] || {};
    const sett = (ptz in settings) ? settings[ptz] : (DEFAULT_RANGES[ptz] ? DEFAULT_RANGES[ptz].value : cap.min || 0);

    input.min = (typeof cap.min !== 'undefined') ? cap.min : DEFAULT_RANGES[ptz].min;
    input.max = (typeof cap.max !== 'undefined') ? cap.max : DEFAULT_RANGES[ptz].max;
    input.step = (typeof cap.step !== 'undefined') ? cap.step : DEFAULT_RANGES[ptz].step;
    input.value = (typeof sett !== 'undefined') ? sett : input.min;
    input.disabled = false;
    supported[ptz] = true;

    const fineStep = Math.max(Number(input.step) / 10, (Number(input.max) - Number(input.min)) / 1000) * SPEED_MULT;
    input.dataset.fineStep = fineStep;

    const formatValue = v => {
      const n = Number(v);
      if (!Number.isFinite(n)) return String(v);
      const precision = Math.max(0, Math.min(6, Math.ceil(-Math.log10(Number(input.step) || 0.001))));
      return n.toFixed(precision);
    };
    if (display) display.textContent = formatValue(input.value);

    input.oninput = async event => {
      const val = Number(event.target.value);
      if (display) display.textContent = formatValue(val);
      if (track) {
        try { await track.applyConstraints({advanced: [{[ptz]: val}]}); }
        catch (err) { console.error('applyConstraints() failed: ', err); }
      }
    };

    if (stepUp) stepUp.addEventListener('click', async () => {
      const cur = Number(input.value);
      const next = Math.min(Number(input.max), cur + Number(input.dataset.fineStep));
      input.value = next;
      if (display) display.textContent = formatValue(next);
      if (track) {
        try { await track.applyConstraints({advanced: [{[ptz]: next}]}); }
        catch (err) { console.error('applyConstraints() failed: ', err); }
      }
    });

    if (stepDown) stepDown.addEventListener('click', async () => {
      const cur = Number(input.value);
      const next = Math.max(Number(input.min), cur - Number(input.dataset.fineStep));
      input.value = next;
      if (display) display.textContent = formatValue(next);
      if (track) {
        try { await track.applyConstraints({advanced: [{[ptz]: next}]}); }
        catch (err) { console.error('applyConstraints() failed: ', err); }
      }
    });
  }

  try { setupPresetUI(track, supported); } catch (err) { console.error('setupPresetUI error', err); }
  try { setupKeyboardControls(track, supported); } catch (err) { console.error('setupKeyboardControls error', err); }
}

// Preset management (stored in localStorage). Defensive: only operates when UI exists.
const PRESET_KEY = 'ptz-presets-v1';

function setupPresetUI(track, supported) {
  const nameInput = document.querySelector('#presetName');
  const saveBtn = document.querySelector('#savePreset');
  const presetList = document.querySelector('#presetList');
  const applyBtn = document.querySelector('#applyPreset');
  const deleteBtn = document.querySelector('#deletePreset');

  const anySupported = Object.values(supported).some(v => v);
  if (saveBtn) saveBtn.disabled = !anySupported;

  const loadPresets = () => {
    try { const raw = localStorage.getItem(PRESET_KEY); return raw ? JSON.parse(raw) : []; }
    catch (e) { return []; }
  };

  const savePresets = (arr) => {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(arr)); } catch (e) { console.error(e); }
  };

  const renderList = () => {
    if (!presetList) return;
    const arr = loadPresets();
    presetList.innerHTML = '';
    arr.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = p.name;
      presetList.appendChild(opt);
    });
    if (applyBtn) applyBtn.disabled = arr.length === 0;
    if (deleteBtn) deleteBtn.disabled = arr.length === 0;
  };

  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const name = nameInput ? (nameInput.value || `Preset ${new Date().toLocaleString()}`).trim() : `Preset ${new Date().toLocaleString()}`;
    const entries = {};
    for (const ptz of ['pan','tilt','zoom']) {
      const input = document.querySelector(`input[name=${ptz}]`);
      if (input && !input.disabled) entries[ptz] = Number(input.value);
    }
    const arr = loadPresets();
    arr.push({name, values: entries});
    savePresets(arr);
    if (nameInput) nameInput.value = '';
    renderList();
  });

  if (applyBtn) applyBtn.addEventListener('click', async () => {
    if (!presetList) return;
    const idx = Number(presetList.value);
    const arr = loadPresets();
    const p = arr[idx];
    if (!p) return;
    const c = {};
    for (const k of Object.keys(p.values)) {
      const input = document.querySelector(`input[name=${k}]`);
      if (input && !input.disabled) c[k] = p.values[k];
    }
    if (Object.keys(c).length === 0) return;
    try {
      if (track) {
        await track.applyConstraints({advanced: [c]});
        const s = track.getSettings();
        for (const k of ['pan','tilt','zoom']) {
          const input = document.querySelector(`input[name=${k}]`);
          const disp = document.querySelector(`.value[data-for=${k}]`);
          if (input && disp && s[k] !== undefined) {
            input.value = s[k];
            disp.textContent = Number(s[k]).toFixed(3).replace(/\.0+$/, '');
          }
        }
      } else {
        // No camera: just update sliders from preset values
        for (const k of Object.keys(c)) {
          const input = document.querySelector(`input[name=${k}]`);
          const disp = document.querySelector(`.value[data-for=${k}]`);
          if (input) input.value = c[k];
          if (disp) {
            const precision = Math.max(0, Math.min(6, Math.ceil(-Math.log10(Number(input.step) || 0.001))));
            disp.textContent = Number(c[k]).toFixed(precision);
          }
        }
      }
    } catch (err) { console.error('applyConstraints() failed: ', err); }
  });

  if (deleteBtn) deleteBtn.addEventListener('click', () => {
    if (!presetList) return;
    const idx = Number(presetList.value);
    const arr = loadPresets();
    if (arr[idx]) { arr.splice(idx, 1); savePresets(arr); renderList(); }
  });

  renderList();
}

// Keyboard controls: arrow keys adjust pan/tilt by the fine step.
function setupKeyboardControls(track, supported) {
  const panInput = document.querySelector('input[name=pan]');
  const tiltInput = document.querySelector('input[name=tilt]');
  const zoomInput = document.querySelector('input[name=zoom]');
  const panSupported = !!(panInput && !panInput.disabled && supported.pan);
  const tiltSupported = !!(tiltInput && !tiltInput.disabled && supported.tilt);
  const zoomSupported = !!(zoomInput && !zoomInput.disabled && supported.zoom);
  if (!panSupported && !tiltSupported && !zoomSupported) return;

  const keyHandler = async (ev) => {
    // Allow Enter to trigger Apply and ',' / '.' to change selected preset.
    const presetList = document.querySelector('#presetList');
    const applyBtn = document.querySelector('#applyPreset');
    // If Enter pressed, trigger Apply (if available) and return.
    if (ev.key === 'Enter') {
      if (applyBtn && !applyBtn.disabled) {
        ev.preventDefault();
        applyBtn.click();
      }
      return;
    }

    // Handle preset selection with ',' and '.' (don't interfere while typing into other inputs)
    if (ev.key === ',' || ev.key === '.') {
      if (!presetList) return;
      const active = document.activeElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (isTyping && active !== presetList) return;
      const len = presetList.options.length;
      if (len === 0) return;
      ev.preventDefault();
      const cur = Number(presetList.value) || 0;
      let nextIdx = cur + (ev.key === '.' ? 1 : -1);
      nextIdx = ((nextIdx % len) + len) % len;
      presetList.value = String(nextIdx);
      presetList.dispatchEvent(new Event('change'));
      return;
    }

    let axis = null;
    let delta = 0;
    if (ev.key === 'ArrowLeft' && panSupported) {
      axis = 'pan';
      delta = -Number(panInput.dataset.fineStep || (panInput.step / 10));
    } else if (ev.key === 'ArrowRight' && panSupported) {
      axis = 'pan';
      delta = Number(panInput.dataset.fineStep || (panInput.step / 10));
    } else if (ev.key === 'ArrowUp' && tiltSupported) {
      axis = 'tilt';
      delta = Number(tiltInput.dataset.fineStep || (tiltInput.step / 10));
    } else if (ev.key === 'ArrowDown' && tiltSupported) {
      axis = 'tilt';
      delta = -Number(tiltInput.dataset.fineStep || (tiltInput.step / 10));
    } else if ((ev.code === 'NumpadAdd' || ev.key === '+' || ev.key === 'Add') && zoomSupported) {
      axis = 'zoom';
      delta = Number(zoomInput.dataset.fineStep || (zoomInput.step / 10));
    } else if ((ev.code === 'NumpadSubtract' || ev.key === '-' || ev.key === 'Subtract' || ev.key === '_') && zoomSupported) {
      axis = 'zoom';
      delta = -Number(zoomInput.dataset.fineStep || (zoomInput.step / 10));
    } else {
      return; // not a handled key
    }
    ev.preventDefault();
    const input = document.querySelector(`input[name=${axis}]`);
    const disp = document.querySelector(`.value[data-for=${axis}]`);
    if (!input) return;
    const cur = Number(input.value);
    const next = Math.min(Number(input.max), Math.max(Number(input.min), cur + delta));
    input.value = next;
    if (disp) {
      const precision = Math.max(0, Math.min(6, Math.ceil(-Math.log10(Number(input.step) || 0.001))));
      disp.textContent = Number(next).toFixed(precision);
    }
    try {
      if (track) await track.applyConstraints({advanced: [{[axis]: next}]});
    } catch (err) {
      console.error('applyConstraints() failed: ', err);
    }
  };

  window.addEventListener('keydown', keyHandler);
}


function handleError(error) {
  if (error.name === 'NotAllowedError') {
    errorMsg('Permissions have not been granted to use your camera, ' +
      'you need to allow the page access to your devices in ' +
      'order for the site to work.');
  }
  errorMsg(`getUserMedia error: ${error.name}`, error);
}

function errorMsg(msg, error) {
  const errorElement = document.querySelector('#errorMsg');
  errorElement.innerHTML += `<p>${msg}</p>`;
  if (typeof error !== 'undefined') {
    console.error(error);
  }
}

async function init(e) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    handleSuccess(stream);
    e.target.disabled = true;
  } catch (e) {
    handleError(e);
  }
}

document.querySelector('#showVideo').addEventListener('click', e => init(e));

// Initialize controls immediately in standalone mode (no camera required).
try { initControls(null); } catch (err) { console.error('initControls error', err); }
