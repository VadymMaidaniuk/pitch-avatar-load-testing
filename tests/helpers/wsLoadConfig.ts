import fs from 'node:fs';
import { QUESTION_POOL } from './chatQuestions';
import { ENV_DEFAULTS } from './chatConfig';

export type LoadScenario = { name: string; sessions: number; questions: number };
export type WsLoadConfig = {
  environment: 'dev' | 'stage' | 'prod';
  chatUrl: string;
  apiBaseUrl: string;
  wsBaseUrl: string;
  shortLink: string;
  scenarios: LoadScenario[];
  questions: readonly string[];
  parallelQuestionIds: readonly number[] | null;
  languageId: string;
  connectTimeoutMs: number;
  responseTimeoutMs: number;
  setupTimeoutMs: number;
  setupConcurrency: number;
  setupAttempts: number;
  settleMs: number;
  requireCacheDisabled: boolean;
};

export function readWsLoadConfig(env: NodeJS.ProcessEnv = process.env): WsLoadConfig {
  const environment = env.CHAT_ENV;
  if (environment !== 'dev' && environment !== 'stage' && environment !== 'prod') {
    throw new Error('Set CHAT_ENV explicitly to dev, stage or prod for WS load tests.');
  }
  const defaults = ENV_DEFAULTS[environment];
  const chatHost = new URL(defaults.chatUrl).host;
  // Deliberately do not fall back to old CHAT_URL / SCR_SHORT_LINK or .env links.
  if (!env.WS_LOAD_CHAT_URL) throw new Error('Set WS_LOAD_CHAT_URL to the fresh avatar link.');
  const url = new URL(env.WS_LOAD_CHAT_URL);
  if (url.protocol !== 'https:' || url.host !== chatHost || url.username || url.password) {
    throw new Error(`WS_LOAD_CHAT_URL must be an HTTPS link on ${chatHost}.`);
  }
  const shortLink = url.pathname.replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9_-]+$/.test(shortLink)) {
    throw new Error('WS_LOAD_CHAT_URL must contain one avatar short-link path segment.');
  }
  const positiveInt = (key: string, fallback: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer.`);
    return value;
  };
  const parallelQuestions = positiveInt('WS_LOAD_PARALLEL_QUESTIONS', 3);
  if (![2, 3].includes(parallelQuestions)) throw new Error('WS_LOAD_PARALLEL_QUESTIONS must be 2 or 3.');
  const all: LoadScenario[] = [
    { name: 'chain-1x25', sessions: 1, questions: 25 },
    ...[10, 20, 50].map((sessions) => ({ name: `parallel-${sessions}`, sessions, questions: parallelQuestions })),
  ];
  const selection = (env.WS_LOAD_SCENARIOS ?? 'all').split(',').map((value) => value.trim());
  if (new Set(selection).size !== selection.length ||
      (selection.includes('all') && selection.length !== 1) ||
      selection.some((name) => name !== 'all' && !all.some((scenario) => scenario.name === name))) {
    throw new Error('WS_LOAD_SCENARIOS: use all or a comma-separated subset of chain-1x25,parallel-10,parallel-20,parallel-50.');
  }
  const scenarios = selection[0] === 'all' ? all : all.filter((scenario) => selection.includes(scenario.name));
  const questions: unknown = env.WS_LOAD_QUESTIONS_FILE
    ? JSON.parse(fs.readFileSync(env.WS_LOAD_QUESTIONS_FILE, 'utf8').replace(/^\uFEFF/, ''))
    : QUESTION_POOL;
  if (!Array.isArray(questions) || questions.length < 25 ||
      questions.some((question) => typeof question !== 'string' || !question.trim())) {
    throw new Error('Question file must be a JSON array of at least 25 nonempty strings.');
  }
  const parallelQuestionIds = env.WS_LOAD_PARALLEL_QUESTION_IDS
    ? env.WS_LOAD_PARALLEL_QUESTION_IDS.split(',').map(value => Number(value.trim())) : null;
  if (parallelQuestionIds && (parallelQuestionIds.length !== parallelQuestions ||
      new Set(parallelQuestionIds).size !== parallelQuestionIds.length ||
      parallelQuestionIds.some(id => !Number.isSafeInteger(id) || id < 1 || id > questions.length))) {
    throw new Error('WS_LOAD_PARALLEL_QUESTION_IDS must contain one distinct 1-based question ID per parallel turn.');
  }
  const languageId = env.WS_LOAD_LANGUAGE ?? 'en';
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(languageId)) throw new Error('WS_LOAD_LANGUAGE must be a language code such as en.');
  const settleMs = positiveInt('WS_LOAD_SETTLE_MS', 1000);
  const setupTimeoutMs = positiveInt('WS_LOAD_SETUP_TIMEOUT_MS', 60_000);
  const cachePolicy = env.WS_LOAD_REQUIRE_CACHE_DISABLED ?? '0';
  if (!['0', '1'].includes(cachePolicy)) throw new Error('WS_LOAD_REQUIRE_CACHE_DISABLED must be 0 or 1.');
  if (settleMs >= setupTimeoutMs) throw new Error('WS_LOAD_SETTLE_MS must be smaller than WS_LOAD_SETUP_TIMEOUT_MS.');
  return {
    environment,
    chatUrl: `${url.origin}/${shortLink}`,
    shortLink,
    apiBaseUrl: defaults.apiBase,
    wsBaseUrl: defaults.wsBase,
    scenarios,
    questions: questions as string[],
    parallelQuestionIds,
    languageId,
    connectTimeoutMs: positiveInt('WS_LOAD_CONNECT_TIMEOUT_MS', 15_000),
    responseTimeoutMs: positiveInt('WS_LOAD_RESPONSE_TIMEOUT_MS', 60_000),
    setupTimeoutMs,
    setupConcurrency: positiveInt('WS_LOAD_SETUP_CONCURRENCY', 1),
    setupAttempts: positiveInt('WS_LOAD_SETUP_ATTEMPTS', 1),
    settleMs,
    requireCacheDisabled: cachePolicy === '1',
  };
}
