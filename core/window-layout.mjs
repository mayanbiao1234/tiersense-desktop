export const ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
export function nextZoom(current, direction) {
  if (direction === 0) return 1;
  return direction > 0 ? ZOOM_LEVELS.find(v => v > current + 0.001) ?? 1.5
    : ZOOM_LEVELS.findLast(v => v < current - 0.001) ?? 0.8;
}

export function initialWindowBounds(workArea) {
  const width = Math.min(1320, Math.max(1, workArea.width - 32));
  const height = Math.min(880, Math.max(1, workArea.height - 32));
  return { width, height, minWidth: Math.min(800, width), minHeight: Math.min(560, height),
    x: Math.round(workArea.x + (workArea.width - width) / 2), y: Math.round(workArea.y + (workArea.height - height) / 2) };
}

export function validWindowState(value) {
  const b = value?.bounds;
  return value?.version === 1 && typeof value.maximized === 'boolean' && b
    && ['x', 'y', 'width', 'height'].every(k => Number.isInteger(b[k]) && Math.abs(b[k]) <= 100000)
    && b.width >= 300 && b.height >= 200 && b.width <= 16000 && b.height <= 16000;
}

export function restoredWindowBounds(workAreas, fallbackArea, saved) {
  if (!validWindowState(saved)) return initialWindowBounds(fallbackArea);
  const b = saved.bounds;
  const overlap = area => Math.max(0, Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x))
    * Math.max(0, Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y));
  const matching = [...workAreas].sort((a, z) => overlap(z) - overlap(a))[0];
  const area = matching && overlap(matching) > 0 ? matching : fallbackArea;
  const initial = initialWindowBounds(area);
  const width = Math.min(area.width, Math.max(initial.minWidth, b.width));
  const height = Math.min(area.height, Math.max(initial.minHeight, b.height));
  return { ...initial, width, height,
    x: Math.max(area.x, Math.min(b.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(b.y, area.y + area.height - height)) };
}
