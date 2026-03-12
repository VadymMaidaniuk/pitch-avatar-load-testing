import {
  CMS_CHAT_AVATAR_SCENARIO_NAMES,
  type CmsChatAvatarScenarioName,
} from './chatAvatarScenarios';

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

export type CmsLoadUser = {
  email: string;
  index: number;
  password: string;
};

const DEFAULT_SCENARIO: CmsChatAvatarScenarioName = 'pdf_s_10_no_kb';
const DEFAULT_PAD = 2;
const DEFAULT_START_INDEX = 1;

export const CMS_LOAD_SCENARIO =
  (stringEnv('CMS_LOAD_SCENARIO') as CmsChatAvatarScenarioName | undefined) ?? DEFAULT_SCENARIO;
export const CMS_LOAD_USERS = intEnv('CMS_LOAD_USERS', 1) ?? 1;
export const CMS_LOAD_WORKERS = intEnv('CMS_LOAD_WORKERS', CMS_LOAD_USERS) ?? CMS_LOAD_USERS;
export const CMS_LOAD_USER_PREFIX = stringEnv('CMS_LOAD_USER_PREFIX');
export const CMS_LOAD_USER_DOMAIN = stringEnv('CMS_LOAD_USER_DOMAIN');
export const CMS_LOAD_USER_PASSWORD = stringEnv('CMS_LOAD_USER_PASSWORD');
export const CMS_LOAD_USER_PAD = intEnv('CMS_LOAD_USER_PAD', DEFAULT_PAD) ?? DEFAULT_PAD;
export const CMS_LOAD_USER_START_INDEX =
  intEnv('CMS_LOAD_USER_START_INDEX', DEFAULT_START_INDEX) ?? DEFAULT_START_INDEX;

const validScenarios: CmsChatAvatarScenarioName[] = [...CMS_CHAT_AVATAR_SCENARIO_NAMES];

export const assertCmsLoadConfig = (): void => {
  if (!validScenarios.includes(CMS_LOAD_SCENARIO)) {
    throw new Error(
      `Unsupported CMS_LOAD_SCENARIO "${CMS_LOAD_SCENARIO}". Allowed values: ${validScenarios.join(', ')}`,
    );
  }

  if (!CMS_LOAD_USER_PREFIX || !CMS_LOAD_USER_DOMAIN || !CMS_LOAD_USER_PASSWORD) {
    throw new Error(
      'CMS load credentials are required. Set CMS_LOAD_USER_PREFIX, CMS_LOAD_USER_DOMAIN, and CMS_LOAD_USER_PASSWORD.',
    );
  }

  if (CMS_LOAD_WORKERS > CMS_LOAD_USERS) {
    throw new Error(
      `CMS_LOAD_WORKERS (${CMS_LOAD_WORKERS}) cannot be greater than CMS_LOAD_USERS (${CMS_LOAD_USERS}).`,
    );
  }
};

export const buildCmsLoadUsers = (): CmsLoadUser[] => {
  assertCmsLoadConfig();

  return Array.from({ length: CMS_LOAD_USERS }, (_, offset) => {
    const index = CMS_LOAD_USER_START_INDEX + offset;
    const suffix = String(index).padStart(CMS_LOAD_USER_PAD, '0');

    return {
      email: `${CMS_LOAD_USER_PREFIX}${suffix}@${CMS_LOAD_USER_DOMAIN}`,
      index,
      password: CMS_LOAD_USER_PASSWORD!,
    };
  });
};
