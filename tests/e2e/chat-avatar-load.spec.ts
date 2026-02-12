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
  url?: string;
  observedAt?: number;
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

async function sendAndMeasure(page: Page, userId: number) {
  let status: ResultStatus = 'error';
  let duration = 0;
  let detail = '';

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
            if (parsed?.event_type === 'assistant_chat_message' || parsed?.message) {
              return {
                frame: parsed,
                url: f.url,
                observedAt: f.ts,
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

  try {
    await expect(newBotBubble).toBeVisible({ timeout: UI_ASSIST_TIMEOUT_MS });
    const replyText = await waitForAssistantText();
    duration = Date.now() - start;
    status = 'ok';
    const wsSignal = await Promise.race([
      wsPromise,
      page.waitForTimeout(2_000).then(() => null),
    ]);
    const wsState = wsSignal && wsSignal.ok ? 'ws+ui' : 'ui-only';
    console.log(`[VU ${userId}] reply in ${duration} ms (${wsState}): ${replyText.slice(0, 120)}`);
  } catch (err: any) {
    duration = Date.now() - start;
    const wsResult = await wsPromise;
    if (wsResult.ok && wsResult.value?.frame) {
      status = 'ui_not_rendered_ws_received';
      const wsMessage = String(wsResult.value.frame?.message ?? '').replace(/\s+/g, ' ').trim();
      const wsPreview = wsMessage.slice(0, 160);
      detail = `ws=true; message="${wsPreview}"`;

      await test.info().attach('ws-ui-mismatch', {
        contentType: 'application/json',
        body: Buffer.from(
          JSON.stringify(
            {
              userId,
              durationMs: duration,
              question,
              wsUrl: wsResult.value.url,
              wsObservedAt: wsResult.value.observedAt,
              wsMessage: wsMessage || null,
              uiError: err?.message || String(err),
              wsUrls: await page.evaluate(() => (window as any).__wsUrls || []),
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
    console.warn(`[VU ${userId}] reply failed (${status}) after ${duration} ms`);
    logResult(userId, duration, status, `error="${errText.slice(0, 160)}"`);
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
