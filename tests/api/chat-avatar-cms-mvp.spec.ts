import { test, expect } from '../fixtures/test';
import { CMS_EMAIL, CMS_PASSWORD } from '../helpers/chatConfig';
import { CmsChatAvatarMvpService } from '../services/avatar/CmsChatAvatarMvpService';

test('[@api][@cms] CMS creates a usable widget avatar and returns a screening link', async ({ request }, testInfo) => {
  test.skip(process.env.CHAT_RUN_CMS_MVP !== '1', 'Set CHAT_RUN_CMS_MVP=1 to run the CMS MVP example.');
  test.skip(!CMS_EMAIL || !CMS_PASSWORD, 'Set CMS_EMAIL and CMS_PASSWORD to run CMS avatar creation.');

  const steps: Array<{ message: string; context?: Record<string, unknown> }> = [];
  const logger = async (message: string, context?: Record<string, unknown>) => {
    steps.push({ message, context });
    const details = context ? ` ${JSON.stringify(context)}` : '';
    console.log(`[CMS Avatar MVP] ${message}${details}`);
  };

  const service = new CmsChatAvatarMvpService(request);
  const result = await service.createWidgetAvatar({ logger });

  expect(result.assistantId).toBeTruthy();
  expect(result.screeningId).toBeTruthy();
  expect(result.shortLink).toBeTruthy();
  expect(result.url).toContain(result.shortLink);

  await testInfo.attach('cms-chat-avatar-mvp', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ result, steps }, null, 2)),
  });
});
