const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS: Record<string, any> = {
  atemIp: process.env.ATEM_IP || '192.168.10.240',
  inputNumber: parseInt(process.env.ATEM_INPUT || '1', 10),
  displayId: process.env.ATEM_DISPLAY_ID ? parseInt(process.env.ATEM_DISPLAY_ID, 10) : null,
  overlayStyle: 'border',
  borderWidth: 14,
  overlayShowLabel: true,
  webServerPort: parseInt(process.env.WEB_PORT || '8090', 10),
};

let cache: Record<string, any> | null = null;

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load(): Record<string, any> {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function ensure(): Record<string, any> {
  if (!cache) cache = load();
  return cache;
}

function persist(): void {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    /* ignore */
  }
}

export const store = {
  get(key: string): any {
    return ensure()[key];
  },
  set(key: string, value: any): void {
    ensure()[key] = value;
    persist();
  },
};
