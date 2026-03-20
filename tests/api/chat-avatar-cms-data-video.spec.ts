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
import {
  getCmsTestUserForSelection,
  hasCmsTestUserConfig,
} from '../helpers/cmsTestUsers';
import { CmsChatAvatarDataService } from '../services/avatar/CmsChatAvatarDataService';

const SCENARIOS: CmsChatAvatarScenarioName[] = [...CMS_CHAT_AVATAR_SCENARIO_NAMES];
const SCENARIO_CASES = SCENARIOS.map((scenarioName) => {
  const scenario = getCmsChatAvatarScenarioDefinition(scenarioName);
  const scenarioTagBlock = [`@api`, `@cms`, `@video`, `@sc_${scenario.id}`, ...scenario.tags]
    .map((tag) => `[${tag}]`)
    .join('');

  return {
    scenario,
    testTitle: `${scenarioTagBlock} CMS creates data-driven video avatar for ${scenario.title}`,
  };
});

for (const scenarioCase of SCENARIO_CASES) {
  const { scenario, testTitle } = scenarioCase;
  test(testTitle, async ({ request }, testInfo) => {
    test.setTimeout(10 * 60 * 1000);
    test.skip(
      process.env.CHAT_RUN_CMS_DATA_VIDEO !== '1',
      'Set CHAT_RUN_CMS_DATA_VIDEO=1 to run CMS video data scenarios.',
    );
    test.skip(
      !hasCmsTestUserConfig(),
      'Set CMS_LOAD_USER_PREFIX, CMS_LOAD_USER_DOMAIN, and CMS_LOAD_USER_PASSWORD to run CMS avatar creation.',
    );

    const cmsUser = getCmsTestUserForSelection({
      config: testInfo.config,
      currentTitle: testTitle,
      filePath: testInfo.file,
      grep: testInfo.project.grep,
      grepInvert: testInfo.project.grepInvert,
      projectName: testInfo.project.name,
      titles: SCENARIO_CASES.map((item) => item.testTitle),
    });

    const startedAt = Date.now();
    const steps: CmsAvatarLoggedStep[] = [];
    const logger = async (message: string, context?: Record<string, unknown>) => {
      const ts = Date.now();
      steps.push({ ts, message, context });
      const details = context ? ` ${JSON.stringify(context)}` : '';
      console.log(`[CMS Avatar Video Data][${scenario.id}] ${message}${details}`);
    };
    await logger('Test user assigned', {
      cmsUserEmail: cmsUser.email,
      cmsUserIndex: cmsUser.index,
      scenarioName: scenario.id,
      scenarioTitle: scenario.title,
    });

    const service = new CmsChatAvatarDataService(request);
    const result = await service.createAvatar({
      ...scenario.data,
      avatarMode: 'video',
      email: cmsUser.email,
      logger,
      password: cmsUser.password,
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
    console.log(`[CMS Avatar Video Data][${scenario.id}] Presentation timing ${JSON.stringify(presentationTimingLog)}`);
    console.log(`[CMS Avatar Video Data][${scenario.id}] Creation timing ${JSON.stringify(creationTimingLog)}`);

    expect(result.assistantId).toBeTruthy();
    expect(result.presentationId).toBeTruthy();
    expect(result.sourcePresentationId).toBeTruthy();
    expect(result.screeningId).toBeTruthy();
    expect(result.shortLink).toBeTruthy();
    expect(result.url).toContain(result.shortLink);

    await testInfo.attach(`cms-chat-avatar-data-video-${scenario.id}`, {
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify(
          {
            cmsUserEmail: cmsUser.email,
            cmsUserIndex: cmsUser.index,
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
