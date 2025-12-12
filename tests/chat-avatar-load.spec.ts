import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { CHAT_URL, UI_USERS, UI_ASSIST_TIMEOUT_MS, RUN_ID } from './chatConfig';

test.describe.configure({ mode: "parallel" });

const LOG_DIR = path.join(__dirname, "..", "test-results");
const LOG_RUN_ID = process.env.CHAT_LOG_RUN_ID ?? RUN_ID;
const LOG_FILE = path.join(LOG_DIR, `chat-reply-times-${LOG_RUN_ID}.log`);
const TEST_TIMEOUT_MS = Math.max(UI_ASSIST_TIMEOUT_MS + 120_000, 180_000);

const SELECTORS = {
  startButton: 'button[title="Tap to start"], button:has(svg[data-icon="play"])',
  messageInput: 'textarea[placeholder="Send a message"]',
  sendButton: 'form button.sc-izQBue',
  messageList: 'ul.sc-fKWMtX',
  userBubble: (text: string) => `ul.sc-fKWMtX li[type="sent"]:has-text("${text}")`,
  assistantBubble: 'ul.sc-fKWMtX li[type="assistant"]',
};

async function sendAndMeasure(page: import("@playwright/test").Page, userId: number) {
  let status: "ok" | "timeout" | "error" = "error";
  let duration = 0;
  await page.goto(CHAT_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });

  const tapToStart = page.locator('button[title="Tap to start"]').first();
  if (await tapToStart.isVisible().catch(() => false)) {
    await tapToStart.click();
  } else {
    const genericPlay = page.locator(SELECTORS.startButton).first();
    if (await genericPlay.isVisible().catch(() => false)) {
      await genericPlay.click();
    }
  }

  const input = page.locator(SELECTORS.messageInput);
  await expect(input).toBeVisible({ timeout: 60_000 });
  await expect(input).toBeEnabled({ timeout: 60_000 });

  const sendButton = page.locator(SELECTORS.sendButton);
  const messageList = page.locator(SELECTORS.messageList);
  await messageList.waitFor({ state: "visible", timeout: 30_000 });

  const topic = randomTopic(userId);
  const question = `Tell me about ${topic}`;
  await input.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });

  const assistantBubbles = page.locator(SELECTORS.assistantBubble);
  const botCountBefore = await assistantBubbles.count();

  const start = Date.now();
  await sendButton.click();

  await expect(page.locator(SELECTORS.userBubble(question))).toBeVisible({ timeout: 20_000 });

  const newBotBubble = assistantBubbles.nth(botCountBefore);
  try {
    await expect(newBotBubble).toBeVisible({ timeout: UI_ASSIST_TIMEOUT_MS });
    await expect(newBotBubble).toContainText(/\S/, { timeout: UI_ASSIST_TIMEOUT_MS });
    duration = Date.now() - start;
    status = "ok";
    console.log(`[VU ${userId}] reply in ${duration} ms`);
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

function randomTopic(userId: number): string {
  const words = [
    "analytics",
    "automation",
    "security",
    "compliance",
    "scalability",
    "resilience",
    "performance",
    "observability",
    "integration",
    "governance",
  ];
  const word = words[Math.floor(Math.random() * words.length)];
  const slug = Math.random().toString(36).slice(2, 6);
  return `${word}-${userId}-${slug}`;
}

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`virtual user #${userId} receives reply`, async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    await sendAndMeasure(page, userId);
  });
}
