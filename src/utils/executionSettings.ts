import fs from 'fs';
import path from 'path';
import { TradingMode } from './tradierConfig';

export type ExecutionSettings = {
  paper: boolean;
  live: boolean;
};

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'execution.json');

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function readFileSettings(): ExecutionSettings | null {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as {
      paper?: unknown;
      live?: unknown;
    };
    return {
      paper: Boolean(parsed.paper),
      live: Boolean(parsed.live),
    };
  } catch {
    return null;
  }
}

function envDefaults(): ExecutionSettings {
  return {
    paper: envFlag('PAPER_EXECUTION_ENABLED', false),
    live: envFlag('LIVE_EXECUTION_ENABLED', false),
  };
}

export function getExecutionSettings(): ExecutionSettings {
  return readFileSettings() ?? envDefaults();
}

export function isExecutionEnabled(mode: TradingMode): boolean {
  const settings = getExecutionSettings();
  return mode === 'live' ? settings.live : settings.paper;
}

export function setExecutionSettings(
  patch: Partial<ExecutionSettings>
): ExecutionSettings {
  const next: ExecutionSettings = {
    ...getExecutionSettings(),
    ...patch,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function assertExecutionEnabled(mode: TradingMode): void {
  if (!isExecutionEnabled(mode)) {
    throw new Error(
      `${mode} order execution is disabled. Enable it on the desk before placing orders.`
    );
  }
}
