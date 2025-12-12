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
  'How does this scale for enterprise clients?',
  'What integrations are supported today?',
  'Which metrics improve after rollout?',
  'What’s the ROI story for a CISO?',
  'List the top 3 objections and rebuttals.',
  'Summarize the value in one sentence.',
  'What’s the security model?',
  'How is data stored and encrypted?',
  'What SLAs do you offer?',
  'How does onboarding work?',
  'What does the pricing model look like?',
  'Give a 30-second elevator pitch.',
  'How do you measure success post-launch?',
  'What compliance standards are covered?',
  'Which personas benefit most?',
  'What’s the main differentiator?',
  'How do you handle scale spikes?',
  'What are the roadmap highlights?',
  'How do you support multi-tenant deployments?',
  'Explain the architecture briefly.',
  'What monitoring/observability is built-in?',
  'How do you handle incident response?',
  'What’s the uptime target?',
  'How does this reduce manual work?',
  'What’s the story for finance stakeholders?',
  'How long to implement for mid-market?',
  'What training do users need?',
  'What success stories can you cite?',
  'Summarize in three bullet points.',
  'What are the SLIs you track?',
  'How do you secure APIs?',
  'How is access controlled?',
  'What does day-2 operations look like?',
  'What’s the backup/DR approach?',
  'How do you handle PII?',
  'What is the latency impact?',
  'How does the system degrade gracefully?',
  'What’s the roadmap for AI features?',
  'How do you validate data quality?',
  'What’s the migration path?',
  'How do you ensure reliability?',
  'What are the guardrails for users?',
  'Give a CTA for an exec sponsor.',
  'Give a CTA for a technical lead.',
  'Give a CTA for a security lead.',
  'Give a CTA for a product manager.',
  'What gaps do you see vs. competitors?',
  'How is support structured?',
  'What are the key risks?',
  'What mitigations exist for outages?',
  'What’s the onboarding checklist?',
  'How do you test changes safely?',
  'What’s the rollout strategy?',
  'How do you handle secrets?',
  'What’s the compliance posture?',
  'How do you localize content?',
  'What languages are supported?',
  'What’s the typical payback period?',
  'Give me a 1-line tagline.',
  'Give me a 2-line abstract.',
  'What KPIs should improve in 90 days?',
  'What KPIs should improve in 6 months?',
  'How does this reduce risk?',
  'What’s the total cost of ownership?',
  'How do you benchmark success?',
  'How do you align with security best practices?',
  'How do you handle user privacy?',
  'What’s the change management plan?',
  'What telemetry is collected?',
  'How is data retained or deleted?',
  'What’s the failover design?',
  'Explain the main workflow.',
  'Give a short customer story.',
  'What are the must-have prerequisites?',
  'How do you ensure high availability?',
  'What’s the integration effort?',
  'How do you handle versioning?',
  'What’s the user journey in 5 steps?',
  'How do you ensure auditability?',
  'What alerts matter most?',
  'How do you reduce false positives?',
  'What’s the governance model?',
  'How do you sandbox changes?',
  'What metrics prove adoption?',
  'How does this improve collaboration?',
  'What’s the main risk if we delay?',
  'What’s the single biggest value prop?',
  'How do you tailor for different industries?',
  'What are the minimal viable integrations?',
  'How do you protect against data loss?',
  'What’s the expected time-to-value?',
  'How do you align with exec priorities?',
  'What are common pitfalls to avoid?',
  'Give a one-paragraph overview for a board deck.',
  'Give a one-paragraph overview for engineers.',
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
