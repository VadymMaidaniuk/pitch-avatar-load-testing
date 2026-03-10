import type { APIRequestContext } from '@playwright/test';
import {
  CMS_AVATAR_LANGUAGE_ID,
  CMS_AVATAR_PROMPT,
} from '../../helpers/chatConfig';
import { CmsApiClient } from '../api/CmsApiClient';
import {
  CmsChatAvatarBaseService,
  type CmsChatAvatarLogger,
  extractShortLink,
} from './CmsChatAvatarBaseService';

export type CreateCmsChatAvatarMvpOptions = {
  avatarImageId?: string;
  chatName?: string;
  email?: string;
  languageId?: string;
  logger?: CmsChatAvatarLogger;
  name?: string;
  password?: string;
  prompt?: string;
  roleName?: string;
  voiceId?: string;
};

export type CreatedCmsChatAvatarMvp = {
  assistantId: string;
  screeningId: string;
  shortLink: string;
  url: string;
};

export class CmsChatAvatarMvpService extends CmsChatAvatarBaseService {
  constructor(
    request: APIRequestContext,
    cmsClient?: CmsApiClient,
  ) {
    super(request, cmsClient);
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
      options.voiceId?.trim(),
      logger,
    );
    const avatarImage = await this.resolveAvatarImage(
      accessToken,
      options.avatarImageId?.trim(),
      logger,
    );
    const role = await this.resolveRole(
      accessToken,
      options.roleName,
      prompt,
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
      prompt: role.prompt,
      voiceId,
      avatarImageId: avatarImage.id,
    });
    const assistant = await this.cmsClient.createAssistant(accessToken, {
      name,
      chatName,
      languageId,
      prompt: role.prompt,
      roleId: role.id,
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
}
