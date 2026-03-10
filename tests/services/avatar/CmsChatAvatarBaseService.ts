import type { APIRequestContext } from '@playwright/test';
import {
  CMS_AVATAR_IMAGE_ID,
  CMS_AVATAR_LANGUAGE_ID,
  CMS_AVATAR_PROMPT,
  CMS_AVATAR_READY_POLL_MS,
  CMS_AVATAR_READY_TIMEOUT_MS,
  CMS_AVATAR_ROLE_NAME,
  CMS_AVATAR_VOICE_ID,
  CMS_PRESENTATION_READY_POLL_MS,
  CMS_PRESENTATION_READY_TIMEOUT_MS,
} from '../../helpers/chatConfig';
import {
  CmsApiClient,
  type CmsAvatarImageResource,
} from '../api/CmsApiClient';

export type CmsChatAvatarLogger = (
  message: string,
  context?: Record<string, unknown>,
) => void | Promise<void>;

export type CmsResolvedAvatarImage = {
  id: string;
  url: string;
};

export type CmsResolvedRole = {
  id?: string;
  name?: string;
  prompt: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveAvatarImageUrl = (resource: CmsAvatarImageResource): string | undefined =>
  resource.attributes?.plane_image_url ?? resource.attributes?.image_url ?? undefined;

const hasClipMetadata = (resource: CmsAvatarImageResource): boolean => {
  const extraData = resource.attributes?.extra_data;
  const types = resource.attributes?.types ?? '';
  return Boolean(
    extraData?.presenter_id ||
      extraData?.driver_id ||
      extraData?.generation_type === 'clip' ||
      types.includes('clip'),
  );
};

export const extractShortLink = (url: string): string => {
  const pathname = new URL(url).pathname;
  const shortLink = pathname.split('/').filter(Boolean).pop();
  if (!shortLink) {
    throw new Error(`Unable to extract short link from URL: ${url}`);
  }
  return shortLink;
};

export abstract class CmsChatAvatarBaseService {
  protected readonly cmsClient: CmsApiClient;

  constructor(
    protected readonly request: APIRequestContext,
    cmsClient?: CmsApiClient,
  ) {
    this.cmsClient = cmsClient ?? new CmsApiClient(request);
  }

  protected async resolveVoiceId(
    accessToken: string,
    languageId: string = CMS_AVATAR_LANGUAGE_ID,
    preferredVoiceId: string | undefined = CMS_AVATAR_VOICE_ID,
    logger?: CmsChatAvatarLogger,
  ): Promise<string> {
    if (preferredVoiceId) {
      await this.log(logger, 'Using configured speech voice', { voiceId: preferredVoiceId });
      return preferredVoiceId;
    }

    await this.log(logger, 'Resolving speech voice', { languageId });
    const voices = await this.cmsClient.listSpeechVoices(accessToken, languageId);
    const exactMatch =
      voices.find((voice) => voice.attributes?.language === languageId) ??
      voices.find((voice) => voice.attributes?.languages?.includes(languageId));

    if (!exactMatch?.id) {
      throw new Error(`No compatible speech voice found for language "${languageId}"`);
    }

    await this.log(logger, 'Speech voice resolved', {
      voiceId: exactMatch.id,
      voiceName: exactMatch.attributes?.name ?? '',
    });
    return String(exactMatch.id);
  }

  protected async resolveAvatarImage(
    accessToken: string,
    preferredAvatarImageId: string | undefined = CMS_AVATAR_IMAGE_ID,
    logger?: CmsChatAvatarLogger,
  ): Promise<CmsResolvedAvatarImage> {
    if (preferredAvatarImageId) {
      await this.log(logger, 'Using configured avatar image', {
        avatarImageId: preferredAvatarImageId,
      });
      const resource = await this.cmsClient.getAvatarImage(accessToken, preferredAvatarImageId);
      return this.toResolvedAvatarImage(resource);
    }

    await this.log(logger, 'Resolving avatar image');
    const images = await this.cmsClient.listAvatarImages(accessToken);
    const preferred =
      images.find((image) => resolveAvatarImageUrl(image) && !hasClipMetadata(image)) ??
      images.find((image) => resolveAvatarImageUrl(image));

    if (!preferred) {
      throw new Error('No compatible avatar image found for chat avatar flow');
    }

    const resolved = this.toResolvedAvatarImage(preferred);
    await this.log(logger, 'Avatar image resolved', {
      avatarImageId: resolved.id,
      avatarImageUrl: resolved.url,
    });
    return resolved;
  }

  protected async resolveRole(
    accessToken: string,
    roleName: string | undefined = CMS_AVATAR_ROLE_NAME,
    promptOverride?: string,
    logger?: CmsChatAvatarLogger,
  ): Promise<CmsResolvedRole> {
    const fallbackPrompt = promptOverride?.trim() || CMS_AVATAR_PROMPT;
    if (!roleName?.trim()) {
      return { prompt: fallbackPrompt };
    }

    await this.log(logger, 'Resolving assistant role', { roleName });
    const roles = await this.cmsClient.listAssistantRoles(accessToken);
    const matchedRole = roles.find((role) => role.attributes?.name === roleName);

    if (!matchedRole?.id) {
      await this.log(logger, 'Assistant role not found, using prompt fallback', { roleName });
      return { prompt: fallbackPrompt };
    }

    const prompt = promptOverride?.trim() || matchedRole.attributes?.prompt?.trim() || fallbackPrompt;
    await this.log(logger, 'Assistant role resolved', {
      roleId: matchedRole.id,
      roleName: matchedRole.attributes?.name ?? roleName,
    });

    return {
      id: String(matchedRole.id),
      name: matchedRole.attributes?.name ?? roleName,
      prompt,
    };
  }

  protected async waitForAssistantSuccess(
    accessToken: string,
    assistantId: string,
    logger?: CmsChatAvatarLogger,
  ): Promise<void> {
    const deadline = Date.now() + CMS_AVATAR_READY_TIMEOUT_MS;
    let lastStatus: string | null | undefined;

    while (Date.now() <= deadline) {
      const assistant = await this.cmsClient.getAssistant(accessToken, assistantId);
      const status = assistant.status;

      if (status === 'success') {
        await this.log(logger, 'Assistant generation completed', {
          assistantId,
          status,
        });
        return;
      }

      if (status && ['error', 'failed'].includes(status)) {
        throw new Error(`Assistant ${assistantId} generation failed with status "${status}"`);
      }

      if (status !== lastStatus) {
        await this.log(logger, 'Assistant generation in progress', {
          assistantId,
          status: status ?? 'unknown',
        });
        lastStatus = status;
      }

      await sleep(CMS_AVATAR_READY_POLL_MS);
    }

    throw new Error(
      `Assistant ${assistantId} did not reach success within ${CMS_AVATAR_READY_TIMEOUT_MS}ms`,
    );
  }

  protected async waitForPresentationReady(
    accessToken: string,
    presentationId: string,
    minSlidesCount = 0,
    logger?: CmsChatAvatarLogger,
  ): Promise<void> {
    const deadline = Date.now() + CMS_PRESENTATION_READY_TIMEOUT_MS;
    let lastStatus: string | null | undefined;

    while (Date.now() <= deadline) {
      const presentation = await this.cmsClient.getPresentation(accessToken, presentationId);
      const status = presentation.parsingStatus;
      const slidesCount = presentation.slidesCount ?? 0;

      if (status === 'success' && slidesCount >= minSlidesCount) {
        await this.log(logger, 'Presentation parsing completed', {
          presentationId,
          status,
          slidesCount,
        });
        return;
      }

      if (status && ['error', 'failed'].includes(status)) {
        throw new Error(`Presentation ${presentationId} parsing failed with status "${status}"`);
      }

      if (status !== lastStatus) {
        await this.log(logger, 'Presentation parsing in progress', {
          presentationId,
          status: status ?? 'unknown',
          slidesCount,
        });
        lastStatus = status;
      }

      await sleep(CMS_PRESENTATION_READY_POLL_MS);
    }

    throw new Error(
      `Presentation ${presentationId} did not reach success within ${CMS_PRESENTATION_READY_TIMEOUT_MS}ms`,
    );
  }

  protected async log(
    logger: CmsChatAvatarLogger | undefined,
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    if (!logger) return;
    await logger(message, context);
  }

  private toResolvedAvatarImage(resource: CmsAvatarImageResource): CmsResolvedAvatarImage {
    const url = resolveAvatarImageUrl(resource);
    if (!resource.id || !url) {
      throw new Error(`Avatar image ${resource.id || '<unknown>'} is missing a usable image URL`);
    }

    return {
      id: String(resource.id),
      url,
    };
  }
}
