import { expect, test } from '../fixtures/test';
import {
  CMS_CHAT_AVATAR_SCENARIO_NAMES,
  type CmsChatAvatarScenarioName,
  getCmsChatAvatarScenarioDefinition,
} from '../helpers/chatAvatarScenarios';
import {
  summarizeCmsAvatarTimings,
  type CmsAvatarLoggedStep,
} from '../helpers/cmsAvatarTiming';
import { CMS_EMAIL, CMS_PASSWORD } from '../helpers/chatConfig';
import { CmsChatAvatarDataService } from '../services/avatar/CmsChatAvatarDataService';

const SCENARIOS: CmsChatAvatarScenarioName[] = [...CMS_CHAT_AVATAR_SCENARIO_NAMES];

for (const scenarioName of SCENARIOS) {
  const scenario = getCmsChatAvatarScenarioDefinition(scenarioName);
  const scenarioTagBlock = [`@api`, `@cms`, `@data`, `@sc_${scenario.id}`, ...scenario.tags]
    .map((tag) => `[${tag}]`)
    .join('');

  test(`${scenarioTagBlock} CMS creates data-driven avatar for ${scenario.title}`, async ({ request }, testInfo) => {
    test.setTimeout(10 * 60 * 1000);
    test.skip(process.env.CHAT_RUN_CMS_DATA !== '1', 'Set CHAT_RUN_CMS_DATA=1 to run CMS data scenarios.');
    test.skip(!CMS_EMAIL || !CMS_PASSWORD, 'Set CMS_EMAIL and CMS_PASSWORD to run CMS avatar creation.');

    const startedAt = Date.now();
    const steps: CmsAvatarLoggedStep[] = [];
    const logger = async (message: string, context?: Record<string, unknown>) => {
      const ts = Date.now();
      steps.push({ ts, message, context });
      const details = context ? ` ${JSON.stringify(context)}` : '';
      console.log(`[CMS Avatar Data][${scenario.id}] ${message}${details}`);
    };

    const service = new CmsChatAvatarDataService(request);
    const result = await service.createAvatar({
      ...scenario.data,
      logger,
    });
    const finishedAt = Date.now();
    const timings = summarizeCmsAvatarTimings(steps, startedAt, finishedAt);
    const presentationTimingLog = {
      sourcePresentationId: timings.sourcePresentationId,
      sourcePresentationUploadMs: timings.sourcePresentationUploadMs,
      sourcePresentationUploadSec:
        timings.sourcePresentationUploadMs !== null
          ? Number((timings.sourcePresentationUploadMs / 1000).toFixed(1))
          : null,
      sourcePresentationParsingMs: timings.sourcePresentationParsingMs,
      sourcePresentationParsingSec:
        timings.sourcePresentationParsingMs !== null
          ? Number((timings.sourcePresentationParsingMs / 1000).toFixed(1))
          : null,
    };
    const creationTimingLog = {
      totalCreationMs: timings.totalCreationMs,
      totalCreationSec: Number((timings.totalCreationMs / 1000).toFixed(1)),
    };
    console.log(`[CMS Avatar Data][${scenario.id}] Presentation timing ${JSON.stringify(presentationTimingLog)}`);
    console.log(`[CMS Avatar Data][${scenario.id}] Creation timing ${JSON.stringify(creationTimingLog)}`);

    expect(result.assistantId).toBeTruthy();
    expect(result.presentationId).toBeTruthy();
    expect(result.sourcePresentationId).toBeTruthy();
    expect(result.screeningId).toBeTruthy();
    expect(result.shortLink).toBeTruthy();
    expect(result.url).toContain(result.shortLink);

    await testInfo.attach(`cms-chat-avatar-data-${scenario.id}`, {
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify(
          {
            result,
            steps,
            timings: {
              presentation: presentationTimingLog,
              creation: creationTimingLog,
            },
          },
          null,
          2,
        ),
      ),
    });
  });
}
