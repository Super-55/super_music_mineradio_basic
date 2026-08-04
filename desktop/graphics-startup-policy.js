'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GRAPHICS_MODES = new Set(['hardware', 'software']);
const GRAPHICS_REASON_CODES = new Set([
  'MR-GPU-WEBGL-CONTEXT',
  'MR-GPU-RENDERER-UNAVAILABLE',
]);

function normalizeGraphicsMode(value) {
  return GRAPHICS_MODES.has(value) ? value : 'hardware';
}

function normalizeGraphicsReason(value) {
  const match = String(value || '').match(/MR-GPU-[A-Z0-9-]+/);
  return match && GRAPHICS_REASON_CODES.has(match[0]) ? match[0] : '';
}

function normalizeUpdatedAt(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text) ? text : '';
}

function defaultGraphicsState() {
  return { mode: 'hardware', reason: '', updatedAt: '' };
}

function readGraphicsState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultGraphicsState();
    return {
      mode: normalizeGraphicsMode(parsed.mode),
      reason: normalizeGraphicsReason(parsed.reason),
      updatedAt: normalizeUpdatedAt(parsed.updatedAt),
    };
  } catch (_) {
    return defaultGraphicsState();
  }
}

function writeGraphicsState(filePath, nextState) {
  const state = {
    mode: normalizeGraphicsMode(nextState && nextState.mode),
    reason: normalizeGraphicsReason(nextState && nextState.reason),
    updatedAt: new Date().toISOString(),
  };
  const directory = path.dirname(filePath);
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tempFile, filePath);
  } finally {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch (_) { }
  }
  return state;
}

function planGraphicsFallback(currentMode) {
  if (normalizeGraphicsMode(currentMode) === 'software') {
    return {
      restart: false,
      mode: 'software',
      code: 'MR-GPU-SOFTWARE-UNAVAILABLE',
    };
  }
  return {
    restart: true,
    mode: 'software',
    code: 'MR-GPU-SOFTWARE-RESTART',
  };
}

module.exports = {
  normalizeGraphicsMode,
  planGraphicsFallback,
  readGraphicsState,
  writeGraphicsState,
};
