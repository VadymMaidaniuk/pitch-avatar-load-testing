import { test, expect } from '../fixtures/test';
import type { Page } from '@playwright/test';
import { UI_ASSIST_TIMEOUT_MS, UI_USERS } from '../helpers/chatConfig';
import { buildQuestion } from '../helpers/chatQuestions';
import { ChatPage } from '../pages/ChatPage';

async function runScenario(page: Page, userId: number) {
  const timeout = Math.max(UI_ASSIST_TIMEOUT_MS + 60_000, 120_000);
  test.setTimeout(timeout);

  // Instrument WS before navigation so we capture frames from the in-page socket.
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    (window as any).__wsFrames = [];
    (window as any).__wsUrls = [];
    const decoder = new TextDecoder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    class InstrumentedWS extends Original {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols as any);
        try {
          (window as any).__wsUrls.push(url);
        } catch {
          // ignore
        }
        this.addEventListener('message', async (event) => {
          try {
            const data = event.data;
            let text = '';
            if (typeof data === 'string') {
              text = data;
            } else if (data instanceof ArrayBuffer) {
              text = decoder.decode(data);
            } else if (data && typeof (data as any).text === 'function') {
              text = await (data as any).text();
            }
            (window as any).__wsFrames.push({ url, data: text });
          } catch {
            // ignore
          }
        });
      }
    }
    // @ts-ignore
    window.WebSocket = InstrumentedWS;
  });

  const chat = new ChatPage(page);
  await chat.open();
  const input = chat.input;
  const sendButton = chat.sendButton;
  const question = buildQuestion(userId);
  await input.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  const sendTs = Date.now();
  await sendButton.click();
  await expect(chat.userBubble(question)).toBeVisible({ timeout: 20_000 });

  const frameHandle = await page.waitForFunction(
    () => {
      const frames: { url: string; data: string }[] = (window as any).__wsFrames || [];
      for (const f of frames) {
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
              message: legacyMessage,
              eventType: legacyType,
              createdAt: typeof parsed?.createdAt === 'string' ? parsed.createdAt : null,
            };
          }

          const envelopeType = typeof parsed?.type === 'string' ? parsed.type : '';
          const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
          const payloadMessage =
            typeof payload?.message === 'string' ? String(payload.message).trim() : '';
          if (
            (envelopeType === 'assistant_chat_message' || envelopeType === 'chat_stream_chunk') &&
            payloadMessage.length > 0
          ) {
            return {
              frame: parsed,
              url: f.url,
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
    { timeout: UI_ASSIST_TIMEOUT_MS },
  );

  const result = (await frameHandle.jsonValue()) as
    | { frame: any; url: string; message: string; eventType: string; createdAt: string | null }
    | null;
  if (!result || !result.frame || !result.message) {
    throw new Error('No assistant_chat_message frame captured');
  }

  expect(result.message).toBeTruthy();
  expect(String(result.message).length).toBeGreaterThan(0);
  if (result.createdAt) {
    expect(new Date(result.createdAt).toString()).not.toBe('Invalid Date');
  }
  const receivedTs = Date.now();
  const latencyMs = receivedTs - sendTs;
  console.log(`[WS] assistant reply latency ${latencyMs} ms`);

  const scrUserID = (() => {
    try {
      const u = new URL(result.url);
      return u.searchParams.get('scrUserID');
    } catch {
      return undefined;
    }
  })();

  await test.info().attach('ws-assistant-event', {
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify({
        scrUserID,
        question,
        wsUrl: result.url,
        wsEventType: result.eventType,
        assistantMessage: result.message,
        event: result.frame,
        sendTimestamp: sendTs,
        receivedTimestamp: receivedTs,
        latencyMs,
        seenWs: await page.evaluate(() => (window as any).__wsUrls || []),
        capturedFramesSample: await page.evaluate(() => (window as any).__wsFrames?.slice(0, 5) || []),
      }),
    ),
  });
}

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`[@smoke][@e2e] UI+WS user #${userId} assistant reply on WS`, async ({ page }) => {
    await runScenario(page, userId);
  });
}
