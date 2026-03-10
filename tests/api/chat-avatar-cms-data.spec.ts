import { expect, test } from '../fixtures/test';
import {
  type CmsChatAvatarScenarioName,
  getCmsChatAvatarScenario,
} from '../helpers/chatAvatarScenarios';
import { CMS_EMAIL, CMS_PASSWORD } from '../helpers/chatConfig';
import { CmsChatAvatarDataService } from '../services/avatar/CmsChatAvatarDataService';

const SCENARIOS: CmsChatAvatarScenarioName[] = [
  'presentation_only',
  'presentation_with_mixed_knowledge',
];

for (const scenarioName of SCENARIOS) {
  test(`[@api][@cms] CMS creates data-driven avatar for ${scenarioName}`, async ({ request }, testInfo) => {
    test.setTimeout(10 * 60 * 1000);
    test.skip(process.env.CHAT_RUN_CMS_DATA !== '1', 'Set CHAT_RUN_CMS_DATA=1 to run CMS data scenarios.');
    test.skip(!CMS_EMAIL || !CMS_PASSWORD, 'Set CMS_EMAIL and CMS_PASSWORD to run CMS avatar creation.');

    const steps: Array<{ message: string; context?: Record<string, unknown> }> = [];
    const logger = async (message: string, context?: Record<string, unknown>) => {
      steps.push({ message, context });
      const details = context ? ` ${JSON.stringify(context)}` : '';
      console.log(`[CMS Avatar Data][${scenarioName}] ${message}${details}`);
    };

    const service = new CmsChatAvatarDataService(request);
    const result = await service.createAvatar({
      ...getCmsChatAvatarScenario(scenarioName),
      logger,
    });

    expect(result.assistantId).toBeTruthy();
    expect(result.presentationId).toBeTruthy();
    expect(result.sourcePresentationId).toBeTruthy();
    expect(result.screeningId).toBeTruthy();
    expect(result.shortLink).toBeTruthy();
    expect(result.url).toContain(result.shortLink);

    await testInfo.attach(`cms-chat-avatar-data-${scenarioName}`, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ result, steps }, null, 2)),
    });
  });
}
