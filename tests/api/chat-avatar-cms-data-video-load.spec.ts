import type { TestInfo } from '@playwright/test';
import { expect, test } from '../fixtures/test';
import {
  getCmsChatAvatarScenarioDefinition,
  type CmsChatAvatarScenarioName,
} from '../helpers/chatAvatarScenarios';
import {
  buildCmsLoadUsers,
  CMS_LOAD_SCENARIO,
  type CmsLoadUser,
} from '../helpers/cmsLoadConfig';
import {
  summarizeCmsAvatarTimings,
  type CmsAvatarLoggedStep,
} from '../helpers/cmsAvatarTiming';
import type { CreateCmsChatAvatarDataOptions } from '../services/avatar/CmsChatAvatarDataService';
import { CmsChatAvatarDataService } from '../services/avatar/CmsChatAvatarDataService';

const IS_LOAD_RUN = process.env.CHAT_RUN_CMS_DATA_VIDEO_LOAD === '1';
const LOAD_USERS = IS_LOAD_RUN ? buildCmsLoadUsers() : [];
const SCENARIO_NAME = CMS_LOAD_SCENARIO as CmsChatAvatarScenarioName;
const SCENARIO = getCmsChatAvatarScenarioDefinition(SCENARIO_NAME);
const SCENARIO_TAG_BLOCK = [`@api`, `@cms`, `@load`, `@video`, `@sc_${SCENARIO.id}`, ...SCENARIO.tags]
  .map((tag) => `[${tag}]`)
  .join('');

for (const loadUser of LOAD_USERS) {
  test(
    `${SCENARIO_TAG_BLOCK} CMS creates data-driven video avatar for ${SCENARIO.title} with ${loadUser.email}`,
    async ({ request }, testInfo) => {
      test.setTimeout(15 * 60 * 1000);
      test.skip(
        process.env.CHAT_RUN_CMS_DATA_VIDEO_LOAD !== '1',
        'Set CHAT_RUN_CMS_DATA_VIDEO_LOAD=1 to run CMS video load scenarios.',
      );

      const startedAt = Date.now();
      const steps: CmsAvatarLoggedStep[] = [];
      const logger = async (message: string, context?: Record<string, unknown>) => {
        const ts = Date.now();
        steps.push({ ts, message, context });
        const details = context ? ` ${JSON.stringify(context)}` : '';
        console.log(`[CMS Avatar Video Load][${SCENARIO.id}][${loadUser.email}] ${message}${details}`);
      };

      await logger('Load user assigned', {
        cmsUserEmail: loadUser.email,
        cmsUserIndex: loadUser.index,
        scenarioName: SCENARIO.id,
        scenarioTitle: SCENARIO.title,
      });

      const service = new CmsChatAvatarDataService(request);
      const uniqueName = `aqa-load-${SCENARIO.id}-${String(loadUser.index).padStart(2, '0')}-${Date.now()}`;
      const result = await service.createAvatar({
        ...SCENARIO.data,
        avatarMode: 'video',
        chatName: uniqueName,
        email: loadUser.email,
        logger,
        name: uniqueName,
        password: loadUser.password,
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

      console.log(
        `[CMS Avatar Video Load][${SCENARIO.id}][${loadUser.email}] Presentation timing ${JSON.stringify(presentationTimingLog)}`,
      );
      console.log(
        `[CMS Avatar Video Load][${SCENARIO.id}][${loadUser.email}] Creation timing ${JSON.stringify(creationTimingLog)}`,
      );

      expect(result.assistantId).toBeTruthy();
      expect(result.presentationId).toBeTruthy();
      expect(result.sourcePresentationId).toBeTruthy();
      expect(result.screeningId).toBeTruthy();
      expect(result.shortLink).toBeTruthy();
      expect(result.url).toContain(result.shortLink);

      await attachLoadArtifact(testInfo, loadUser, SCENARIO.data, result, steps, {
        creation: creationTimingLog,
        presentation: presentationTimingLog,
      });
    },
  );
}

async function attachLoadArtifact(
  testInfo: TestInfo,
  loadUser: CmsLoadUser,
  scenario: Omit<CreateCmsChatAvatarDataOptions, 'logger'>,
  result: Record<string, unknown>,
  steps: CmsAvatarLoggedStep[],
  timings: Record<string, unknown>,
) {
  await testInfo.attach(`cms-chat-avatar-data-video-load-${loadUser.index}`, {
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify(
        {
          cmsUserEmail: loadUser.email,
          cmsUserIndex: loadUser.index,
          result,
          scenario,
          steps,
          timings,
        },
        null,
        2,
      ),
    ),
  });
}
