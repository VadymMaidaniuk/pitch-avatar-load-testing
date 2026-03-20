import { basename } from 'node:path';

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

export type CmsTestUser = {
  email: string;
  index: number;
  password: string;
};

type RegexPatternInput = RegExp | RegExp[] | null | undefined;

type CmsTestUserSelectionInput = {
  config?: object;
  currentTitle: string;
  filePath: string;
  grep?: RegexPatternInput;
  grepInvert?: RegexPatternInput;
  projectName: string;
  titles: string[];
};

type CmsInternalCliFilters = {
  cliGrep?: string;
  cliGrepInvert?: string;
};

const DEFAULT_PAD = 2;
const DEFAULT_START_INDEX = 1;

export const CMS_TEST_USER_PREFIX = stringEnv('CMS_LOAD_USER_PREFIX');
export const CMS_TEST_USER_DOMAIN = stringEnv('CMS_LOAD_USER_DOMAIN');
export const CMS_TEST_USER_PASSWORD = stringEnv('CMS_LOAD_USER_PASSWORD');
export const CMS_TEST_USER_PAD = intEnv('CMS_LOAD_USER_PAD', DEFAULT_PAD) ?? DEFAULT_PAD;
export const CMS_TEST_USER_START_INDEX =
  intEnv('CMS_LOAD_USER_START_INDEX', DEFAULT_START_INDEX) ?? DEFAULT_START_INDEX;

export const hasCmsTestUserConfig = (): boolean =>
  Boolean(CMS_TEST_USER_PREFIX && CMS_TEST_USER_DOMAIN && CMS_TEST_USER_PASSWORD);

export const assertCmsTestUserConfig = (): void => {
  if (!hasCmsTestUserConfig()) {
    throw new Error(
      'CMS test-user credentials are required. Set CMS_LOAD_USER_PREFIX, CMS_LOAD_USER_DOMAIN, and CMS_LOAD_USER_PASSWORD.',
    );
  }
};

const buildCmsTestUser = (index: number): CmsTestUser => {
  assertCmsTestUserConfig();

  const suffix = String(index).padStart(CMS_TEST_USER_PAD, '0');

  return {
    email: `${CMS_TEST_USER_PREFIX}${suffix}@${CMS_TEST_USER_DOMAIN}`,
    index,
    password: CMS_TEST_USER_PASSWORD!,
  };
};

export const getCmsTestUserByOffset = (offset: number): CmsTestUser => {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`CMS test user offset must be a non-negative integer, got "${offset}".`);
  }

  return buildCmsTestUser(CMS_TEST_USER_START_INDEX + offset);
};

export const buildCmsTestUsers = (count: number): CmsTestUser[] => {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`CMS test user count must be a positive integer, got "${count}".`);
  }

  return Array.from({ length: count }, (_, offset) => getCmsTestUserByOffset(offset));
};

const normalizeRegexPatterns = (patterns?: RegexPatternInput): RegExp[] => {
  if (!patterns) return [];
  return Array.isArray(patterns) ? patterns : [patterns];
};

const matchesAnyPattern = (value: string, patterns: RegExp[]): boolean => {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) return true;
  }

  return false;
};

const forceRegExp = (pattern: string): RegExp => {
  const match = pattern.match(/^\/(.*)\/([gi]*)$/);
  if (match) {
    return new RegExp(match[1], match[2]);
  }

  return new RegExp(pattern, 'gi');
};

const readCliOptionValues = (longName: string, shortName?: string): string[] => {
  const values: string[] = [];

  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === longName || (shortName && arg === shortName)) {
      const nextValue = process.argv[index + 1];
      if (nextValue) values.push(nextValue);
      continue;
    }

    if (arg.startsWith(`${longName}=`)) {
      values.push(arg.slice(longName.length + 1));
      continue;
    }

    if (shortName && arg.startsWith(`${shortName}=`)) {
      values.push(arg.slice(shortName.length + 1));
    }
  }

  return values;
};

const readCliRegexPatterns = (longName: string, shortName?: string): RegExp[] =>
  readCliOptionValues(longName, shortName).map(forceRegExp);

const readEnvRegexPatterns = (name: string): RegExp[] => {
  const raw = process.env[name]?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === 'string').map(forceRegExp);
    }
  } catch {
    return [forceRegExp(raw)];
  }

  return [];
};

const readCliFiltersFromConfig = (config?: object): CmsInternalCliFilters => {
  if (!config) return {};

  for (const symbol of Object.getOwnPropertySymbols(config)) {
    const candidate = (config as Record<symbol, unknown>)[symbol];
    if (!candidate || typeof candidate !== 'object') continue;
    const internalConfig = candidate as {
      cliGrep?: unknown;
      cliGrepInvert?: unknown;
    };

    const cliGrep = typeof internalConfig.cliGrep === 'string'
      ? internalConfig.cliGrep
      : undefined;
    const cliGrepInvert = typeof internalConfig.cliGrepInvert === 'string'
      ? internalConfig.cliGrepInvert
      : undefined;

    if (cliGrep || cliGrepInvert) {
      return { cliGrep, cliGrepInvert };
    }
  }

  return {};
};

const buildGrepTitle = (
  projectName: string,
  filePath: string,
  title: string,
): string => [projectName, basename(filePath), title].filter(Boolean).join(' ');

const filterScenarioTitles = (input: CmsTestUserSelectionInput): string[] => {
  const projectGrepPatterns = normalizeRegexPatterns(input.grep);
  const projectGrepInvertPatterns = normalizeRegexPatterns(input.grepInvert);
  const envGrepPatterns = readEnvRegexPatterns('PW_TEST_CLI_GREP');
  const envGrepInvertPatterns = readEnvRegexPatterns('PW_TEST_CLI_GREP_INVERT');
  const cliFilters = readCliFiltersFromConfig(input.config);
  const cliGrepPatterns = envGrepPatterns.length
    ? envGrepPatterns
    : cliFilters.cliGrep
      ? [forceRegExp(cliFilters.cliGrep)]
      : readCliRegexPatterns('--grep', '-g');
  const cliGrepInvertPatterns = envGrepInvertPatterns.length
    ? envGrepInvertPatterns
    : cliFilters.cliGrepInvert
      ? [forceRegExp(cliFilters.cliGrepInvert)]
      : readCliRegexPatterns('--grep-invert');

  return input.titles.filter((title) => {
    const grepTitle = buildGrepTitle(input.projectName, input.filePath, title);
    if (matchesAnyPattern(grepTitle, projectGrepInvertPatterns)) return false;
    if (projectGrepPatterns.length && !matchesAnyPattern(grepTitle, projectGrepPatterns)) return false;
    if (matchesAnyPattern(grepTitle, cliGrepInvertPatterns)) return false;
    if (cliGrepPatterns.length && !matchesAnyPattern(grepTitle, cliGrepPatterns)) return false;
    return true;
  });
};

export const getCmsTestUserForSelection = (input: CmsTestUserSelectionInput): CmsTestUser => {
  const selectedTitles = filterScenarioTitles(input);
  const effectiveTitles = selectedTitles.length ? selectedTitles : input.titles;
  const selectedOffset = effectiveTitles.indexOf(input.currentTitle);
  const fallbackOffset = input.titles.indexOf(input.currentTitle);
  const resolvedOffset = selectedOffset !== -1
    ? selectedOffset
    : fallbackOffset !== -1
      ? fallbackOffset
      : 0;

  return getCmsTestUserByOffset(resolvedOffset);
};
