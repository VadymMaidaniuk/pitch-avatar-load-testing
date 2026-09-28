type EnvName = 'dev' | 'stage' | 'prod';

const intEnv = (name: string, fallback?: number): number | undefined => {
  const raw = process.env[name];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

const stringEnv = (name: string): string | undefined => {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
};

const rawEnv =
  process.env.CHAT_ENV ??
  process.env.NODE_ENV ??
  'prod';

// Normalize to a limited set of envs to keep behavior predictable.
const CHAT_ENV: EnvName = rawEnv.toLowerCase().includes('stage')
  ? 'stage'
  : rawEnv.toLowerCase().includes('dev')
    ? 'dev'
    : 'prod';

export const ENV_DEFAULTS: Record<
  EnvName,
  { chatUrl: string; shortLink: string; apiBase: string; wsBase: string }
> = {
  dev: {
    chatUrl: 'https://slides-dev.pitchavatar.com/aug2s',
    shortLink: 'aug2s',
    apiBase: 'https://api-dev.pitchavatar.com',
    wsBase: 'wss://haproxy-dev.pitchavatar.com',
  },
  stage: {
    chatUrl: 'https://slides-staging.pitchavatar.com/a42ee',
    shortLink: 'a42ee',
    apiBase: 'https://api-staging.pitchavatar.com',
    wsBase: 'wss://haproxy-stage.pitchavatar.com',
  },
  prod: {
    chatUrl: 'https://slides.pitchavatar.com/osnol',
    shortLink: 'osnol',
    apiBase: 'https://api.pitchavatar.com',
    wsBase: 'wss://haproxy-prod.pitchavatar.com',
  },
};

const pick = <K extends keyof (typeof ENV_DEFAULTS)[EnvName]>(
  key: K,
  override?: string,
): string => {
  if (override) return override;
  return ENV_DEFAULTS[CHAT_ENV][key] ?? ENV_DEFAULTS.prod[key];
};

export const CHAT_URL = pick('chatUrl', process.env.CHAT_URL);
export const API_BASE_URL = pick('apiBase', process.env.API_BASE_URL);
export const WS_BASE_URL = pick('wsBase', process.env.WS_BASE_URL);
export const SCR_SHORT_LINK = pick('shortLink', process.env.SCR_SHORT_LINK);
export const CMS_API_BASE_URL = `${API_BASE_URL}/api/cms`;

export const UI_USERS = intEnv('CHAT_UI_USERS', 1) ?? 1;

export const CMS_EMAIL = stringEnv('CMS_EMAIL');
export const CMS_PASSWORD = stringEnv('CMS_PASSWORD');
