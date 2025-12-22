import { expect, Page } from '@playwright/test';
import { CHAT_URL } from './chatConfig';

export const SELECTORS = {
  startButton: 'button[title="Tap to start"], button:has(svg[data-icon="play"])',
  messageInput: 'textarea[placeholder*="message" i], textarea[aria-label*="message" i]',
  sendButton:
    'button[type="submit"], button[aria-label*="send" i], button:has(svg), button:has(img[alt*="send" i])',
  messageList: 'ul, [role="list"]',
  assistantBubble:
    'li[type="assistant"], li[data-author="assistant"], li[aria-label*="assistant" i], [role="listitem"][data-author="assistant"], li:has-text("Chat Avatar")',
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

const chatContainer = (page: Page) =>
  page.locator('section, div, aside').filter({ has: page.locator(SELECTORS.messageInput) }).first();

export function userBubble(page: Page, text: string) {
  const container = chatContainer(page);
  const list = container.locator(SELECTORS.messageList).first();
  return list.locator(`li[type="sent"]:has-text("${text}"), li:has-text("${text}")`).first();
}

export function assistantBubbles(page: Page) {
  const container = chatContainer(page);
  const list = container.locator(SELECTORS.messageList).first();
  return list.locator(SELECTORS.assistantBubble);
}

export async function openChat(page: Page) {
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });

  const input = page.locator(SELECTORS.messageInput).first();
  await expect(input).toBeVisible({ timeout: 60_000 });
  await expect(input).toBeEnabled({ timeout: 60_000 });

  const sendButton = input.locator('xpath=ancestor::form[1]').locator(SELECTORS.sendButton).first();
  const container = chatContainer(page);
  const messageList = container.locator(SELECTORS.messageList).first();
  await expect(messageList).toBeVisible({ timeout: 30_000 });

  return { input, sendButton, messageList };
}
