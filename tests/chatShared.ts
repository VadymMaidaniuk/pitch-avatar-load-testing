import { expect, Page } from '@playwright/test';
import { CHAT_URL } from './chatConfig';

export const SELECTORS = {
  startButton: 'button[title="Tap to start"], button:has(svg[data-icon="play"])',
  messageInput: 'textarea[placeholder="Send a message"]',
  sendButton: 'form button.sc-izQBue',
  messageList: 'ul.sc-fKWMtX',
  assistantBubble: 'ul.sc-fKWMtX li[type="assistant"]',
};

const QUESTION_POOL: string[] = [
  'Explain the trolley problem in simple terms.',
  'Give a creative use case for paper clips.',
  'Describe how a blockchain works without buzzwords.',
  'Summarize quantum entanglement in two sentences.',
  'Invent a slogan for a fictional interstellar delivery service.',
  'Outline steps to debug a slow API.',
  'Propose three ways to reduce food waste in cities.',
  'Explain why the sky is blue to a five-year-old.',
  'Draft a checklist for safe database migrations.',
  'Compare supervised vs unsupervised learning.',
  'Write a haiku about resilience.',
  'Explain Pythagoras theorem with a metaphor.',
  'List five cognitive biases and give one-liners for each.',
  'Describe how DNS works as if it were a phone book.',
  'Suggest a simple daily routine to improve focus.',
  'Explain zero trust in plain language.',
  'Give an example of a good feature flag rollout plan.',
  'Summarize the prisoner\'s dilemma and a real-world parallel.',
  'Propose a policy to limit misinformation online.',
  'Explain event-driven architecture to a new grad.',
  'Describe the lifecycle of an HTTP request in a browser.',
  'List three metrics to judge writing quality.',
  'Explain CAP theorem concisely.',
  'Give a beginner recipe using only five ingredients.',
  'Outline a strategy to learn a new language in 30 days.',
  'Explain public key cryptography without math.',
  'Suggest three ways to make meetings shorter.',
  'Describe how garbage collection works in managed languages.',
  'Write two lines of motivational advice.',
  'Explain what makes a survey statistically valid.',
  'Give a metaphor for continuous integration.',
  'Draft a short code review checklist.',
  'Explain rate limiting and why it matters.',
  'Propose three experiments to improve onboarding UX.',
  'Summarize how photosynthesis works.',
  'Explain recursion to someone learning to code.',
  'Describe the difference between latency and throughput.',
  'Suggest a simple way to start meditating.',
  'Explain how Wi-Fi keeps data private.',
  'List common causes of production incidents.',
  'Give a plan to memorize a poem quickly.',
  'Explain blue-green deployment plainly.',
  'Propose a test plan for a login form.',
  'Describe why backups need restores to be tested.',
  'Explain what makes a password strong.',
  'Suggest practices to avoid burnout.',
  'Summarize how compilers differ from interpreters.',
  'Describe how recommendation systems work at a high level.',
  'Explain what a seed phrase is in crypto.',
  'Give tips to design accessible forms.',
  'Outline how to validate a business idea in one week.',
  'Explain why indexes speed up database queries.',
  'Draft a one-sentence pep talk.',
];

export function buildQuestion(userId: number): string {
  const idx = (userId - 1) % QUESTION_POOL.length;
  const base = QUESTION_POOL[idx];
  const salt = `${userId}-${Date.now()}`;
  return `${base} [${salt}]`;
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
