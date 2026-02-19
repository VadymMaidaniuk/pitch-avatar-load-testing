import { test, expect } from '../fixtures/test';
import type { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { UI_USERS, UI_ASSIST_TIMEOUT_MS, RUN_ID } from '../helpers/chatConfig';
import { buildQuestion } from '../helpers/chatQuestions';
import { ChatPage } from '../pages/ChatPage';

test.describe.configure({ mode: 'parallel' });
// UI reply text is not rendered in headless (bubbles stay with loader SVG), so run headed.
test.use({ headless: false });

const LOG_DIR = path.join(__dirname, '..', '..', 'test-results');
const LOG_RUN_ID = process.env.CHAT_LOG_RUN_ID ?? RUN_ID;
const LOG_FILE = path.join(LOG_DIR, `chat-reply-times-${LOG_RUN_ID}.log`);
const TEST_TIMEOUT_MS = Math.max(UI_ASSIST_TIMEOUT_MS + 120_000, 180_000);

type ResultStatus = 'ok' | 'timeout' | 'error' | 'ui_not_rendered_ws_received';

type WsAssistantEvent = {
  frame: any;
  message?: string;
  eventType?: string;
  createdAt?: string | null;
  url?: string;
  observedAt?: number;
};

type StreamEvent = {
  ts: number;
  iso: string;
  endpoint: 'connect' | 'sdp' | 'ice';
  url: string;
  status: number;
  streamId: string | null;
  sessionId: string | null;
  requestId: string | null;
};

type StreamCapture = {
  events: StreamEvent[];
  streamIds: string[];
  sessionIds: string[];
  requestIds: string[];
};

type LatencyMetrics = {
  avatarUiLatencyMs: number | null;
  wsLatencyMs: number | null;
  uiMinusWsMs: number | null;
};

async function installWsInstrumentation(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    if (w.__wsInstrumentedLoad) return;
    w.__wsInstrumentedLoad = true;

    if (!w.__wsFrames) w.__wsFrames = [];
    if (!w.__wsUrls) w.__wsUrls = [];

    const Original = w.WebSocket;
    if (!Original) return;

    const decoder = new TextDecoder();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    class InstrumentedWS extends Original {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols as any);

        try {
          w.__wsUrls.push(url);
        } catch {
          // ignore
        }

        this.addEventListener('message', async (event: MessageEvent) => {
          try {
            const data = (event as any).data;
            let text = '';
            if (typeof data === 'string') {
              text = data;
            } else if (data instanceof ArrayBuffer) {
              text = decoder.decode(data);
            } else if (data && typeof (data as any).text === 'function') {
              text = await (data as any).text();
            }
            w.__wsFrames.push({ url, data: text, ts: Date.now() });
          } catch {
            // ignore
          }
        });
      }
    }

    // @ts-ignore
    w.WebSocket = InstrumentedWS;
  });
}

function uniq(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function parseScrUserId(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('scrUserID');
  } catch {
    return null;
  }
}

function isoTs(ts: number | null | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'n/a';
  return new Date(ts).toISOString();
}

async function readWsUrls(page: Page): Promise<string[]> {
  try {
    const urls = await page.evaluate(() => (window as any).__wsUrls || []);
    return Array.isArray(urls)
      ? urls.filter((url: unknown): url is string => typeof url === 'string' && url.length > 0)
      : [];
  } catch {
    return [];
  }
}

function installStreamInstrumentation(page: Page): StreamCapture {
  const capture: StreamCapture = {
    events: [],
    streamIds: [],
    sessionIds: [],
    requestIds: [],
  };

  page.on('response', async (response) => {
    const url = response.url();
    const endpointMatch = url.match(/\/api\/wrapper\/v1\/streams\/(connect|sdp|ice)(?:\?|$)/i);
    if (!endpointMatch) return;

    const endpoint = endpointMatch[1].toLowerCase() as StreamEvent['endpoint'];
    const headers = response.headers();
    const ts = Date.now();
    const request = response.request();
    const requestPostData = request.postData();
    let parsedResponse: any = null;
    let parsedRequest: any = null;

    try {
      parsedResponse = await response.json();
    } catch {
      // ignore non-json response bodies
    }

    if (requestPostData) {
      try {
        parsedRequest = JSON.parse(requestPostData);
      } catch {
        // ignore non-json request bodies
      }
    }

    const streamId = pickString(
      parsedResponse?.id,
      parsedResponse?.streamId,
      parsedResponse?.stream_id,
      parsedResponse?.data?.id,
      parsedResponse?.data?.attributes?.id,
      parsedResponse?.data?.attributes?.streamId,
      parsedResponse?.data?.attributes?.stream_id,
      parsedRequest?.streamId,
      parsedRequest?.stream_id,
      parsedRequest?.data?.streamId,
      parsedRequest?.data?.stream_id,
    );

    const sessionId = pickString(
      parsedResponse?.session_id,
      parsedResponse?.sessionId,
      parsedResponse?.data?.attributes?.session_id,
      parsedResponse?.data?.attributes?.sessionId,
      parsedRequest?.session_id,
      parsedRequest?.sessionId,
      parsedRequest?.settings?.session_id,
      parsedRequest?.settings?.sessionId,
    );

    const requestId = pickString(
      headers['x-request-id'],
      headers['x-amzn-requestid'],
      headers['x-amz-request-id'],
      headers['x-correlation-id'],
      headers['x-trace-id'],
      headers['trace-id'],
    );

    capture.events.push({
      ts,
      iso: new Date(ts).toISOString(),
      endpoint,
      url,
      status: response.status(),
      streamId,
      sessionId,
      requestId,
    });

    capture.streamIds = uniq([...capture.streamIds, streamId]);
    capture.sessionIds = uniq([...capture.sessionIds, sessionId]);
    capture.requestIds = uniq([...capture.requestIds, requestId]);
  });

  return capture;
}

async function sendAndMeasure(page: Page, userId: number) {
  let status: ResultStatus = 'error';
  let duration = 0;
  let detail = '';

  const streamCapture = installStreamInstrumentation(page);
  await installWsInstrumentation(page);
  const chat = new ChatPage(page);
  await chat.open();
  const input = chat.input;
  const sendButton = chat.sendButton;

  const question = buildQuestion(userId);
  await input.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });

  const assistantBubbleLocator = chat.assistantBubbles();
  const botCountBefore = await assistantBubbleLocator.count();

  const start = Date.now();
  await sendButton.click();

  await expect(chat.userBubble(question)).toBeVisible({ timeout: 20_000 });

  const newBotBubble = assistantBubbleLocator.nth(botCountBefore);
  const waitForAssistantText = async () => {
    const deadline = Date.now() + UI_ASSIST_TIMEOUT_MS;
    let lastText = '';
    const stripLabel = (text: string) =>
      text.replace(/^chat avatar\s*(\[[^\]]*])?\s*/i, '').trim();
    const stripTimestamp = (text: string) => text.replace(/\b\d{1,2}:\d{2}\b/g, '').trim();
    const cleanText = (text: string) => stripTimestamp(stripLabel(text.replace(/\s+/g, ' ').trim()));
    const hasContent = (text: string) => text && /[A-Za-z]/.test(text) && text.length >= 4;
    const isLabelOnly = (text: string) => /^chat avatar\b/i.test(text) || /^\d{1,2}:\d{2}$/.test(text);
    const messageList = await assistantBubbleLocator
      .first()
      .locator('xpath=ancestor::ul[1]')
      .elementHandle()
      .catch(() => null);
    while (Date.now() < deadline) {
      const currentCount = await assistantBubbleLocator.count();
      if (messageList) {
        await messageList
          .evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          })
          .catch(() => {});
      }
      for (let idx = botCountBefore; idx < currentCount; idx += 1) {
        const candidate = assistantBubbleLocator.nth(idx);
        const parts =
          (await candidate.locator('p, span, div').allInnerTexts().catch(() => [])) ?? [];
        for (const part of parts) {
          const cleaned = cleanText(part);
          if (cleaned) lastText = cleaned;
          if (hasContent(cleaned) && !isLabelOnly(cleaned)) {
            return cleaned;
          }
        }
        const fallback = cleanText(await candidate.innerText({ timeout: 2_000 }).catch(() => ''));
        if (fallback) lastText = fallback;
        if (hasContent(fallback) && !isLabelOnly(fallback)) {
          return fallback;
        }
      }
      await page.waitForTimeout(500);
    }
    throw new Error(
      `Assistant reply text not received in ${UI_ASSIST_TIMEOUT_MS}ms (last text: "${lastText}")`,
    );
  };

  const waitForWsAssistant = async () => {
    const handle = await page.waitForFunction(
      (sentAt: number) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const frames: { url?: string; data?: string; ts?: number }[] = (window as any).__wsFrames || [];
        for (const f of frames) {
          if (!f?.data || !f.ts || f.ts < sentAt) continue;
          try {
            const parsed = JSON.parse(f.data);
            const legacyType = typeof parsed?.event_type === 'string' ? parsed.event_type : '';
            const legacyMessage = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
            if (
              (legacyType === 'assistant_chat_message' || legacyType === 'chat_stream_chunk') &&
              legacyMessage.length > 0
            ) {
              return {
                frame: parsed,
                url: f.url,
                observedAt: f.ts,
                message: legacyMessage,
                eventType: legacyType,
                createdAt: typeof parsed?.createdAt === 'string' ? parsed.createdAt : null,
              };
            }

            const envelopeType = typeof parsed?.type === 'string' ? parsed.type : '';
            const payload =
              parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
            const payloadMessage =
              typeof payload?.message === 'string' ? String(payload.message).trim() : '';
            if (
              (envelopeType === 'assistant_chat_message' || envelopeType === 'chat_stream_chunk') &&
              payloadMessage.length > 0
            ) {
              return {
                frame: parsed,
                url: f.url,
                observedAt: f.ts,
                message: payloadMessage,
                eventType: envelopeType,
                createdAt:
                  typeof payload?.createdAt === 'string'
                    ? payload.createdAt
                    : typeof parsed?.timestamp === 'string'
                      ? parsed.timestamp
                      : null,
              };
            }
          } catch {
            continue;
          }
        }
        return null;
      },
      start,
      { timeout: UI_ASSIST_TIMEOUT_MS },
    );
    return (await handle.jsonValue()) as WsAssistantEvent;
  };

  const wsPromise = waitForWsAssistant()
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => ({ ok: false as const, error }));

  const calcMetrics = (
    avatarUiLatencyMs: number | null,
    wsEvent?: WsAssistantEvent | null,
  ): LatencyMetrics => {
    const wsLatencyMs =
      typeof wsEvent?.observedAt === 'number' ? Math.max(0, wsEvent.observedAt - start) : null;
    const uiMinusWsMs =
      avatarUiLatencyMs !== null && wsLatencyMs !== null ? avatarUiLatencyMs - wsLatencyMs : null;
    return { avatarUiLatencyMs, wsLatencyMs, uiMinusWsMs };
  };

  const metricsToDetail = (metrics: LatencyMetrics): string =>
    `avatar_ui_latency_ms=${metrics.avatarUiLatencyMs ?? 'n/a'}; ws_latency_ms=${metrics.wsLatencyMs ?? 'n/a'}; ui_minus_ws_ms=${metrics.uiMinusWsMs ?? 'n/a'}`;

  const addContextToDetail = async (
    base: string,
    opts: { wsEvent?: WsAssistantEvent | null; uiObservedAt?: number | null },
  ) => {
    const wsUrls = await readWsUrls(page);
    const wsCandidates = [opts.wsEvent?.url, ...wsUrls];
    const scrUserID = wsCandidates.map((url) => parseScrUserId(url)).find((id) => !!id) ?? null;
    const streamIds = streamCapture.streamIds.length ? streamCapture.streamIds.join('|') : 'n/a';
    return `${base}; sent_at_utc=${isoTs(start)}; ws_at_utc=${isoTs(opts.wsEvent?.observedAt)}; ui_at_utc=${isoTs(opts.uiObservedAt ?? null)}; scr_user_id=${scrUserID ?? 'n/a'}; stream_ids=${streamIds}; stream_events=${streamCapture.events.length}`;
  };

  try {
    await expect(newBotBubble).toBeVisible({ timeout: UI_ASSIST_TIMEOUT_MS });
    const replyText = await waitForAssistantText();
    const uiObservedAt = Date.now();
    duration = uiObservedAt - start;
    status = 'ok';
    const wsSignal = await Promise.race([
      wsPromise,
      page.waitForTimeout(5_000).then(() => null),
    ]);
    const wsEvent = wsSignal && wsSignal.ok ? wsSignal.value : null;
    const metrics = calcMetrics(duration, wsEvent);
    detail = await addContextToDetail(metricsToDetail(metrics), { wsEvent, uiObservedAt });
    const wsState = metrics.wsLatencyMs !== null ? 'ws+ui' : 'ui-only';
    console.log(
      `[VU ${userId}] reply in ${duration} ms (${wsState}, ws=${metrics.wsLatencyMs ?? 'n/a'} ms, ui-ws=${metrics.uiMinusWsMs ?? 'n/a'} ms): ${replyText.slice(0, 120)}`,
    );

    await test.info().attach('load-timing-context', {
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify(
          {
            userId,
            question,
            status,
            durationMs: duration,
            sentAtUtc: isoTs(start),
            wsAtUtc: isoTs(wsEvent?.observedAt),
            uiAtUtc: isoTs(uiObservedAt),
            wsEvent: wsEvent?.frame ?? null,
            wsUrl: wsEvent?.url ?? null,
            wsUrls: await readWsUrls(page),
            streamCapture,
          },
          null,
          2,
        ),
      ),
    });
  } catch (err: any) {
    duration = Date.now() - start;
    const wsResult = await wsPromise;
    if (wsResult.ok && wsResult.value?.frame) {
      status = 'ui_not_rendered_ws_received';
      const wsMessage = String(wsResult.value.message ?? '').replace(/\s+/g, ' ').trim();
      const wsPreview = wsMessage.slice(0, 160);
      const metrics = calcMetrics(null, wsResult.value);
      detail = await addContextToDetail(`${metricsToDetail(metrics)}; ws=true; message="${wsPreview}"`, {
        wsEvent: wsResult.value,
        uiObservedAt: null,
      });

      await test.info().attach('ws-ui-mismatch', {
        contentType: 'application/json',
        body: Buffer.from(
          JSON.stringify(
            {
              userId,
              durationMs: duration,
              metrics,
              question,
              wsUrl: wsResult.value.url,
              wsObservedAt: wsResult.value.observedAt,
              wsEventType: wsResult.value.eventType ?? null,
              wsMessage: wsMessage || null,
              uiError: err?.message || String(err),
              wsUrls: await page.evaluate(() => (window as any).__wsUrls || []),
              streamCapture,
            },
            null,
            2,
          ),
        ),
      });

      console.warn(
        `[VU ${userId}] reply failed (${status}) after ${duration} ms; WS message received but UI bubble stayed empty`,
      );

      logResult(userId, duration, status, detail);
      throw new Error(
        `Assistant WS message received but UI text not rendered in ${UI_ASSIST_TIMEOUT_MS}ms`,
      );
    }

    const errText = err?.message?.toString?.() ?? String(err);
    status = /timeout/i.test(errText) ? 'timeout' : 'error';
    detail = await addContextToDetail(
      `avatar_ui_latency_ms=n/a; ws_latency_ms=n/a; ui_minus_ws_ms=n/a; error="${errText.slice(0, 160)}"`,
      { wsEvent: null, uiObservedAt: null },
    );
    console.warn(`[VU ${userId}] reply failed (${status}) after ${duration} ms`);
    logResult(userId, duration, status, detail);
    throw err;
  }

  logResult(userId, duration, status, detail);
}

function lineBreak(): string {
  return process.platform === 'win32' ? '\r\n' : '\n';
}

function logResult(userId: number, durationMs: number, status: ResultStatus, detail?: string) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const suffix = detail ? `\t${detail}` : '';
  fs.appendFileSync(
    LOG_FILE,
    `${timestamp}\tVU ${userId}\t${status}\t${durationMs} ms${suffix}${lineBreak()}`,
  );
}

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`[@smoke][@e2e] virtual user #${userId} receives reply`, async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    await sendAndMeasure(page, userId);
  });
}
