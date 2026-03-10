import type { APIRequestContext } from '@playwright/test';
import {
  CMS_AVATAR_IMAGE_ID,
  CMS_AVATAR_LANGUAGE_ID,
  CMS_AVATAR_PROMPT,
  CMS_AVATAR_READY_POLL_MS,
  CMS_AVATAR_READY_TIMEOUT_MS,
  CMS_AVATAR_VOICE_ID,
} from '../../helpers/chatConfig';
import {
  CmsApiClient,
  type CmsAvatarImageResource,
} from '../api/CmsApiClient';

export type CmsChatAvatarMvpLogger = (
  message: string,
  context?: Record<string, unknown>,
) => void | Promise<void>;

export type CreateCmsChatAvatarMvpOptions = {
  avatarImageId?: string;
  chatName?: string;
  email?: string;
  languageId?: string;
  logger?: CmsChatAvatarMvpLogger;
  name?: string;
  password?: string;
  prompt?: string;
  voiceId?: string;
};

export type CreatedCmsChatAvatarMvp = {
  assistantId: string;
  screeningId: string;
  shortLink: string;
  url: string;
};

type ResolvedAvatarImage = {
  id: string;
  url: string;
};

const extractShortLink = (url: string): string => {
  const pathname = new URL(url).pathname;
  const shortLink = pathname.split('/').filter(Boolean).pop();
  if (!shortLink) {
    throw new Error(`Unable to extract short link from URL: ${url}`);
  }
  return shortLink;
};

const resolveAvatarImageUrl = (resource: CmsAvatarImageResource): string | undefined =>
  resource.attributes?.plane_image_url ?? resource.attributes?.image_url ?? undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export class CmsChatAvatarMvpService {
  private readonly cmsClient: CmsApiClient;

  constructor(
    private readonly request: APIRequestContext,
    cmsClient?: CmsApiClient,
  ) {
    this.cmsClient = cmsClient ?? new CmsApiClient(request);
  }

  async createWidgetAvatar(
    options: CreateCmsChatAvatarMvpOptions = {},
  ): Promise<CreatedCmsChatAvatarMvp> {
    const logger = options.logger;
    const name = options.name?.trim() || `aqa-widget-avatar-${Date.now()}`;
    const chatName = options.chatName?.trim() || name;
    const languageId = options.languageId?.trim() || CMS_AVATAR_LANGUAGE_ID;
    const prompt = options.prompt?.trim() || CMS_AVATAR_PROMPT;

    await this.log(logger, 'CMS login started');
    const { accessToken, userId } = await this.cmsClient.login(options.email, options.password);
    await this.log(logger, 'CMS login completed', { userId });

    const voiceId = await this.resolveVoiceId(
      accessToken,
      languageId,
      options.voiceId?.trim() || CMS_AVATAR_VOICE_ID,
      logger,
    );
    const avatarImage = await this.resolveAvatarImage(
      accessToken,
      options.avatarImageId?.trim() || CMS_AVATAR_IMAGE_ID,
      logger,
    );

    const presentationTitle = `Widget_${name}`;
    // Screening links are presentation-bound, so MVP uses an empty widget presentation.
    await this.log(logger, 'Creating minimal widget presentation', {
      presentationTitle,
    });
    const presentation = await this.cmsClient.createPresentation(accessToken, presentationTitle);
    await this.log(logger, 'Attaching empty presentation goals', {
      presentationId: presentation.id,
    });
    await this.cmsClient.updatePresentationGoals(accessToken, presentation.id);

    await this.log(logger, 'Creating assistant', {
      languageId,
      presentationId: presentation.id,
      prompt,
      voiceId,
      avatarImageId: avatarImage.id,
    });
    const assistant = await this.cmsClient.createAssistant(accessToken, {
      name,
      chatName,
      languageId,
      prompt,
      voiceId,
      avatarImageId: avatarImage.id,
      avatarImageUrl: avatarImage.url,
      presentationId: presentation.id,
    });

    await this.log(logger, 'Generating assistant media', {
      assistantId: assistant.id,
      presentationId: presentation.id,
    });
    await this.cmsClient.generateAssistantMedia(
      accessToken,
      presentation.id,
      assistant.id,
      true,
    );
    await this.waitForAssistantSuccess(accessToken, assistant.id, logger);

    await this.log(logger, 'Creating public link', {
      assistantId: assistant.id,
      presentationId: presentation.id,
      title: chatName,
    });
    const screening = await this.cmsClient.createScreening(
      accessToken,
      presentation.id,
      userId,
      chatName,
    );
    if (!screening.screeningSettingsId) {
      throw new Error('Public link create response missing screening settings id');
    }

    await this.log(logger, 'Applying public link settings', {
      screeningId: screening.id,
      screeningSettingsId: screening.screeningSettingsId,
    });
    await this.cmsClient.updateScreeningSettings(accessToken, screening.screeningSettingsId);

    const shortLink = screening.shortLink || extractShortLink(screening.url);

    await this.log(logger, 'Widget avatar ready', {
      assistantId: assistant.id,
      screeningId: screening.id,
      shortLink,
      url: screening.url,
    });

    return {
      assistantId: assistant.id,
      screeningId: screening.id,
      shortLink,
      url: screening.url,
    };
  }

  private async waitForAssistantSuccess(
    accessToken: string,
    assistantId: string,
    logger?: CmsChatAvatarMvpLogger,
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

  private async resolveVoiceId(
    accessToken: string,
    languageId: string,
    preferredVoiceId: string | undefined,
    logger?: CmsChatAvatarMvpLogger,
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

  private async resolveAvatarImage(
    accessToken: string,
    preferredAvatarImageId: string | undefined,
    logger?: CmsChatAvatarMvpLogger,
  ): Promise<ResolvedAvatarImage> {
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
      throw new Error('No compatible avatar image found for minimal chat avatar flow');
    }

    const resolved = this.toResolvedAvatarImage(preferred);
    await this.log(logger, 'Avatar image resolved', {
      avatarImageId: resolved.id,
      avatarImageUrl: resolved.url,
    });
    return resolved;
  }

  private toResolvedAvatarImage(resource: CmsAvatarImageResource): ResolvedAvatarImage {
    const url = resolveAvatarImageUrl(resource);
    if (!resource.id || !url) {
      throw new Error(`Avatar image ${resource.id || '<unknown>'} is missing a usable image URL`);
    }

    return {
      id: String(resource.id),
      url,
    };
  }

  private async log(
    logger: CmsChatAvatarMvpLogger | undefined,
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    if (!logger) return;
    await logger(message, context);
  }
}
