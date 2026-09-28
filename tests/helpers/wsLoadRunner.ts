import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { request, type APIRequestContext } from '@playwright/test';
import { ScrApiClient, type ScreeningAssistantMetadata } from '../services/api/ScrApiClient';
import { AvatarTextSession, type TextReply } from '../services/ws/AvatarTextSession';
import type { LoadScenario, WsLoadConfig } from './wsLoadConfig';
import { buildWsLoadQuestion, stripPlainRequestCode } from './wsLoadQuestions';

export type QuestionResult = {
  session: number;
  scrUserID: string | null;
  turn: number;
  question: string;
  questionId: string;
  baseQuestion: string;
  sourceQuestionId: number;
  caseIndex: number;
  startOffsetMs: number | null;
  status: TextReply['status'] | 'skipped';
  reply: TextReply | null;
  error: string | null;
};
export type SessionResult = {
  session: number;
  scrUserID: string | null;
  languageID: string | null;
  sourceScreeningLanguageID: string | null;
  avatar: ScreeningAssistantMetadata | null;
  setupMs: number;
  ready: boolean;
  error: string | null;
  preparationAttempts?: Array<{ attempt: number; scrUserID: string | null; ready: boolean; setupMs: number; error: string | null }>;
};
type PreparedSession = {
  metadata: SessionResult;
  connection: AvatarTextSession | null;
};

export async function prepareWsLoadSession(config: WsLoadConfig, session: number): Promise<PreparedSession> {
  const started = performance.now();
  let context: APIRequestContext | undefined;
  let connection: AvatarTextSession | undefined;
  let scrUserID: string | null = null;
  let languageID: string | null = null;
  let sourceScreeningLanguageID: string | null = null;
  let avatar: ScreeningAssistantMetadata | null = null;
  let phase = 'API context';
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
    void context?.dispose().catch(() => {});
    void connection?.close();
  }, config.setupTimeoutMs);
  try {
    context = await request.newContext({ timeout: config.connectTimeoutMs });
    abort.signal.throwIfAborted();
    const client = new ScrApiClient(context, config.apiBaseUrl, config.shortLink);
    phase = 'API login';
    const login = await client.login();
    scrUserID = login.scrUserID;
    sourceScreeningLanguageID = login.languageID;
    languageID = config.languageId;
    avatar = login.avatar;
    phase = 'cache policy check';
    if (config.requireCacheDisabled && avatar?.cacheEnabled !== false) {
      throw new Error(avatar?.cacheEnabled === true ? 'Avatar cache is enabled' : 'Avatar cache state is unknown');
    }
    if (!login.screeningStepID) throw new Error('Missing screening step');
    phase = 'API parameter initialization';
    await client.initializeScreeningParameters(login.token, languageID);
    abort.signal.throwIfAborted();
    phase = 'WebSocket connect';
    connection = await AvatarTextSession.connect(
      `${config.wsBaseUrl}/ws?scrUserID=${encodeURIComponent(scrUserID)}`,
      config.connectTimeoutMs,
      abort.signal,
    );
    phase = 'screening initialization';
    connection.setParameter('Voice Recognition Status', false);
    connection.setParameter('Presentation Language', languageID);
    connection.setParameter('Listener Language', languageID);
    // Preserve the existing session initialization flow. Measured questions use WS only.
    await client.reportAction(login.token, 'screen_user_started_screening');
    connection.reportAction('screen_user_started_screening');
    connection.reportAction('screen_user_autoplay_off', { screening_step_id: login.screeningStepID });
    connection.reportAction('screen_user_changed_step', { screening_step_id: login.screeningStepID });
    phase = 'startup text settling';
    await connection.waitUntilIdle(config.settleMs, config.setupTimeoutMs);
    abort.signal.throwIfAborted();
    return {
      connection,
      metadata: { session, scrUserID, languageID, sourceScreeningLanguageID, avatar, ready: true, setupMs: performance.now() - started, error: null },
    };
  } catch (error) {
    await connection?.close();
    const message = error instanceof Error ? error.message : '';
    const httpStatus = message.match(/failed: (\d{3})\b/)?.[1];
    const networkCode = message.match(/\b(ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)\b/)?.[1];
    const detail = phase === 'cache policy check' && /^Avatar cache (is enabled|state is unknown)$/.test(message) ? message :
      abort.signal.aborted ? 'setup timeout' : httpStatus ? `HTTP ${httpStatus}` :
      /timeout|timed out/i.test(message) ? 'request timeout' : networkCode ??
      (/^Login response missing/.test(message) ? 'login response missing session fields' : 'failed');
    return {
      connection: null,
      metadata: { session, scrUserID, languageID, sourceScreeningLanguageID, avatar, ready: false, setupMs: performance.now() - started, error: `${phase}: ${detail}` },
    };
  } finally {
    clearTimeout(timer);
    await context?.dispose().catch(() => {});
  }
}

export function describeSamples(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
  return {
    count: sorted.length,
    minMs: sorted.length ? sorted[0] : null,
    meanMs: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

export type WsLoadProgress =
  | { phase: 'preparing'; prepared: number; requested: number; ready: number; error: string | null }
  | { phase: 'ready'; readySessions: number; requestedSessions: number; error: string | null }
  | { phase: 'reply'; finishedReplies: number; session: number; turn: number; status: TextReply['status']; firstTextMs: number | null; fullTextMs: number | null };

export async function runWsLoadScenario(config: WsLoadConfig, scenario: LoadScenario, onProgress?: (event: WsLoadProgress) => void) {
  const startedAtUtc = new Date().toISOString();
  const questionRunToken = randomUUID();
  const setupStarted = performance.now();
  const prepared = new Array<PreparedSession>(scenario.sessions);
  let nextSession = 0;
  let preparedCount = 0;
  let readyCount = 0;
  // Session startup is outside the target workload. Avoid an incidental HTTP login/parameter storm.
  await Promise.all(Array.from({ length: Math.min(config.setupConcurrency, scenario.sessions) }, async () => {
    while (nextSession < scenario.sessions) {
      const index = nextSession++;
      const attemptHistory: NonNullable<SessionResult['preparationAttempts']> = [];
      const sessionSetupStarted = performance.now();
      for (let attempt = 1; attempt <= config.setupAttempts; attempt += 1) {
        prepared[index] = await prepareWsLoadSession(config, index + 1);
        const metadata = prepared[index].metadata;
        attemptHistory.push({ attempt, scrUserID: metadata.scrUserID, ready: metadata.ready, setupMs: metadata.setupMs, error: metadata.error });
        const retryable = /HTTP 5\d\d|request timeout|setup timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(metadata.error ?? '');
        if (metadata.ready || !retryable || attempt === config.setupAttempts) break;
        // Bounded backoff for transient setup failures, outside the response measurement window.
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
      prepared[index].metadata.preparationAttempts = attemptHistory;
      prepared[index].metadata.setupMs = performance.now() - sessionSetupStarted;
      preparedCount += 1;
      if (prepared[index].metadata.ready) readyCount += 1;
      onProgress?.({ phase: 'preparing', prepared: preparedCount, requested: scenario.sessions, ready: readyCount, error: prepared[index].metadata.error });
    }
  }));
  const rows: QuestionResult[] = [];
  let inFlight = 0;
  let peakInFlight = 0;
  let finishedReplies = 0;
  let cohortError: string | null = null;
  // Never quietly downgrade a 50-session scenario to a smaller successful cohort.
  const ids = prepared.filter((item) => item.metadata.ready).map((item) => item.metadata.scrUserID);
  if (prepared.some((item) => !item.metadata.ready)) cohortError = 'At least one session failed preparation; cohort was not started.';
  else if (new Set(ids).size !== scenario.sessions) cohortError = 'API login reused scrUserID; sessions are not independent.';
  else {
    try { prepared.forEach((item) => item.connection!.assertOpen()); }
    catch { cohortError = 'A prepared WebSocket closed before the common start.'; }
  }
  const loadStarted = performance.now();
  onProgress?.({ phase: 'ready', readySessions: ids.length, requestedSessions: scenario.sessions, error: cohortError });
  let loadEnded = loadStarted;
  try {
    // All preparation has completed. Each async chain reaches its first WS send in this tick.
    await Promise.all(prepared.map(async ({ metadata, connection }) => {
      let skipReason = cohortError;
      for (let turn = 1; turn <= scenario.questions; turn += 1) {
        const { question, questionId, baseQuestion, sourceQuestionId, caseIndex } = buildWsLoadQuestion(config, scenario, metadata.session, turn, questionRunToken);
        const base = { session: metadata.session, scrUserID: metadata.scrUserID, turn, question, questionId, baseQuestion, sourceQuestionId, caseIndex };
        if (skipReason) {
          rows.push({ ...base, startOffsetMs: null, status: 'skipped', reply: null, error: skipReason });
          continue;
        }
        try {
          connection!.assertOpen();
        } catch {
          skipReason = 'WebSocket unavailable before question send';
          rows.push({ ...base, startOffsetMs: null, status: 'skipped', reply: null, error: skipReason });
          continue;
        }
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        let reply: TextReply;
        try {
          reply = await connection!.ask(question, config.responseTimeoutMs);
        } finally {
          inFlight -= 1;
        }
        rows.push({
          ...base, status: reply.status, reply, error: reply.error,
          startOffsetMs: reply.sentAtMonotonicMs - loadStarted,
        });
        finishedReplies += 1;
        onProgress?.({ phase: 'reply', finishedReplies, session: metadata.session, turn, status: reply.status, firstTextMs: reply.firstTextMs, fullTextMs: reply.fullTextMs });
        // A failed question can leave a late answer in flight. Stop this session to avoid misattribution.
        if (reply.status !== 'ok') skipReason = `Session stopped after turn ${turn}: ${reply.status}`;
      }
    }));
    loadEnded = performance.now();
  } finally {
    await Promise.all(prepared.map((item) => item.connection?.close()));
  }
  rows.sort((a, b) => a.session - b.session || a.turn - b.turn);
  const successful = rows.filter((row) => row.status === 'ok');
  const attempted = rows.filter((row) => row.reply !== null);
  const firstWave = rows.filter((row) => row.turn === 1 && row.startOffsetMs !== null).map((row) => row.startOffsetMs!);
  const responseWindowMs = cohortError ? 0 : loadEnded - loadStarted;
  const summarizeTiming = (subset: QuestionResult[]) => ({
    firstText: describeSamples(subset.map((row) => row.reply!.firstTextMs!).filter((value) => value !== null)),
    fullText: describeSamples(subset.map((row) => row.reply!.fullTextMs!).filter((value) => value !== null)),
  });
  return {
    schemaVersion: 2,
    environment: config.environment,
    scenario,
    startedAtUtc,
    finishedAtUtc: new Date().toISOString(),
    target: { chatUrl: config.chatUrl, apiBaseUrl: config.apiBaseUrl, wsBaseUrl: config.wsBaseUrl },
    settings: {
      transport: 'WS questions and WS text responses; HTTP session setup only',
      setParameterSchema: 'name/type/value (live dev validation 2026-09-25)',
      correlation: 'one question at a time per session plus assistant message ID; no guaranteed echoed request ID',
      completion: 'chat_stream_end or non-streaming assistant_chat_message',
      setupTimeoutMs: config.setupTimeoutMs,
      setupConcurrency: config.setupConcurrency,
      setupAttemptLimit: config.setupAttempts,
      connectTimeoutMs: config.connectTimeoutMs,
      responseTimeoutMs: config.responseTimeoutMs,
      startupQuietMs: config.settleMs,
      questionsSha256: createHash('sha256').update(JSON.stringify(config.questions)).digest('hex'),
      questionStrategy: 'source question unchanged plus plain alphanumeric reference code',
      requestedLanguageId: config.languageId,
      parallelQuestionIds: config.parallelQuestionIds,
      questionRunToken,
      plannedQuestionsSha256: createHash('sha256').update(JSON.stringify(rows.map((row) => row.question))).digest('hex'),
      comparableQuestionCasesSha256: createHash('sha256').update(JSON.stringify(rows.map((row) => stripPlainRequestCode(row.question)))).digest('hex'),
      cacheControl: config.requireCacheDisabled
        ? 'Avatar API cache flag must be false for every session. Server cache hits and model prefix caching are not independently verified.'
        : 'Exact prompt repeats prevented. Server response/semantic/prompt caching has not been verified disabled.',
      requireCacheDisabled: config.requireCacheDisabled,
      percentileMethod: 'nearest rank; successful complete replies only',
      retries: 0,
    },
    summary: {
      plannedQuestions: scenario.sessions * scenario.questions,
      uniqueQuestionTexts: new Set(rows.map((row) => row.question)).size,
      attemptedQuestions: attempted.length,
      successfulQuestions: successful.length,
      failedQuestions: attempted.length - successful.length,
      skippedQuestions: rows.length - attempted.length,
      errorRate: attempted.length ? (attempted.length - successful.length) / attempted.length : null,
      completionRate: successful.length / (scenario.sessions * scenario.questions),
      readySessions: prepared.filter((item) => item.metadata.ready).length,
      requestedSessions: scenario.sessions,
      failedSetupAttempts: prepared.reduce((sum, item) => sum + (item.metadata.preparationAttempts?.filter((attempt) => !attempt.ready).length ?? 0), 0),
      peakInFlight,
      firstWaveSendSpreadMs: firstWave.length ? Math.max(...firstWave) - Math.min(...firstWave) : null,
      setupWallMs: loadStarted - setupStarted,
      responseWindowMs,
      successfulRepliesPerSecond: responseWindowMs > 0 ? successful.length / (responseWindowMs / 1000) : null,
      cohortError,
      ...summarizeTiming(successful),
      byTurn: Array.from({ length: scenario.questions }, (_, index) => ({
        turn: index + 1,
        ...summarizeTiming(successful.filter((row) => row.turn === index + 1)),
      })),
    },
    sessions: prepared.map((item) => item.metadata),
    questions: rows,
  };
}

export type WsLoadReport = Awaited<ReturnType<typeof runWsLoadScenario>>;

export async function writeWsLoadReport(report: WsLoadReport, directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  const columns = ['environment', 'scenario', 'session', 'scrUserID', 'turn', 'status', 'sentAtUtc', 'startOffsetMs',
    'firstTextMs', 'fullTextMs', 'elapsedMs', 'messageId', 'traceId', 'chunks', 'completionEvent', 'question', 'responseText', 'error'];
  const csvCell = (value: unknown) => {
    const raw = value === null || value === undefined ? '' : String(value);
    // Neutralize formula-like untrusted question / model output when opening CSV in a spreadsheet.
    const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = report.questions.map((row) => [
    report.environment, report.scenario.name, row.session, row.scrUserID, row.turn, row.status,
    row.reply?.sentAtUtc, row.startOffsetMs, row.reply?.firstTextMs, row.reply?.fullTextMs, row.reply?.elapsedMs,
    row.reply?.messageId, row.reply?.traceId, row.reply?.chunks, row.reply?.completionEvent,
    row.question, row.reply?.text, row.error,
  ].map(csvCell).join(','));
  await fs.writeFile(path.join(directory, 'questions.csv'), '\uFEFF' + [columns.join(','), ...lines].join('\r\n') + '\r\n');
  const s = report.summary;
  const ms = (value: number | null) => value === null ? 'n/a' : value.toFixed(1);
  const markdown = [
    `# ${report.environment} / ${report.scenario.name}`,
    '',
    `Ready sessions: ${s.readySessions}/${s.requestedSessions}; peak outstanding questions: ${s.peakInFlight}.`,
    `Questions: ${s.plannedQuestions} planned, ${s.successfulQuestions} successful, ${s.failedQuestions} failed, ${s.skippedQuestions} skipped.`,
    `First-wave send spread: ${ms(s.firstWaveSendSpreadMs)} ms.`,
    '',
    '| WS text latency | Samples | Min (ms) | Mean (ms) | p50 (ms) | p95 (ms) | Max (ms) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...[['First text', s.firstText], ['Complete text', s.fullText]].map(([label, raw]) => {
      const metric = raw as ReturnType<typeof describeSamples>;
      return `| ${label} | ${metric.count} | ${ms(metric.minMs)} | ${ms(metric.meanMs)} | ${ms(metric.p50Ms)} | ${ms(metric.p95Ms)} | ${ms(metric.maxMs)} |`;
    }),
    '',
    'Latency statistics include successful complete replies only. Failures, partial text and skipped turns remain in JSON/CSV.',
    'p95 uses nearest rank; these small finite runs are descriptive, not a capacity/SLA estimate.',
    'Session setup and socket cleanup are outside response timing. Media connections are not opened.',
    ...(s.cohortError ? ['', `Cohort error: ${s.cohortError}`] : []),
    '',
  ];
  await fs.writeFile(path.join(directory, 'summary.md'), markdown.join('\n'));
}
