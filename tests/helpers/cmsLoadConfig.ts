import {
  CMS_CHAT_AVATAR_SCENARIO_NAMES,
  type CmsChatAvatarScenarioName,
} from './chatAvatarScenarios';
import {
  assertCmsTestUserConfig,
  buildCmsTestUsers,
  type CmsTestUser,
} from './cmsTestUsers';

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

export type CmsLoadUser = CmsTestUser;

const DEFAULT_SCENARIO: CmsChatAvatarScenarioName = 'pdf_s_10_no_kb';

export const CMS_LOAD_SCENARIO =
  (stringEnv('CMS_LOAD_SCENARIO') as CmsChatAvatarScenarioName | undefined) ?? DEFAULT_SCENARIO;
export const CMS_LOAD_USERS = intEnv('CMS_LOAD_USERS', 1) ?? 1;
export const CMS_LOAD_WORKERS = intEnv('CMS_LOAD_WORKERS', CMS_LOAD_USERS) ?? CMS_LOAD_USERS;
const validScenarios: CmsChatAvatarScenarioName[] = [...CMS_CHAT_AVATAR_SCENARIO_NAMES];

export const assertCmsLoadConfig = (): void => {
  if (!validScenarios.includes(CMS_LOAD_SCENARIO)) {
    throw new Error(
      `Unsupported CMS_LOAD_SCENARIO "${CMS_LOAD_SCENARIO}". Allowed values: ${validScenarios.join(', ')}`,
    );
  }

  assertCmsTestUserConfig();

  if (CMS_LOAD_WORKERS > CMS_LOAD_USERS) {
    throw new Error(
      `CMS_LOAD_WORKERS (${CMS_LOAD_WORKERS}) cannot be greater than CMS_LOAD_USERS (${CMS_LOAD_USERS}).`,
    );
  }
};

export const buildCmsLoadUsers = (): CmsLoadUser[] => {
  assertCmsLoadConfig();
  return buildCmsTestUsers(CMS_LOAD_USERS);
};
