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

async function sendAndMeasure(page: Page, userId: number) {
  let status: 'ok' | 'timeout' | 'error' = 'error';
  let duration = 0;

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
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const frames: { url: string; data: string }[] = (window as any).__wsFrames || [];
        for (const f of frames) {
          try {
            const parsed = JSON.parse(f.data);
            if (parsed?.event_type === 'assistant_chat_message' || parsed?.message) {
              return parsed;
            }
          } catch {
            continue;
          }
        }
        return null;
      },
      { timeout: UI_ASSIST_TIMEOUT_MS },
    );
    return (await handle.jsonValue()) as any;
  };

  try {
    await expect(newBotBubble).toBeVisible({ timeout: UI_ASSIST_TIMEOUT_MS });
    const replyText = await waitForAssistantText();
    duration = Date.now() - start;
    status = 'ok';
    console.log(`[VU ${userId}] reply in ${duration} ms: ${replyText.slice(0, 120)}`);
  } catch (err: any) {
    duration = Date.now() - start;
    status = err?.message?.toString().includes('Timeout') ? 'timeout' : 'error';
    console.warn(`[VU ${userId}] reply failed (${status}) after ${duration} ms`);
    logResult(userId, duration, status);
    throw err;
  }

  logResult(userId, duration, status);
}

function lineBreak(): string {
  return process.platform === 'win32' ? '\r\n' : '\n';
}

function logResult(userId: number, durationMs: number, status: 'ok' | 'timeout' | 'error') {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  fs.appendFileSync(
    LOG_FILE,
    `${timestamp}\tVU ${userId}\t${status}\t${durationMs} ms${lineBreak()}`,
  );
}

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`[@smoke][@e2e] virtual user #${userId} receives reply`, async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    await sendAndMeasure(page, userId);
  });
}
