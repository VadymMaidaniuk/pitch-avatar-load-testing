import http from 'node:http';
import fs from 'node:fs/promises';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import WebSocket, { WebSocketServer } from 'ws';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { test, expect } from '../fixtures/test';
import { readWsLoadConfig, type WsLoadConfig } from '../helpers/wsLoadConfig';
import { describeSamples, runWsLoadScenario, writeWsLoadReport } from '../helpers/wsLoadRunner';
import { AvatarTextSession } from '../services/ws/AvatarTextSession';
import WsLoadReporter from '../helpers/wsLoadReporter';
import { readScreeningAssistantMetadata } from '../services/api/ScrApiClient';
import { appendPlainRequestCode, stripPlainRequestCode } from '../helpers/wsLoadQuestions';

type MockOptions = {
  failLogin?: number;
  failLoginStatus?: number;
  duplicateIds?: boolean;
  hangLogin?: boolean;
  unfinishedGreeting?: boolean;
  avatarCache?: boolean;
  screeningLanguage?: string;
  reply?: (socket: WebSocket, turn: number, session: string, send: (type: string, payload: object) => void) => void;
};

async function startMock(options: MockOptions = {}) {
  let logins = 0;
  let active = 0;
  let peak = 0;
  let overlappingQuestions = false;
  const requests: { path: string; body: any }[] = [];
  const questions: { session: string; turn: number; text: string; connected: number }[] = [];
  const parameters: any[] = [];
  const sockets = new Set<WebSocket>();
  const busySessions = new Set<string>();
  const timers = new Set<NodeJS.Timeout>();
  const schedule = (ms: number, callback: () => void) => {
    // Deliberate simulated server latency, not client/test synchronization sleeps.
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms);
    timers.add(timer);
  };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString();
    const body = text ? JSON.parse(text) : null;
    const url = new URL(req.url!, 'http://localhost');
    requests.push({ path: url.pathname, body });
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/login')) {
      logins += 1;
      if (options.hangLogin) return;
      if (options.failLogin === logins) {
        res.statusCode = options.failLoginStatus ?? 401;
        res.end(JSON.stringify({ error: 'secret-token-must-not-be-in-report' }));
        return;
      }
      const id = options.duplicateIds ? 'session-1' : `session-${logins}`;
      res.end(JSON.stringify({ data: { attributes: {
        token: `secret-token-${id}`,
        user: { data: { id } },
        screening: { data: { attributes: { language_id: options.screeningLanguage ?? 'en' }, relationships: {
          'screening-steps': { data: [{ id: 'step-1' }] },
          ...(options.avatarCache === undefined ? {} : { 'screening-assistant': {data: {
            type: 'screening-assistants', id: 'avatar-1', attributes: {
              name: 'Test avatar', role_name: 'Test role', is_cache_enabled: options.avatarCache,
            },
          }} }),
        } } },
      } } }));
    } else res.end('{}');
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, req) => {
    const session = new URL(req.url!, 'http://localhost').searchParams.get('scrUserID') ?? 'direct';
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let turn = 0;
    const send = (type: string, payload: object) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ version: '1.0', type, payload }));
    };
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.type === 'set_parameter') {
        parameters.push(frame.payload);
        if (!frame.payload.name || !['bool', 'string'].includes(frame.payload.type) ||
            typeof frame.payload.value !== (frame.payload.type === 'bool' ? 'boolean' : 'string')) {
          send('security_error', { message: 'Invalid parameter envelope' });
        }
      }
      if (frame.payload?.action === 'screen_user_changed_step') {
        send('chat_stream_start', { id: `${session}-greeting`, message: '' });
        send('chat_stream_chunk', { id: `${session}-greeting`, message: 'Welcome!' });
        if (!options.unfinishedGreeting) send('chat_stream_end', { id: `${session}-greeting`, message: '' });
      }
      if (frame.payload?.action !== 'screen_user_made_chat_message') return;
      turn += 1;
      questions.push({ session, turn, text: frame.payload.data.message, connected: sockets.size });
      if (options.reply) return options.reply(socket, turn, session, send);
      if (busySessions.has(session)) overlappingQuestions = true;
      busySessions.add(session);
      active += 1;
      peak = Math.max(peak, active);
      if (turn > 1) send('assistant_chat_message', { id: `${session}-${turn - 1}`, message: 'Stale duplicate' });
      const id = `${session}-${turn}`;
      send('chat_stream_start', { id, message: '' });
      schedule(5, () => send('chat_stream_chunk', { id, message: 'Hello ' }));
      schedule(15, () => {
        send('chat_stream_chunk', { id, message: 'world' });
        send('chat_stream_end', { id, message: '' });
        active -= 1;
        busySessions.delete(session);
      });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  return {
    api: `http://127.0.0.1:${port}`,
    ws: `ws://127.0.0.1:${port}`,
    requests, questions, parameters,
    get peak() { return peak; },
    get overlappingQuestions() { return overlappingQuestions; },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function localConfig(mock: Awaited<ReturnType<typeof startMock>>): WsLoadConfig {
  return {
    ...readWsLoadConfig({ CHAT_ENV: 'stage', WS_LOAD_CHAT_URL: 'https://slides-staging.pitchavatar.com/local-test' }),
    apiBaseUrl: mock.api,
    wsBaseUrl: mock.ws,
    settleMs: 15,
    connectTimeoutMs: 2000,
    setupTimeoutMs: 5000,
    responseTimeoutMs: 2000,
  };
}

test('[@api][@regression] WS load config requires fresh environment-matched links and fixed matrix', () => {
  expect(() => readWsLoadConfig({ CHAT_ENV: 'stage', CHAT_URL: 'https://slides-staging.pitchavatar.com/old' })).toThrow('WS_LOAD_CHAT_URL');
  expect(() => readWsLoadConfig({ WS_LOAD_CHAT_URL: 'https://slides.pitchavatar.com/new' })).toThrow('CHAT_ENV');
  expect(() => readWsLoadConfig({ CHAT_ENV: 'stage', WS_LOAD_CHAT_URL: 'https://slides.pitchavatar.com/new' })).toThrow('slides-staging');
  const dev = readWsLoadConfig({ CHAT_ENV: 'dev', WS_LOAD_CHAT_URL: 'https://slides-dev.pitchavatar.com/fresh-dev' });
  expect(dev).toMatchObject({
    environment: 'dev', shortLink: 'fresh-dev',
    apiBaseUrl: 'https://api-dev.pitchavatar.com', wsBaseUrl: 'wss://haproxy-dev.pitchavatar.com',
  });
  expect(() => readWsLoadConfig({ CHAT_ENV: 'dev', WS_LOAD_CHAT_URL: 'https://slides-staging.pitchavatar.com/new' })).toThrow('slides-dev');
  expect(() => readWsLoadConfig({ CHAT_ENV: 'prod', WS_LOAD_CHAT_URL: dev.chatUrl })).toThrow('slides.pitchavatar.com');
  const env = { CHAT_ENV: 'prod', WS_LOAD_CHAT_URL: 'https://slides.pitchavatar.com/fresh?tracking=1' };
  const config = readWsLoadConfig(env);
  expect(config.shortLink).toBe('fresh');
  expect(config.chatUrl).toBe('https://slides.pitchavatar.com/fresh');
  expect(config.scenarios.map((scenario) => [scenario.sessions, scenario.questions])).toEqual([[1, 25], [10, 3], [20, 3], [50, 3]]);
  expect(dev.scenarios).toEqual(config.scenarios);
  expect(config.setupConcurrency).toBe(1);
  expect(config.requireCacheDisabled).toBe(false);
  expect(config.languageId).toBe('en');
  expect(readWsLoadConfig({...env,WS_LOAD_LANGUAGE:'uk'}).languageId).toBe('uk');
  expect(readWsLoadConfig({...env,WS_LOAD_PARALLEL_QUESTIONS:'2',WS_LOAD_PARALLEL_QUESTION_IDS:'7,23'}).parallelQuestionIds).toEqual([7,23]);
  expect(readWsLoadConfig({ ...env, WS_LOAD_REQUIRE_CACHE_DISABLED: '1' }).requireCacheDisabled).toBe(true);
  expect(readWsLoadConfig({ ...env, WS_LOAD_SETUP_CONCURRENCY: '5' }).setupConcurrency).toBe(5);
  expect(readWsLoadConfig({ ...env, WS_LOAD_SCENARIOS: 'parallel-20', WS_LOAD_PARALLEL_QUESTIONS: '2' }).scenarios).toEqual([
    { name: 'parallel-20', sessions: 20, questions: 2 },
  ]);
  for (const overrides of [
    { WS_LOAD_PARALLEL_QUESTIONS: '4' }, { WS_LOAD_SCENARIOS: 'parallel-100' },
    { WS_LOAD_SCENARIOS: 'all,parallel-10' }, { WS_LOAD_RESPONSE_TIMEOUT_MS: 'NaN' },
    { WS_LOAD_SETUP_TIMEOUT_MS: '1' },
    { WS_LOAD_REQUIRE_CACHE_DISABLED: 'false' },
    { WS_LOAD_LANGUAGE: 'ru;en' },
    { WS_LOAD_PARALLEL_QUESTIONS: '2', WS_LOAD_PARALLEL_QUESTION_IDS:'7,7' },
    { WS_LOAD_PARALLEL_QUESTIONS: '2', WS_LOAD_PARALLEL_QUESTION_IDS:'0,23' },
    { WS_LOAD_PARALLEL_QUESTIONS: '2', WS_LOAD_PARALLEL_QUESTION_IDS:'7,999' },
    { WS_LOAD_PARALLEL_QUESTION_IDS:'7,23' },
  ]) expect(() => readWsLoadConfig({ ...env, ...overrides })).toThrow();
});

test('[@api][@regression] avatar metadata excludes credentials and requires an unambiguous boolean cache state', () => {
  const avatar = {type:'screening-assistants',id:'screen-7',attributes:{
    assistant_id:42,name:'Test',role_name:'Sales',language_id:'en',is_cache_enabled:false,
    token:'private',lipsync:{client_key:'private'},
  }};
  const metadata = readScreeningAssistantMetadata({included:[avatar,avatar]});
  expect(metadata).toEqual({screeningAssistantId:'screen-7',assistantId:'42',name:'Test',roleName:'Sales',languageId:'en',cacheEnabled:false});
  expect(JSON.stringify(metadata)).not.toContain('private');
  expect(readScreeningAssistantMetadata({included:[avatar,{...avatar,id:'other'}]})).toBeNull();
  expect(readScreeningAssistantMetadata({included:[{...avatar,attributes:{is_cache_enabled:'false'}}]})?.cacheEnabled).toBeNull();
});

for (const cacheEnabled of [true, undefined, false]) {
  test(`[@api][@regression] uncached mode verifies cache state ${String(cacheEnabled)} before sending questions`, async () => {
    const mock = await startMock({avatarCache:cacheEnabled});
    try {
      const config = {...localConfig(mock),requireCacheDisabled:true};
      const report = await runWsLoadScenario(config,{name:'cache-check',sessions:1,questions:1});
      if (cacheEnabled === false) {
        expect(report.summary.successfulQuestions).toBe(1);
        expect(report.sessions[0].avatar?.cacheEnabled).toBe(false);
      } else {
        expect(report.summary.attemptedQuestions).toBe(0);
        expect(mock.questions).toHaveLength(0);
        expect(mock.requests.every(item=>item.path.endsWith('/login'))).toBe(true);
        expect(report.sessions[0].error).toContain(cacheEnabled === true ? 'cache is enabled' : 'cache state is unknown');
      }
    } finally { await mock.close(); }
  });
}

test('[@api][@regression] all four load scenarios produce 265 complete replies with independent concurrent sessions', async ({}, testInfo) => {
  let total = 0;
  const questionTexts: string[] = [];
  const questionCases: string[] = [];
  for (const scenario of readWsLoadConfig({ CHAT_ENV: 'stage', WS_LOAD_CHAT_URL: 'https://slides-staging.pitchavatar.com/local-test' }).scenarios) {
    const mock = await startMock();
    try {
      const report = await runWsLoadScenario(localConfig(mock), scenario);
      expect(report.summary.cohortError).toBeNull();
      expect(report.summary.successfulQuestions).toBe(scenario.sessions * scenario.questions);
      expect(report.summary.failedQuestions).toBe(0);
      expect(report.summary.skippedQuestions).toBe(0);
      expect(report.summary.peakInFlight).toBe(scenario.sessions);
      expect(mock.peak).toBe(scenario.sessions);
      expect(mock.overlappingQuestions).toBe(false);
      expect(new Set(report.sessions.map((session) => session.scrUserID)).size).toBe(scenario.sessions);
      expect(mock.questions.filter((question) => question.turn === 1).every((question) => question.connected === scenario.sessions)).toBe(true);
      expect(report.questions.every((row) => row.reply?.text === 'Hello world')).toBe(true);
      expect(report.questions.every((row) => row.reply!.fullTextMs! >= row.reply!.firstTextMs!)).toBe(true);
      expect(report.questions.every((row) => row.reply?.completionEvent === 'chat_stream_end')).toBe(true);
      questionTexts.push(...report.questions.map((row) => row.question));
      questionCases.push(...report.questions.map((row) => stripPlainRequestCode(row.question)));
      expect(report.questions.every(row => stripPlainRequestCode(row.question) === row.baseQuestion)).toBe(true);
      expect(report.questions.every(row => /^[A-Za-z0-9]+$/.test(row.questionId))).toBe(true);
      expect(report.summary.uniqueQuestionTexts).toBe(report.summary.plannedQuestions);
      expect(mock.requests.some((req) => req.path.includes('/streams/'))).toBe(false);
      expect(mock.requests.some((req) => req.body?.data?.attributes?.action === 'screen_user_made_chat_message')).toBe(false);
      expect(mock.parameters.every((parameter) => parameter.name && !('parameter_name' in parameter))).toBe(true);
      await writeWsLoadReport(report, testInfo.outputPath(scenario.name));
      const persisted = await fs.readFile(testInfo.outputPath(scenario.name, 'results.json'), 'utf8');
      expect(persisted).not.toContain('secret-token');
      expect(JSON.parse(persisted).summary.successfulQuestions).toBe(report.summary.successfulQuestions);
      total += report.summary.successfulQuestions;
    } finally { await mock.close(); }
  }
  expect(total).toBe(265);
  expect(new Set(questionTexts).size).toBe(265);
  expect(new Set(questionCases).size).toBeGreaterThanOrEqual(25);
});

test('[@api][@regression] English request language overrides Russian screening metadata in both HTTP and WS', async () => {
  const mock = await startMock({screeningLanguage:'ru'});
  try {
    const report = await runWsLoadScenario(localConfig(mock),{name:'language-check',sessions:1,questions:1});
    expect(report.summary.successfulQuestions).toBe(1);
    expect(report.sessions[0]).toMatchObject({languageID:'en',sourceScreeningLanguageID:'ru'});
    const httpLanguages = mock.requests.filter(r=>/screening-parameters\/(Presentation|Listener)%20Language$/.test(r.path));
    expect(httpLanguages).toHaveLength(2);
    expect(httpLanguages.map(r=>r.body.value)).toEqual(['en','en']);
    const wsLanguages = mock.parameters.filter(p=>p.name==='Presentation Language'||p.name==='Listener Language');
    expect(wsLanguages).toHaveLength(2);
    expect(wsLanguages.map(p=>p.value)).toEqual(['en','en']);
  } finally { await mock.close(); }
});

test('[@api][@regression] PDF workload preserves 25 source questions and uses only the selected two for all parallel sessions', async () => {
  const source = JSON.parse(await fs.readFile('test-data/ws-load-aurelian-questions.json','utf8')) as string[];
  const key = JSON.parse(await fs.readFile('test-data/ws-load-aurelian-answer-key.json','utf8'));
  expect(source).toHaveLength(25);
  expect(new Set(source).size).toBe(25);
  expect(key.questions.map((q: {question:string})=>q.question)).toEqual(source);
  const allTexts: string[] = [];
  for (const sessions of [1,10,20,50]) {
    const mock = await startMock();
    try {
      const config = {...localConfig(mock),questions:source,parallelQuestionIds:[7,23]};
      const scenario = {name:sessions===1?'chain-1x25':`parallel-${sessions}`,sessions,questions:sessions===1?25:2};
      const report = await runWsLoadScenario(config,scenario);
      expect(report.summary.successfulQuestions).toBe(scenario.sessions*scenario.questions);
      expect(report.summary.peakInFlight).toBe(sessions);
      for (const row of report.questions) {
        const id = sessions===1?row.turn:row.turn===1?7:23;
        expect(row.sourceQuestionId).toBe(id);
        expect(row.baseQuestion).toBe(source[id-1]);
        expect(row.question).toBe(`${source[id-1]}\nReference code ${row.questionId}`);
        expect(row.questionId).toMatch(/^[A-Za-z0-9]+$/);
        allTexts.push(row.question);
      }
    } finally { await mock.close(); }
  }
  expect(allTexts).toHaveLength(185);
  expect(new Set(allTexts).size).toBe(185);
  expect(()=>appendPlainRequestCode('Question','BAD[CODE]')).toThrow('letters and digits');
});

test('[@api][@regression] first text ignores stream start, whitespace and non-text chunks; completion waits for end', async () => {
  let sendFrame: ((type: string, payload: object) => void) | undefined;
  let serverSocket: WebSocket;
  let questionArrived!: () => void;
  const arrived = new Promise<void>((resolve) => { questionArrived = resolve; });
  const mock = await startMock({ reply: (socket, _turn, _session, send) => { serverSocket = socket; sendFrame = send; questionArrived(); } });
  const connection = await AvatarTextSession.connect(`${mock.ws}/ws`, 1000);
  try {
    let resolved = false;
    const reply = connection.ask('Question', 2000).then((result) => { resolved = true; return result; });
    await arrived;
    sendFrame!('chat_stream_start', { id: 'a', message: '' });
    sendFrame!('chat_stream_chunk', { id: 'a', message: '   ', chunk_type: 'text' });
    sendFrame!('chat_stream_chunk', { id: 'audio-id', message: 'base64-audio', chunk_type: 'audio' });
    const roundTrip = async () => {
      const pong = once(serverSocket, 'pong');
      serverSocket.ping();
      await pong;
    };
    // A ping/pong confirms prior frames were processed before checking the clock boundary.
    await roundTrip();
    expect(resolved).toBe(false);
    const firstTextSent = performance.now();
    sendFrame!('chat_stream_chunk', { id: 'a', message: 'Real answer' });
    await roundTrip();
    expect(resolved).toBe(false);
    const endSent = performance.now();
    sendFrame!('chat_stream_end', { id: 'a', message: '' });
    const result = await reply;
    expect(result.status).toBe('ok');
    expect(result.text).toBe('   Real answer');
    expect(result.firstTextMs).not.toBeNull();
    expect(result.firstTextMs!).toBeGreaterThanOrEqual(firstTextSent - result.sentAtMonotonicMs);
    expect(result.fullTextMs!).toBeGreaterThanOrEqual(endSent - result.sentAtMonotonicMs);
    expect(result.fullTextMs).toBeGreaterThanOrEqual(result.firstTextMs!);
  } finally { await connection.close(); await mock.close(); }
});

test('[@api][@regression] non-streaming and legacy frames produce complete text', async () => {
  const mock = await startMock({ reply: (socket, turn, _session, send) => {
    if (turn === 1) send('assistant_chat_message', { id: 'first', message: 'Normal answer' });
    else socket.send(JSON.stringify({ event_type: 'assistant_chat_message', id: 'legacy', message: 'Legacy answer' }));
  } });
  const connection = await AvatarTextSession.connect(`${mock.ws}/ws`, 1000);
  try {
    for (const text of ['Normal answer', 'Legacy answer']) {
      const reply = await connection.ask('Question', 1000);
      expect(reply.status).toBe('ok');
      expect(reply.text).toBe(text);
      expect(reply.completionEvent).toBe('assistant_chat_message');
    }
  } finally { await connection.close(); await mock.close(); }
});

test('[@api][@regression] incomplete streams time out and remaining turns are skipped instead of misattributed', async ({}, testInfo) => {
  const mock = await startMock({ reply: (_socket, _turn, _session, send) => {
    send('chat_stream_start', { id: 'partial', message: '' });
    send('chat_stream_chunk', { id: 'partial', message: '=partial,"answer"\nnext line' });
  } });
  try {
    const config = { ...localConfig(mock), responseTimeoutMs: 100 };
    const report = await runWsLoadScenario(config, config.scenarios[0]);
    expect(report.summary).toMatchObject({ attemptedQuestions: 1, failedQuestions: 1, skippedQuestions: 24, errorRate: 1 });
    expect(report.summary.fullText.count).toBe(0);
    expect(report.questions[0].reply).toMatchObject({ status: 'timeout', fullTextMs: null });
    expect(report.questions[0].reply!.firstTextMs).not.toBeNull();
    expect(mock.questions).toHaveLength(1);
    await writeWsLoadReport(report, testInfo.outputPath('timeout'));
    const csv = await fs.readFile(testInfo.outputPath('timeout', 'questions.csv'), 'utf8');
    expect(csv).toContain("\"'=partial,\"\"answer\"\"\nnext line\"");
  } finally { await mock.close(); }
});

for (const failure of ['close', 'server', 'overlap', 'empty', 'missing-id']) {
  test(`[@api][@regression] ${failure} cannot be reported as a successful reply`, async () => {
    const mock = await startMock({ reply: (socket, _turn, _session, send) => {
      if (failure === 'close') socket.close(1011);
      if (failure === 'server') send('security_error', { message: 'sensitive server error body' });
      if (failure === 'overlap') {
        send('chat_stream_start', { id: 'first', message: '' });
        send('chat_stream_chunk', { id: 'second', message: 'Wrong stream' });
      }
      if (failure === 'empty') send('chat_stream_end', { id: 'empty', message: '' });
      if (failure === 'missing-id') send('assistant_chat_message', { message: 'No ID' });
    } });
    const connection = await AvatarTextSession.connect(`${mock.ws}/ws`, 1000);
    try {
      const reply = await connection.ask('Question', 1000);
      expect(reply.status).toBe(failure === 'close' ? 'ws_error' : failure === 'server' ? 'server_error' : 'protocol_error');
      expect(reply.fullTextMs).toBeNull();
      expect(reply.error).not.toContain('sensitive');
    } finally { await connection.close(); await mock.close(); }
  });
}

test('[@api][@regression] failed preparation aborts the cohort and preserves diagnostics without secrets', async () => {
  const mock = await startMock({ failLogin: 2 });
  try {
    const config = localConfig(mock);
    const report = await runWsLoadScenario(config, config.scenarios[1]);
    expect(report.summary.readySessions).toBe(9);
    expect(report.summary.cohortError).not.toBeNull();
    expect(report.summary.attemptedQuestions).toBe(0);
    expect(report.summary.skippedQuestions).toBe(30);
    expect(report.summary.errorRate).toBeNull();
    expect(mock.questions).toHaveLength(0);
    expect(JSON.stringify(report)).not.toContain('secret-token');
    expect(report.sessions.some((session) => session.error?.includes('HTTP 401'))).toBe(true);
  } finally { await mock.close(); }
});

test('[@api][@regression] reused session IDs are rejected before any question is sent', async () => {
  const mock = await startMock({ duplicateIds: true });
  try {
    const config = localConfig(mock);
    const report = await runWsLoadScenario(config, config.scenarios[1]);
    expect(report.summary.cohortError).toContain('not independent');
    expect(mock.questions).toHaveLength(0);
  } finally { await mock.close(); }
});

test('[@api][@regression] optional setup recovery retains failed HTTP attempts without retrying questions', async () => {
  const mock = await startMock({ failLogin: 2, failLoginStatus: 500 });
  try {
    const config = { ...localConfig(mock), setupAttempts: 2 };
    const report = await runWsLoadScenario(config, config.scenarios[1]);
    expect(report.summary).toMatchObject({ readySessions: 10, failedSetupAttempts: 1, successfulQuestions: 30, attemptedQuestions: 30 });
    expect(report.sessions[1].preparationAttempts).toHaveLength(2);
    expect(report.sessions[1].preparationAttempts![0].error).toContain('HTTP 500');
    expect(mock.questions).toHaveLength(30);
  } finally { await mock.close(); }
});

for (const failure of ['HTTP request', 'unfinished greeting']) {
  test(`[@api][@regression] setup deadline stops a stalled ${failure}`, async () => {
    const mock = await startMock({ hangLogin: failure === 'HTTP request', unfinishedGreeting: failure === 'unfinished greeting' });
    try {
      const config = { ...localConfig(mock), setupTimeoutMs: 150 };
      const report = await runWsLoadScenario(config, config.scenarios[0]);
      expect(report.summary.readySessions).toBe(0);
      expect(report.sessions[0].error).toContain('setup timeout');
      expect(report.summary.skippedQuestions).toBe(25);
      expect(mock.questions).toHaveLength(0);
    } finally { await mock.close(); }
  });
}

test('[@api][@regression] an aborted WS handshake is cleaned up without unhandled socket errors', async () => {
  const server = http.createServer();
  const abort = new AbortController();
  const connections = new Set<import('node:net').Socket>();
  server.on('connection', (socket) => { connections.add(socket); socket.on('close', () => connections.delete(socket)); });
  server.on('upgrade', () => abort.abort()); // Never complete the handshake.
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const port = (server.address() as AddressInfo).port;
    await expect(AvatarTextSession.connect(`ws://127.0.0.1:${port}`, 1000, abort.signal)).rejects.toThrow('aborted');
  } finally {
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('[@api][@regression] aggregate report retains failed scenario metrics and identifies missing artifacts', async ({}, testInfo) => {
  const mock = await startMock({ reply: (_socket, _turn, _session, send) => send('security_error', {}) });
  try {
    const config = localConfig(mock);
    const report = await runWsLoadScenario(config, config.scenarios[0]);
    await writeWsLoadReport(report, testInfo.outputPath('scenario'));
    const recorded = { id: 'recorded', title: 'Recorded failure' } as TestCase;
    const missing = { id: 'missing', title: 'Interrupted scenario' } as TestCase;
    const reporter = new WsLoadReporter({ outputDir: testInfo.outputPath('aggregate') });
    reporter.onBegin({} as FullConfig, { allTests: () => [recorded, missing] } as Suite);
    reporter.onTestEnd(recorded, { attachments: [{ name: 'results.json', path: testInfo.outputPath('scenario', 'results.json') }] } as TestResult);
    await reporter.onEnd({ status: 'failed' } as FullResult);
    const summary = JSON.parse(await fs.readFile(testInfo.outputPath('aggregate', 'run-summary.json'), 'utf8'));
    expect(summary).toMatchObject({ status: 'failed', recordedScenarios: 1, expectedScenarios: 2, missingScenarioMetrics: ['Interrupted scenario'] });
    expect(summary.scenarios[0].metrics.failedQuestions).toBe(1);
    expect(summary.scenarios[0].metrics.skippedQuestions).toBe(24);
  } finally { await mock.close(); }
});

test('[@api][@regression] latency percentiles use nearest rank and do not turn missing samples into zeros', () => {
  expect(describeSamples([])).toEqual({ count: 0, minMs: null, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null });
  expect(describeSamples([100, 1, 3, 2])).toEqual({ count: 4, minMs: 1, meanMs: 26.5, p50Ms: 2, p95Ms: 100, maxMs: 100 });
});
