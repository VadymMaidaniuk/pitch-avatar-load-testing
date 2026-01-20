import type { Page } from '@playwright/test';
import { buildQuestion } from './helpers/chatQuestions';
import { ChatPage, CHAT_SELECTORS } from './pages/ChatPage';

export const SELECTORS = CHAT_SELECTORS;
export { buildQuestion };

export async function openChat(page: Page) {
  const chat = new ChatPage(page);
  await chat.open();
  return { input: chat.input, sendButton: chat.sendButton, messageList: chat.messageList };
}

export function userBubble(page: Page, text: string) {
  const chat = new ChatPage(page);
  return chat.userBubble(text);
}

export function assistantBubbles(page: Page) {
  const chat = new ChatPage(page);
  return chat.assistantBubbles();
}
