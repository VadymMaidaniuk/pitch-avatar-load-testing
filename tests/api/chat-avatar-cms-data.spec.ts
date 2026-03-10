import { expect, test } from '../fixtures/test';
import {
  type CmsChatAvatarScenarioName,
  getCmsChatAvatarScenario,
} from '../helpers/chatAvatarScenarios';
import {
  summarizeCmsAvatarTimings,
  type CmsAvatarLoggedStep,
} from '../helpers/cmsAvatarTiming';
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

    const startedAt = Date.now();
    const steps: CmsAvatarLoggedStep[] = [];
    const logger = async (message: string, context?: Record<string, unknown>) => {
      const ts = Date.now();
      steps.push({ ts, message, context });
      const details = context ? ` ${JSON.stringify(context)}` : '';
      console.log(`[CMS Avatar Data][${scenarioName}] ${message}${details}`);
    };

    const service = new CmsChatAvatarDataService(request);
    const result = await service.createAvatar({
      ...getCmsChatAvatarScenario(scenarioName),
      logger,
    });
    const finishedAt = Date.now();
    const timings = summarizeCmsAvatarTimings(steps, startedAt, finishedAt);
    const timingLog = {
      sourcePresentationId: timings.sourcePresentationId,
      sourcePresentationParsingMs: timings.sourcePresentationParsingMs,
      sourcePresentationParsingSec:
        timings.sourcePresentationParsingMs !== null
          ? Number((timings.sourcePresentationParsingMs / 1000).toFixed(1))
          : null,
      totalCreationMs: timings.totalCreationMs,
      totalCreationSec: Number((timings.totalCreationMs / 1000).toFixed(1)),
    };
    console.log(`[CMS Avatar Data][${scenarioName}] Timing summary ${JSON.stringify(timingLog)}`);

    expect(result.assistantId).toBeTruthy();
    expect(result.presentationId).toBeTruthy();
    expect(result.sourcePresentationId).toBeTruthy();
    expect(result.screeningId).toBeTruthy();
    expect(result.shortLink).toBeTruthy();
    expect(result.url).toContain(result.shortLink);

    await testInfo.attach(`cms-chat-avatar-data-${scenarioName}`, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ result, steps, timings: timingLog }, null, 2)),
    });
  });
}
