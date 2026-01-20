import type { Locator, Page } from '@playwright/test';
import { CHAT_URL } from '../helpers/chatConfig';

export const CHAT_SELECTORS = {
  startButton: 'button[title="Tap to start"], button:has(svg[data-icon="play"])',
  messageInput: 'textarea[placeholder*="message" i], textarea[aria-label*="message" i]',
  sendButton:
    'button[type="submit"], button[aria-label*="send" i], button:has(svg), button:has(img[alt*="send" i])',
  messageList: 'ul, [role="list"]',
  assistantBubble:
    'li[type="assistant"], li[data-author="assistant"], li[aria-label*="assistant" i], [role="listitem"][data-author="assistant"], li:has-text("Chat Avatar")',
};

export class ChatPage {
  constructor(readonly page: Page) {}

  get input(): Locator {
    return this.page.locator(CHAT_SELECTORS.messageInput).first();
  }

  get sendButton(): Locator {
    return this.input.locator('xpath=ancestor::form[1]').locator(CHAT_SELECTORS.sendButton).first();
  }

  get messageList(): Locator {
    return this.container.locator(CHAT_SELECTORS.messageList).first();
  }

  private get container(): Locator {
    return this.page
      .locator('section, div, aside')
      .filter({ has: this.input })
      .first();
  }

  assistantBubbles(): Locator {
    return this.messageList.locator(CHAT_SELECTORS.assistantBubble);
  }

  userBubble(text: string): Locator {
    return this.messageList
      .locator(`li[type="sent"]:has-text("${text}"), li:has-text("${text}")`)
      .first();
  }

  async open(): Promise<void> {
    await this.page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await this.input.waitFor({ state: 'visible', timeout: 60_000 });
    await this.messageList.waitFor({ state: 'visible', timeout: 30_000 });
  }
}
