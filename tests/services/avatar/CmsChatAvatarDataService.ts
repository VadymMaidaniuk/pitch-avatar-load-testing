import { basename, extname } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { CMS_AVATAR_LANGUAGE_ID } from '../../helpers/chatConfig';
import { CmsApiClient } from '../api/CmsApiClient';
import {
  CmsChatAvatarBaseService,
  type CmsChatAvatarLogger,
  extractShortLink,
} from './CmsChatAvatarBaseService';

export type CmsPresentationFileInput = {
  filePath: string;
  sourceType?: string;
  title?: string;
};

export type CmsKnowledgeFileInput = {
  type: 'file';
  filePath: string;
  name?: string;
  parseImages?: boolean;
};

export type CmsKnowledgeLinkInput = {
  type: 'link';
  url: string;
  name?: string;
  parseImages?: boolean;
};

export type CmsKnowledgeTextInput = {
  type: 'text';
  name?: string;
  text: string;
};

export type CmsKnowledgeInput =
  | CmsKnowledgeFileInput
  | CmsKnowledgeLinkInput
  | CmsKnowledgeTextInput;

export type CreateCmsChatAvatarDataOptions = {
  avatarImageId?: string;
  chatName?: string;
  email?: string;
  knowledge?: CmsKnowledgeInput[];
  languageId?: string;
  logger?: CmsChatAvatarLogger;
  name?: string;
  password?: string;
  presentation: CmsPresentationFileInput;
  prompt?: string;
  roleName?: string;
  voiceId?: string;
};

export type CreatedCmsChatAvatarData = {
  assistantId: string;
  presentationId: string;
  screeningId: string;
  shortLink: string;
  sourcePresentationId: string;
  url: string;
};

const inferPresentationSourceType = (filePath: string): string => {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (extension === '.ppt') return 'ppt';
  if (extension === '.pptx') return 'pptx';
  throw new Error(`Unsupported presentation file type "${extension}" for ${filePath}`);
};

const trimName = (value: string, maxLength = 255): string => value.trim().slice(0, maxLength);

const defaultPresentationTitle = (filePath: string): string =>
  basename(filePath, extname(filePath)).slice(0, 255);

export class CmsChatAvatarDataService extends CmsChatAvatarBaseService {
  constructor(
    request: APIRequestContext,
    cmsClient?: CmsApiClient,
  ) {
    super(request, cmsClient);
  }

  async createAvatar(
    options: CreateCmsChatAvatarDataOptions,
  ): Promise<CreatedCmsChatAvatarData> {
    const logger = options.logger;
    const name = options.name?.trim() || `aqa-data-avatar-${Date.now()}`;
    const chatName = options.chatName?.trim() || name;
    const languageId = options.languageId?.trim() || CMS_AVATAR_LANGUAGE_ID;
    const knowledge = options.knowledge ?? [];

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
      options.prompt,
      logger,
    );

    const sourceType = options.presentation.sourceType?.trim() ||
      inferPresentationSourceType(options.presentation.filePath);
    const sourcePresentationTitle =
      trimName(options.presentation.title || defaultPresentationTitle(options.presentation.filePath));

    await this.log(logger, 'Creating source presentation', {
      sourcePresentationTitle,
      sourceType,
    });
    const sourcePresentation = await this.cmsClient.createImportedPresentation(
      accessToken,
      sourcePresentationTitle,
      sourceType,
    );

    await this.log(logger, 'Uploading source presentation file', {
      sourcePresentationId: sourcePresentation.id,
      filePath: options.presentation.filePath,
    });
    await this.cmsClient.uploadPresentationFile(
      accessToken,
      sourcePresentation.id,
      options.presentation.filePath,
    );
    await this.waitForPresentationReady(accessToken, sourcePresentation.id, 1, logger);
    const sourcePresentationDetails = await this.cmsClient.getPresentation(
      accessToken,
      sourcePresentation.id,
    );
    const sourceSlidesCount = Math.max(sourcePresentationDetails.slidesCount ?? 0, 1);

    const widgetTitle = `Widget_${name}`;
    await this.log(logger, 'Creating target widget presentation', {
      widgetTitle,
    });
    const targetPresentation = await this.cmsClient.createPresentation(accessToken, widgetTitle);
    await this.cmsClient.updatePresentationGoals(accessToken, targetPresentation.id);

    await this.log(logger, 'Copying source presentation into widget target', {
      sourcePresentationId: sourcePresentation.id,
      targetPresentationId: targetPresentation.id,
      sourceSlidesCount,
    });
    await this.cmsClient.copyPresentationToAssistant(
      accessToken,
      sourcePresentation.id,
      targetPresentation.id,
    );
    await this.waitForPresentationReady(
      accessToken,
      targetPresentation.id,
      sourceSlidesCount,
      logger,
    );
    await this.cmsClient.updatePresentationTitle(accessToken, targetPresentation.id, widgetTitle);

    if (knowledge.length) {
      await this.log(logger, 'Adding knowledge sources', {
        presentationId: targetPresentation.id,
        total: knowledge.length,
      });
    }
    for (const item of knowledge) {
      await this.addKnowledgeSource(accessToken, targetPresentation.id, item, logger);
    }

    await this.log(logger, 'Creating assistant', {
      languageId,
      presentationId: targetPresentation.id,
      roleId: role.id,
      roleName: role.name,
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
      presentationId: targetPresentation.id,
    });

    await this.log(logger, 'Generating assistant media', {
      assistantId: assistant.id,
      presentationId: targetPresentation.id,
    });
    await this.cmsClient.generateAssistantMedia(
      accessToken,
      targetPresentation.id,
      assistant.id,
      true,
    );
    await this.waitForAssistantSuccess(accessToken, assistant.id, logger);

    await this.log(logger, 'Creating public link', {
      assistantId: assistant.id,
      presentationId: targetPresentation.id,
      title: chatName,
    });
    const screening = await this.cmsClient.createScreening(
      accessToken,
      targetPresentation.id,
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
    await this.log(logger, 'Data-driven avatar ready', {
      assistantId: assistant.id,
      presentationId: targetPresentation.id,
      sourcePresentationId: sourcePresentation.id,
      screeningId: screening.id,
      shortLink,
      url: screening.url,
    });

    return {
      assistantId: assistant.id,
      presentationId: targetPresentation.id,
      screeningId: screening.id,
      shortLink,
      sourcePresentationId: sourcePresentation.id,
      url: screening.url,
    };
  }

  private async addKnowledgeSource(
    accessToken: string,
    presentationId: string,
    item: CmsKnowledgeInput,
    logger?: CmsChatAvatarLogger,
  ): Promise<void> {
    switch (item.type) {
      case 'file': {
        const name = trimName(item.name || basename(item.filePath));
        await this.log(logger, 'Adding file knowledge source', {
          presentationId,
          filePath: item.filePath,
          name,
        });
        const tmpFileUrl = await this.cmsClient.uploadTmpFile(accessToken, item.filePath);
        await this.cmsClient.createKnowledgeFile(
          accessToken,
          presentationId,
          name,
          tmpFileUrl,
          item.parseImages ?? true,
        );
        return;
      }
      case 'link': {
        const name = trimName(item.name || item.url);
        await this.log(logger, 'Adding link knowledge source', {
          presentationId,
          name,
          url: item.url,
        });
        await this.cmsClient.createKnowledgeLink(
          accessToken,
          presentationId,
          name,
          item.url,
          item.parseImages ?? true,
        );
        return;
      }
      case 'text': {
        const name = trimName(item.name || item.text);
        await this.log(logger, 'Adding text knowledge source', {
          presentationId,
          name,
        });
        await this.cmsClient.createKnowledgeText(
          accessToken,
          presentationId,
          name,
          item.text,
        );
        return;
      }
    }
  }
}
