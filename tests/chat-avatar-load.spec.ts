import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { UI_USERS, UI_ASSIST_TIMEOUT_MS, RUN_ID } from './chatConfig';
import { openChat, buildQuestion, userBubble, assistantBubbles } from './chatShared';

test.describe.configure({ mode: "parallel" });

const LOG_DIR = path.join(__dirname, "..", "test-results");
const LOG_RUN_ID = process.env.CHAT_LOG_RUN_ID ?? RUN_ID;
const LOG_FILE = path.join(LOG_DIR, `chat-reply-times-${LOG_RUN_ID}.log`);
const TEST_TIMEOUT_MS = Math.max(UI_ASSIST_TIMEOUT_MS + 120_000, 180_000);

async function sendAndMeasure(page: import("@playwright/test").Page, userId: number) {
  let status: "ok" | "timeout" | "error" = "error";
  let duration = 0;
  const { input, sendButton } = await openChat(page);

  const question = buildQuestion(userId);
  await input.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });

  const assistantBubbleLocator = assistantBubbles(page);
  const botCountBefore = await assistantBubbleLocator.count();

  const start = Date.now();
  await sendButton.click();

  await expect(userBubble(page, question)).toBeVisible({ timeout: 20_000 });

  const newBotBubble = assistantBubbleLocator.nth(botCountBefore);
  const waitForAssistantText = async () => {
    const deadline = Date.now() + UI_ASSIST_TIMEOUT_MS;
    let lastText = '';
    const stripLabel = (text: string) =>
      text.replace(/^chat avatar\s*(\[[^\]]*])?\s*/i, '').trim();
    const stripTimestamp = (text: string) => text.replace(/\b\d{1,2}:\d{2}\b/g, '').trim();
    while (Date.now() < deadline) {
      const raw = await newBotBubble.innerText({ timeout: 5_000 }).catch(() => '');
      const cleaned = raw.replace(/\s+/g, ' ').trim();
      const textOnly = stripTimestamp(stripLabel(cleaned));
      lastText = cleaned || lastText;
      if (textOnly && /[A-Za-z]/.test(textOnly) && textOnly.length >= 4) {
        return textOnly;
      }
      await page.waitForTimeout(500);
    }
    throw new Error(
      `Assistant reply text not received in ${UI_ASSIST_TIMEOUT_MS}ms (last text: "${lastText}")`,
    );
  };

  try {
    await expect(newBotBubble).toBeVisible({ timeout: UI_ASSIST_TIMEOUT_MS });
    const replyText = await waitForAssistantText();
    duration = Date.now() - start;
    status = "ok";
    console.log(`[VU ${userId}] reply in ${duration} ms: ${replyText.slice(0, 120)}`);
  } catch (err: any) {
    duration = Date.now() - start;
    status = err?.message?.toString().includes("Timeout") ? "timeout" : "error";
    console.warn(`[VU ${userId}] reply failed (${status}) after ${duration} ms`);
    logResult(userId, duration, status);
    throw err;
  }

  logResult(userId, duration, status);
}

function lineBreak(): string {
  return process.platform === "win32" ? "\r\n" : "\n";
}

function logResult(userId: number, durationMs: number, status: "ok" | "timeout" | "error") {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  fs.appendFileSync(
    LOG_FILE,
    `${timestamp}\tVU ${userId}\t${status}\t${durationMs} ms${lineBreak()}`
  );
}

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`virtual user #${userId} receives reply`, async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    await sendAndMeasure(page, userId);
  });
}
