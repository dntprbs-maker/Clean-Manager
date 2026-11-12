// Inner dialogs register here so a single back press only dismisses the top layer.
const handlers = [];

export function registerBackLayer(close, priority = 0) {
  const entry = { close, priority };
  handlers.push(entry);
  return () => {
    const index = handlers.indexOf(entry);
    if (index !== -1) handlers.splice(index, 1);
  };
}

export function closeBackLayer() {
  const top = handlers.reduce((best, entry) =>
    !best || entry.priority >= best.priority ? entry : best, null);
  if (!top) return false;
  top.close();
  return true;
}

export function previousScreen(screen) {
  if (screen === 'reg_site_detail') return 'reg_sites';
  if (screen.startsWith('reg_') && screen !== 'reg_hub') return 'reg_hub';
  return 'calendar';
}
