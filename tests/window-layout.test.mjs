import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWindowBounds, nextZoom, restoredWindowBounds, validWindowState } from '../core/window-layout.mjs';
import { defaults, settingsInput, migrateConfig } from '../core/config.mjs';

test('initial window and resize constraints fit small, portrait and offset display work areas', () => {
  for (const workArea of [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: 0, y: 0, width: 1024, height: 728 },
    { x: 0, y: 0, width: 853, height: 480 },
    { x: -1080, y: 100, width: 1080, height: 1880 },
  ]) {
    const b = initialWindowBounds(workArea);
    assert.ok(b.x >= workArea.x && b.y >= workArea.y);
    assert.ok(b.x + b.width <= workArea.x + workArea.width);
    assert.ok(b.y + b.height <= workArea.y + workArea.height);
    assert.ok(b.minWidth <= b.width && b.minHeight <= b.height);
    assert.ok(b.width <= 1320 && b.height <= 880);
  }
});

test('remembered window geometry survives restart but stays reachable after monitors or scaling change', () => {
  const primary = { x: 0, y: 0, width: 1280, height: 720 }, second = { x: -1920, y: 0, width: 1920, height: 1080 };
  const saved = { version: 1, maximized: true, bounds: { x: -1700, y: 60, width: 1000, height: 800 } };
  assert(validWindowState(saved));
  assert.deepEqual(restoredWindowBounds([primary, second], primary, saved), { ...saved.bounds, minWidth: 800, minHeight: 560 });
  const moved = restoredWindowBounds([primary], primary, saved);
  assert(moved.x >= 0 && moved.y >= 0 && moved.x + moved.width <= 1280 && moved.y + moved.height <= 720);
  const tiny = { x: 30, y: 40, width: 620, height: 420 }, resized = restoredWindowBounds([tiny], tiny, saved);
  assert(resized.width <= 620 && resized.height <= 420); assert(resized.x >= 30 && resized.y >= 40);
  for (const invalid of [null, { ...saved, bounds: { ...saved.bounds, width: -1 } }, { ...saved, bounds: { ...saved.bounds, x: Infinity } }, { ...saved, version: 3 }]) {
    assert(!validWindowState(invalid)); assert.deepEqual(restoredWindowBounds([primary], primary, invalid), initialWindowBounds(primary));
  }
});

test('zoom shortcuts clamp at limits and reset regardless of the starting zoom', () => {
  let zoom = 1;
  for (let i = 0; i < 20; i++) zoom = nextZoom(zoom, 1);
  assert.equal(zoom, 1.5);
  for (let i = 0; i < 20; i++) zoom = nextZoom(zoom, -1);
  assert.equal(zoom, 0.8);
  assert.equal(nextZoom(zoom, 0), 1);
  assert.equal(nextZoom(1.1, 1), 1.25);
  assert.equal(nextZoom(1.25, -1), 1.1);
});

test('existing profiles get default zoom and invalid zoom settings are rejected', () => {
  const old = defaults();
  delete old.settings.zoomFactor;
  assert.equal(migrateConfig(old).settings.zoomFactor, 1);
  assert.equal(settingsInput({ zoomFactor: 1.5 }, old.settings).zoomFactor, 1.5);
  for (const zoomFactor of [0, 2, NaN, Infinity, '1']) {
    assert.throws(() => settingsInput({ zoomFactor }, old.settings), /界面缩放/);
  }
});
