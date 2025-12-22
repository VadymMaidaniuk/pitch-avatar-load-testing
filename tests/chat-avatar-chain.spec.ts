import { test, expect, Page, Locator } from '@playwright/test';
import { UI_ASSIST_TIMEOUT_MS, UI_USERS } from './chatConfig';
import { openChat, buildQuestion, userBubble, assistantBubbles } from './chatShared';

// UI reply text is not rendered in headless (bubbles stay with loader SVG), so run headed.
test.use({ headless: false });

const questionCountForUser = (userId: number) => 2 + ((userId - 1) % 3);

async function waitForAssistantText(
  page: Page,
  assistantBubbleLocator: Locator,
  startIndex: number,
  messageList: Locator,
) {
  const deadline = Date.now() + UI_ASSIST_TIMEOUT_MS;
  let lastText = '';
  const stripLabel = (text: string) =>
    text.replace(/^chat avatar\s*(\[[^\]]*])?\s*/i, '').trim();
  const stripTimestamp = (text: string) => text.replace(/\b\d{1,2}:\d{2}\b/g, '').trim();
  const cleanText = (text: string) => stripTimestamp(stripLabel(text.replace(/\s+/g, ' ').trim()));
  const hasContent = (text: string) => text && /[A-Za-z]/.test(text) && text.length >= 4;
  const isLabelOnly = (text: string) => /^chat avatar\b/i.test(text) || /^\d{1,2}:\d{2}$/.test(text);

  while (Date.now() < deadline) {
    const currentCount = await assistantBubbleLocator.count();
    await messageList
      .evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      })
      .catch(() => {});

    for (let idx = startIndex; idx < currentCount; idx += 1) {
      const candidate = assistantBubbleLocator.nth(idx);
      const parts = (await candidate.locator('p, span, div').allInnerTexts().catch(() => [])) ?? [];
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
}

async function sendAndWait(
  page: Page,
  input: Locator,
  sendButton: Locator,
  messageList: Locator,
  assistantBubbleLocator: Locator,
  question: string,
) {
  await input.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });

  const botCountBefore = await assistantBubbleLocator.count();
  await sendButton.click();
  await expect(userBubble(page, question)).toBeVisible({ timeout: 20_000 });

  return waitForAssistantText(page, assistantBubbleLocator, botCountBefore, messageList);
}

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`virtual user #${userId} asks a chain of questions`, async ({ page }) => {
    const questionCount = questionCountForUser(userId);
    const totalTimeout = Math.max(UI_ASSIST_TIMEOUT_MS * questionCount + 120_000, 180_000);
    test.setTimeout(totalTimeout);

    const { input, sendButton, messageList } = await openChat(page);
    const assistantBubbleLocator = assistantBubbles(page);

    for (let idx = 0; idx < questionCount; idx += 1) {
      const question = buildQuestion(userId + idx);
      const replyText = await sendAndWait(
        page,
        input,
        sendButton,
        messageList,
        assistantBubbleLocator,
        question,
      );
      console.log(`[VU ${userId}] Q${idx + 1}/${questionCount} reply: ${replyText.slice(0, 120)}`);
    }
  });
}
