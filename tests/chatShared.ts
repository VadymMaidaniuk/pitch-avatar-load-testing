import { expect, Page } from '@playwright/test';
import { CHAT_URL } from './chatConfig';

export const SELECTORS = {
  startButton: 'button[title="Tap to start"], button:has(svg[data-icon="play"])',
  messageInput: 'textarea[placeholder="Send a message"]',
  sendButton: 'form button.sc-izQBue',
  messageList: 'ul.sc-fKWMtX',
  assistantBubble: 'ul.sc-fKWMtX li[type="assistant"]',
};

const TOPIC_WORDS = [
  'analytics',
  'automation',
  'security',
  'compliance',
  'scalability',
  'resilience',
  'performance',
  'observability',
  'integration',
  'governance',
];

function randomTopic(userId: number): string {
  const word = TOPIC_WORDS[Math.floor(Math.random() * TOPIC_WORDS.length)];
  const slug = Math.random().toString(36).slice(2, 6);
  return `${word}-${userId}-${slug}`;
}

export function buildQuestion(userId: number): string {
  return `Tell me about ${randomTopic(userId)}`;
}

export function userBubble(page: Page, text: string) {
  return page.locator(`ul.sc-fKWMtX li[type="sent"]:has-text("${text}")`).first();
}

export function assistantBubbles(page: Page) {
  return page.locator(SELECTORS.assistantBubble);
}

export async function openChat(page: Page) {
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });

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
  await messageList.waitFor({ state: 'visible', timeout: 30_000 });

  return { input, sendButton, messageList };
}
