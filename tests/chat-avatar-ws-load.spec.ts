import { test, expect, APIRequestContext } from '@playwright/test';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import {
  API_BASE_URL,
  WS_BASE_URL,
  SCR_SHORT_LINK,
  WS_USERS,
  WS_ASSIST_TIMEOUT_MS,
  RUN_ID,
} from './chatConfig';

const LOGIN_INCLUDE =
  'screening-steps.stepable,screening-steps.files,files,user,user.files,user-company.files,screening-steps.controls,screening-assistant,screening-assistant.files,introductionSlides,screening-admins.files';

const LOG_DIR = path.join(__dirname, '..', 'test-results');
const LOG_FILE = path.join(LOG_DIR, `chat-ws-metrics-${RUN_ID}.log`);

const QUESTIONS = [
  'Give me a two-sentence summary of this deck.',
  'What problem is this product solving?',
  'List three risks a security lead might ask about.',
  'Who is the ideal customer profile here?',
  'What are the first steps to get started?',
  'How does this differ from competitors?',
  'Give me a one-line value prop for a CFO.',
  'What KPIs does this improve?',
  'Explain the pitch in plain language.',
  'What is the call to action?',
];

type LoginResult = { token: string; scrUserID: string };
type AssistantEvent = { event_type?: string; message?: string; createdAt?: string };

test.describe.configure({ mode: 'parallel' });

function lb(): string {
  return process.platform === 'win32' ? '\r\n' : '\n';
}

async function loginScrShortLink(request: APIRequestContext, shortLink: string): Promise<LoginResult> {
  const url = `${API_BASE_URL}/api/scr/${shortLink}/login?include=${LOGIN_INCLUDE}`;
  const resp = await request.post(url, {
    headers: {
      Authorization: 'Bearer',
      'Content-Type': 'application/vnd.api+json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    data: { is_iframe: false, original_source: '' },
  });
  if (!resp.ok()) {
    throw new Error(`login failed ${resp.status()} ${resp.statusText()}`);
  }
  const json = await resp.json();
  const token: string | undefined = json?.data?.attributes?.token;
  const scrUserID: string | undefined = json?.data?.attributes?.user?.data?.id;
  if (!token || !scrUserID) {
    throw new Error('login response missing token or scrUserID');
  }
  return { token, scrUserID };
}

async function createUserChatMessageReportAction(request: APIRequestContext, params: {
  token: string;
  message: string;
  shortLink: string;
}): Promise<void> {
  const payload = {
    data: {
      type: 'report-actions',
      attributes: {
        action: 'screen_user_made_chat_message',
        data: { message: params.message },
      },
    },
  };

  const resp = await request.post(`${API_BASE_URL}/api/scr/${params.shortLink}/report-actions`, {
    headers: {
      Authorization: `Bearer ${params.token}`,
      'Content-Type': 'application/vnd.api+json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    data: payload,
  });
  if (!resp.ok()) {
    const text = await resp.text();
    throw new Error(`report-actions failed ${resp.status()}: ${text}`);
  }
}

function connectChatWs(params: { scrUserID: string; token?: string }) {
  const base = WS_BASE_URL.replace(/\/$/, '');
  const url = `${base}/ws?scrUserID=${encodeURIComponent(params.scrUserID)}`;

  const ws = new WebSocket(url, {
    headers: params.token ? { Authorization: `Bearer ${params.token}` } : undefined,
  });

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS connection timeout')), 10000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const waitForAssistantMessage = (timeoutMs = WS_ASSIST_TIMEOUT_MS): Promise<AssistantEvent> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for assistant_chat_message'));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        ws.off('message', onMessage);
        ws.off('close', onClose);
        ws.off('error', onError);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('WebSocket closed before assistant message'));
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onMessage = (raw: WebSocket.RawData) => {
        const text = typeof raw === 'string' ? raw : raw.toString();
        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch {
          return;
        }
        if (parsed?.event_type === 'assistant_chat_message' || parsed?.message) {
          cleanup();
          resolve(parsed);
        }
      };

      ws.on('message', onMessage);
      ws.on('close', onClose);
      ws.on('error', onError);
    });

  const close = async () =>
    new Promise<void>((resolve) => {
      ws.close();
      ws.once('close', () => resolve());
    });

  return { ws, ready, waitForAssistantMessage, close };
}

type LogEntry = {
  virtualUser: number;
  status: 'ok' | 'timeout' | 'error';
  loginMs: number;
  wsConnectMs: number;
  assistantLatencyMs: number;
  totalMs: number;
  question: string;
};

function logResult(entry: LogEntry) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const line = `${new Date().toISOString()}\tVU ${entry.virtualUser}\t${entry.status}\tlogin=${entry.loginMs}ms\tws=${entry.wsConnectMs}ms\tassistant=${entry.assistantLatencyMs}ms\ttotal=${entry.totalMs}ms\tq="${entry.question}"${lb()}`;
  fs.appendFileSync(LOG_FILE, line);
}

for (let userId = 1; userId <= WS_USERS; userId += 1) {
  test(`chat WS virtual user #${userId}`, async ({ request }) => {
    const testTimeout = Math.max(WS_ASSIST_TIMEOUT_MS + 20000, 60000);
    test.setTimeout(testTimeout);

    const t0 = Date.now();
    const login = await loginScrShortLink(request, SCR_SHORT_LINK);
    const t1 = Date.now();

    const { ready, waitForAssistantMessage, close } = connectChatWs({
      scrUserID: login.scrUserID,
      token: login.token,
    });
    await ready;
    const t2 = Date.now();

    const question = QUESTIONS[(userId - 1) % QUESTIONS.length];
    const message = `${question} [vu-${userId}-${Date.now()}]`;

    const assistantPromise = waitForAssistantMessage(WS_ASSIST_TIMEOUT_MS);
    const tSend = Date.now();

    let status: LogEntry['status'] = 'error';
    let assistantLatencyMs = 0;

    try {
      await createUserChatMessageReportAction(request, {
        token: login.token,
        message,
        shortLink: SCR_SHORT_LINK,
      });

      const assistant = await assistantPromise;
      assistantLatencyMs = Date.now() - tSend;
      status = 'ok';

      expect(assistant.message).toBeTruthy();
      expect(String(assistant.message).length).toBeGreaterThan(0);
      if (assistant.createdAt) {
        expect(new Date(assistant.createdAt).toString()).not.toBe('Invalid Date');
      }
    } catch (err: any) {
      assistantLatencyMs = Date.now() - tSend;
      const isTimeout = err?.message?.toString().includes('assistant_chat_message') || err?.name === 'TimeoutError';
      status = isTimeout ? 'timeout' : 'error';
      logResult({
        virtualUser: userId,
        status,
        loginMs: t1 - t0,
        wsConnectMs: t2 - t1,
        assistantLatencyMs,
        totalMs: Date.now() - t0,
        question,
      });
      await close();
      throw err;
    }

    logResult({
      virtualUser: userId,
      status,
      loginMs: t1 - t0,
      wsConnectMs: t2 - t1,
      assistantLatencyMs,
      totalMs: Date.now() - t0,
      question,
    });

    await test.info().attach(`ws-metrics-vu-${userId}`, {
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify({
          virtualUser: userId,
          status,
          loginMs: t1 - t0,
          wsConnectMs: t2 - t1,
          assistantLatencyMs,
          totalMs: Date.now() - t0,
          question,
        }),
      ),
    });

    await close();
  });
}
