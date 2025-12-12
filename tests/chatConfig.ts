const intEnv = (name: string, fallback?: number): number | undefined => {
  const raw = process.env[name];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

export const CHAT_URL = process.env.CHAT_URL ?? 'https://slides.pitchavatar.com/osnol';
export const API_BASE_URL = process.env.API_BASE_URL ?? 'https://api.pitchavatar.com';
export const WS_BASE_URL = process.env.WS_BASE_URL ?? 'wss://haproxy-prod.pitchavatar.com';
export const SCR_SHORT_LINK = process.env.SCR_SHORT_LINK ?? 'osnol';

export const UI_USERS = intEnv('CHAT_UI_USERS', intEnv('CHAT_TEST_USERS', 1)) ?? 1;

export const UI_ASSIST_TIMEOUT_MS = intEnv('CHAT_ASSIST_TIMEOUT_MS', 60_000) ?? 60_000;
export const WS_ASSIST_TIMEOUT_MS = intEnv('CHAT_WS_ASSIST_TIMEOUT_MS', 45_000) ?? 45_000;

export const RUN_ID = process.env.CHAT_RUN_ID ?? `${Date.now()}`;
export const WORKERS = intEnv('CHAT_WORKERS');
