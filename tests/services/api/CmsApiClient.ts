import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import {
  CMS_API_BASE_URL,
  CMS_EMAIL,
  CMS_PASSWORD,
} from '../../helpers/chatConfig';
import { assertOk } from './apiClientUtils';

type JwtPayload = { sub?: string };

type JsonApiResource<TAttributes> = {
  type: string;
  id: string;
  attributes: TAttributes;
};

type JsonApiCollection<TResource> = {
  data?: TResource[];
};

type JsonApiDocument<TResource> = {
  data?: TResource;
  included?: Array<{ type?: string; id?: string }>;
};

type CmsAuthResponse = JsonApiDocument<
  JsonApiResource<{
    access_token?: string;
    token_type?: string;
    expires_in?: number;
  }>
>;

type CmsPresentationResponse = JsonApiDocument<
  JsonApiResource<{
    language_id?: string;
    parsing_status?: string;
    slides_count?: number;
    title?: string;
  }>
>;

type CmsAssistantResponse = JsonApiDocument<
  JsonApiResource<{
    name?: string;
    status?: string | null;
    prompt?: string | null;
    role_name?: string | null;
    is_voiceover_enabled?: boolean | null;
    is_video_avatar_enabled?: boolean | null;
    is_voice_recognition_enabled?: boolean | null;
  }>
>;

type CmsScreeningResponse = JsonApiDocument<
  JsonApiResource<{
    short_link?: string;
    url?: string;
  }>
>;

type CmsTmpUploadResponse = {
  data?: {
    attributes?: {
      url?: string;
    };
  };
};

type CmsNestedJsonApiResponse<TResource> = {
  data?: {
    data?: TResource;
  };
};

export type CmsLoginResult = {
  accessToken: string;
  userId: string;
};

export type CmsSpeechVoiceResource = JsonApiResource<{
  name?: string;
  language?: string;
  languages?: string[] | null;
}>;

export type CmsAvatarImageResource = JsonApiResource<{
  name?: string | null;
  extra_data?: {
    driver_id?: string | null;
    presenter_id?: string | null;
    generation_type?: string | null;
    is_streamable?: boolean | null;
  } | null;
  image_url?: string | null;
  plane_image_url?: string | null;
  is_streamable?: boolean | null;
  types?: string | null;
}>;

export type CreateCmsAssistantInput = {
  name: string;
  chatName: string;
  languageId: string;
  prompt: string;
  roleId?: string;
  voiceId: string;
  avatarImageId: string;
  avatarImageUrl: string;
  presentationId: string;
  videoAvatar?: {
    clipDriverId?: string | null;
    clipPresenterId?: string | null;
    enabled: boolean;
    isStreamable?: boolean | null;
  };
};

export type CreateCmsScreeningResult = {
  id: string;
  shortLink?: string;
  url: string;
  screeningSettingsId?: string;
};

export type CmsAssistantDetails = {
  id: string;
  isVideoAvatarEnabled?: boolean | null;
  isVoiceRecognitionEnabled?: boolean | null;
  isVoiceoverEnabled?: boolean | null;
  prompt?: string | null;
  roleName?: string | null;
  status?: string | null;
};

export type CmsPresentationDetails = {
  id: string;
  languageId?: string | null;
  parsingStatus?: string | null;
  slidesCount?: number | null;
  title?: string | null;
};

export type CmsAssistantRoleResource = JsonApiResource<{
  description?: string | null;
  name?: string | null;
  prompt?: string | null;
}>;

export type CmsKnowledgeContentResult = {
  id: string;
};

const MIME_TYPES: Record<string, string> = {
  '.bmp': 'image/bmp',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
};

const getMimeType = (filePath: string): string =>
  MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';

const decodeJwtPayload = (token: string): JwtPayload => {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('CMS auth token is not a valid JWT');
  }

  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padding =
    normalized.length % 4 === 2
      ? '=='
      : normalized.length % 4 === 3
        ? '='
        : '';

  try {
    return JSON.parse(Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8'));
  } catch {
    throw new Error('Failed to decode CMS auth token payload');
  }
};

export class CmsApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly baseUrl: string = CMS_API_BASE_URL,
  ) {}

  async login(email: string = CMS_EMAIL ?? '', password: string = CMS_PASSWORD ?? ''): Promise<CmsLoginResult> {
    if (!email || !password) {
      throw new Error(
        'CMS credentials are required. Set CMS_EMAIL and CMS_PASSWORD or pass them explicitly.',
      );
    }

    const response = await this.request.post(`${this.baseUrl}/auth/login`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: { email, password },
    });

    await assertOk(response, 'POST /auth/login');
    const payload = (await response.json()) as CmsAuthResponse;
    const accessToken = payload?.data?.attributes?.access_token;
    if (!accessToken) {
      throw new Error('CMS login response missing access token');
    }

    const userId = decodeJwtPayload(accessToken).sub;
    if (!userId) {
      throw new Error('CMS auth token payload missing user id');
    }

    return {
      accessToken,
      userId: String(userId),
    };
  }

  async listSpeechVoices(
    accessToken: string,
    languageId: string,
    pageSize = 20,
  ): Promise<CmsSpeechVoiceResource[]> {
    const response = await this.request.get(
      `${this.baseUrl}/speech-voices?page[number]=1&page[size]=${pageSize}&filter[language]=${encodeURIComponent(languageId)}&include=files`,
      {
        headers: this.buildJsonApiHeaders(accessToken),
      },
    );

    await assertOk(response, 'GET /speech-voices');
    const payload = (await response.json()) as JsonApiCollection<CmsSpeechVoiceResource>;
    return payload?.data ?? [];
  }

  async listAvatarImages(accessToken: string, pageSize = 20): Promise<CmsAvatarImageResource[]> {
    const response = await this.request.get(
      `${this.baseUrl}/avatar-images?page[number]=1&page[size]=${pageSize}&filter[isAvatarable]=1&filter[isStreamable]=1`,
      {
        headers: this.buildJsonApiHeaders(accessToken),
      },
    );

    await assertOk(response, 'GET /avatar-images');
    const payload = (await response.json()) as JsonApiCollection<CmsAvatarImageResource>;
    return payload?.data ?? [];
  }

  async getAvatarImage(accessToken: string, avatarImageId: string): Promise<CmsAvatarImageResource> {
    const response = await this.request.get(`${this.baseUrl}/avatar-images/${avatarImageId}`, {
      headers: this.buildJsonApiHeaders(accessToken),
    });

    await assertOk(response, `GET /avatar-images/${avatarImageId}`);
    const payload = (await response.json()) as JsonApiDocument<CmsAvatarImageResource>;
    if (!payload?.data?.id) {
      throw new Error(`Avatar image ${avatarImageId} was not found`);
    }

    return payload.data;
  }

  async createPresentation(accessToken: string, title: string): Promise<{ id: string }> {
    const response = await this.request.post(`${this.baseUrl}/presentations`, {
      headers: this.buildJsonApiHeaders(accessToken),
      data: {
        data: {
          type: 'presentations',
          attributes: {
            title,
            has_assistant: false,
            is_widget_data: true,
          },
        },
      },
    });

    await assertOk(response, 'POST /presentations');
    const payload = (await response.json()) as CmsPresentationResponse;
    const presentationId = payload?.data?.id;
    if (!presentationId) {
      throw new Error('Presentation create response missing id');
    }

    return { id: String(presentationId) };
  }

  async createImportedPresentation(
    accessToken: string,
    title: string,
    presentationSourceType: string,
  ): Promise<{ id: string }> {
    const response = await this.request.post(`${this.baseUrl}/presentations`, {
      headers: this.buildJsonApiHeaders(accessToken),
      data: {
        data: {
          type: 'presentations',
          attributes: {
            title,
            import_settings: {
              goals: [],
              text_script: {},
              products_type_autodetect: false,
              slides_type_autodetect: false,
            },
            parsing_status: 'success',
            presentation_source_type: presentationSourceType,
          },
        },
      },
    });

    await assertOk(response, 'POST /presentations (imported source)');
    const payload = (await response.json()) as CmsPresentationResponse;
    const presentationId = payload?.data?.id;
    if (!presentationId) {
      throw new Error('Imported presentation create response missing id');
    }

    return { id: String(presentationId) };
  }

  async uploadPresentationFile(
    accessToken: string,
    presentationId: string,
    filePath: string,
  ): Promise<{ id: string; url: string }> {
    const response = await this.request.post(`${this.baseUrl}/files`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      multipart: {
        fileable_type: 'presentations',
        fileable_id: presentationId,
        fileable_attribute: 'presentation_file',
        file: {
          name: basename(filePath),
          mimeType: getMimeType(filePath),
          buffer: await readFile(filePath),
        },
      },
    });

    await assertOk(response, `POST /files (presentation ${presentationId})`);
    const payload = (await response.json()) as JsonApiDocument<
      JsonApiResource<{
        url?: string;
      }>
    >;
    const fileId = payload?.data?.id;
    const url = payload?.data?.attributes?.url;
    if (!fileId || !url) {
      throw new Error(`Presentation file upload for ${presentationId} missing id or url`);
    }

    return {
      id: String(fileId),
      url,
    };
  }

  async getPresentation(
    accessToken: string,
    presentationId: string,
  ): Promise<CmsPresentationDetails> {
    const response = await this.request.get(`${this.baseUrl}/presentations/${presentationId}`, {
      headers: this.buildJsonApiHeaders(accessToken),
    });

    await assertOk(response, `GET /presentations/${presentationId}`);
    const payload = (await response.json()) as CmsPresentationResponse;
    const presentation = payload?.data;
    if (!presentation?.id) {
      throw new Error(`Presentation ${presentationId} was not found`);
    }

    return {
      id: String(presentation.id),
      languageId: presentation.attributes?.language_id ?? null,
      parsingStatus: presentation.attributes?.parsing_status ?? null,
      slidesCount: presentation.attributes?.slides_count ?? null,
      title: presentation.attributes?.title ?? null,
    };
  }

  async copyPresentationToAssistant(
    accessToken: string,
    selectedPresentationId: string,
    targetPresentationId: string,
  ): Promise<void> {
    const response = await this.request.post(
      `${this.baseUrl}/presentations/${selectedPresentationId}/copy-to-assistant/${targetPresentationId}`,
      {
        headers: this.buildJsonApiHeaders(accessToken),
        data: {},
      },
    );

    await assertOk(
      response,
      `POST /presentations/${selectedPresentationId}/copy-to-assistant/${targetPresentationId}`,
    );
  }

  async updatePresentationTitle(
    accessToken: string,
    presentationId: string,
    title: string,
  ): Promise<void> {
    const response = await this.request.patch(`${this.baseUrl}/presentations/${presentationId}`, {
      headers: this.buildJsonApiHeaders(accessToken),
      data: {
        data: {
          id: presentationId,
          type: 'presentations',
          attributes: {
            title,
          },
        },
      },
    });

    await assertOk(response, `PATCH /presentations/${presentationId} (title)`);
  }

  async updatePresentationGoals(
    accessToken: string,
    presentationId: string,
    goalIds: string[] = [],
  ): Promise<void> {
    const response = await this.request.patch(`${this.baseUrl}/presentations/${presentationId}`, {
      headers: this.buildJsonApiHeaders(accessToken),
      data: {
        data: {
          type: 'presentations',
          id: presentationId,
          relationships: {
            goals: {
              data: goalIds.map((goalId) => ({
                type: 'goals',
                id: goalId,
              })),
            },
          },
        },
        substitution_data: [],
      },
    });

    await assertOk(response, `PATCH /presentations/${presentationId}`);
  }

  async createAssistant(
    accessToken: string,
    input: CreateCmsAssistantInput,
  ): Promise<{ id: string }> {
    const isVideoAvatarEnabled = Boolean(input.videoAvatar?.enabled);
    const isClipAvatar = isVideoAvatarEnabled && Boolean(
      input.videoAvatar?.clipDriverId || input.videoAvatar?.clipPresenterId,
    );

    const response = await this.request.post(`${this.baseUrl}/assistants`, {
      headers: this.buildJsonApiHeaders(accessToken),
      data: {
        data: {
          type: 'assistants',
          attributes: {
            name: input.name,
            chat_name: input.chatName,
            language_id: input.languageId,
            is_active: true,
            instructions: '',
            is_video_avatar_enabled: isVideoAvatarEnabled,
            is_voiceover_enabled: true,
            is_voice_recognition_enabled: false,
            avatar_settings: {
              video_type: isClipAvatar ? 'clip' : 'talk',
              ...(isClipAvatar
                ? {
                    clip_driver_id: input.videoAvatar?.clipDriverId ?? null,
                    clip_presenter_id: input.videoAvatar?.clipPresenterId ?? null,
                  }
                : {
                    talk_image_url: input.avatarImageUrl,
                  }),
              audio: {
                vendor: 'internal',
                speech_voice_id: input.voiceId,
              },
              lipsync: {
                avatar_image_id: input.avatarImageId,
              },
              is_streamable: input.videoAvatar?.isStreamable ?? true,
            },
            pst_content: [],
            prompt: input.prompt,
            is_draft: false,
            pretranslate_enabled: false,
            has_pretranslate_dialog: false,
          },
          relationships: {
            presentation: {
              data: {
                type: 'presentations',
                id: input.presentationId,
              },
            },
            ...(input.roleId
              ? {
                  'assistant-role': {
                    data: {
                      type: 'assistant-roles',
                      id: input.roleId,
                    },
                  },
                }
              : {}),
          },
        },
      },
    });

    await assertOk(response, 'POST /assistants');
    const payload = (await response.json()) as CmsAssistantResponse;
    const assistantId = payload?.data?.id;
    if (!assistantId) {
      throw new Error('Assistant create response missing id');
    }

    return { id: String(assistantId) };
  }

  async getAssistant(accessToken: string, assistantId: string): Promise<CmsAssistantDetails> {
    const response = await this.request.get(
      `${this.baseUrl}/assistants/${assistantId}?include=assistant-role,assistant-role.goals,presentation,presentation`,
      {
        headers: this.buildJsonApiHeaders(accessToken),
      },
    );

    await assertOk(response, `GET /assistants/${assistantId}`);
    const payload = (await response.json()) as CmsAssistantResponse;
    const assistant = payload?.data;
    if (!assistant?.id) {
      throw new Error(`Assistant ${assistantId} was not found`);
    }

    return {
      id: String(assistant.id),
      isVideoAvatarEnabled: assistant.attributes?.is_video_avatar_enabled,
      isVoiceRecognitionEnabled: assistant.attributes?.is_voice_recognition_enabled,
      isVoiceoverEnabled: assistant.attributes?.is_voiceover_enabled,
      prompt: assistant.attributes?.prompt,
      roleName: assistant.attributes?.role_name,
      status: assistant.attributes?.status,
    };
  }

  async listAssistantRoles(
    accessToken: string,
    pageSize = 100,
  ): Promise<CmsAssistantRoleResource[]> {
    const response = await this.request.get(
      `${this.baseUrl}/assistant-roles?include=goals&page[number]=1&page[size]=${pageSize}`,
      {
        headers: this.buildJsonApiHeaders(accessToken),
      },
    );

    await assertOk(response, 'GET /assistant-roles?include=goals');
    const payload = (await response.json()) as JsonApiCollection<CmsAssistantRoleResource>;
    return payload?.data ?? [];
  }

  async uploadTmpFile(accessToken: string, filePath: string): Promise<string> {
    const response = await this.request.post(`${this.baseUrl}/d-id/upload-tmp-file`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      multipart: {
        file: {
          name: basename(filePath),
          mimeType: getMimeType(filePath),
          buffer: await readFile(filePath),
        },
      },
    });

    await assertOk(response, `POST /d-id/upload-tmp-file (${basename(filePath)})`);
    const payload = (await response.json()) as CmsTmpUploadResponse;
    const url = payload?.data?.attributes?.url;
    if (!url) {
      throw new Error(`Temporary upload response missing url for ${filePath}`);
    }

    return url;
  }

  async createKnowledgeText(
    accessToken: string,
    presentationId: string,
    name: string,
    text: string,
  ): Promise<CmsKnowledgeContentResult> {
    const response = await this.request.post(`${this.baseUrl}/pst-content`, {
      headers: this.buildJsonApiHeaders(accessToken),
      data: {
        data: {
          type: 'pst-content',
          attributes: {
            text,
            name,
            resource_type: 'text',
            scope: 'presentation',
            presentation_id: presentationId,
          },
        },
      },
    });

    await assertOk(response, 'POST /pst-content (text)');
    return this.parseKnowledgeContentResult(await response.json());
  }

  async createKnowledgeLink(
    accessToken: string,
    presentationId: string,
    name: string,
    url: string,
    parseImages = true,
  ): Promise<CmsKnowledgeContentResult> {
    const response = await this.request.post(`${this.baseUrl}/pst-content`, {
      headers: this.buildJsonApiHeaders(accessToken),
      data: {
        data: {
          type: 'pst-content',
          attributes: {
            name,
            text: url,
            resource_type: 'url',
            parse_images: parseImages,
            scope: 'presentation',
            presentation_id: presentationId,
          },
        },
      },
    });

    await assertOk(response, 'POST /pst-content (link)');
    return this.parseKnowledgeContentResult(await response.json());
  }

  async createKnowledgeFile(
    accessToken: string,
    presentationId: string,
    name: string,
    tmpFileUrl: string,
    parseImages = true,
  ): Promise<CmsKnowledgeContentResult> {
    const response = await this.request.post(`${this.baseUrl}/pst-content`, {
      headers: this.buildJsonApiHeaders(accessToken),
      data: {
        data: {
          type: 'pst-content',
          attributes: {
            url: tmpFileUrl,
            name,
            resource_type: 'file',
            parse_images: parseImages,
            scope: 'presentation',
            presentation_id: presentationId,
          },
        },
      },
    });

    await assertOk(response, 'POST /pst-content (file)');
    return this.parseKnowledgeContentResult(await response.json());
  }

  async createScreening(
    accessToken: string,
    presentationId: string,
    adminUserId: string,
    title: string,
  ): Promise<CreateCmsScreeningResult> {
    const response = await this.request.post(`${this.baseUrl}/screenings?include=setting&`, {
      headers: this.buildJsonApiHeaders(accessToken),
      data: {
        data: {
          type: 'screenings',
          attributes: {
            title,
            mode: 'offline',
            available: true,
            admins: [adminUserId],
            start_slide_position: 1,
            generate_short_link: true,
            has_intro: false,
            has_attachment: false,
          },
          relationships: {
            presentation: {
              data: {
                type: 'presentations',
                id: presentationId,
              },
            },
          },
        },
        params: {},
      },
    });

    await assertOk(response, 'POST /screenings?include=setting (public link)');
    const payload = (await response.json()) as CmsScreeningResponse;
    const screeningId = payload?.data?.id;
    const url = payload?.data?.attributes?.url;
    if (!screeningId || !url) {
      throw new Error('Screening create response missing id or url');
    }

    const screeningSettingsId = payload?.included?.find(
      (item) => item.type === 'screening-settings',
    )?.id;

    return {
      id: String(screeningId),
      shortLink: payload?.data?.attributes?.short_link,
      url,
      screeningSettingsId,
    };
  }

  async updateScreeningSettings(
    accessToken: string,
    screeningSettingsId: string,
  ): Promise<void> {
    const response = await this.request.patch(
      `${this.baseUrl}/screening-settings/${screeningSettingsId}?`,
      {
        headers: this.buildJsonApiHeaders(accessToken),
        data: {
          data: {
            type: 'screening-settings',
            id: screeningSettingsId,
            attributes: {
              ask_password: false,
              screening_user_attributes: [],
              screening_user_attributes_required: [],
              screening_user_data: {
                name: '',
                last_name: '',
                email: '',
                company_name: '',
                country: '',
                industry: '',
                summary: '',
              },
              screening_user_photo_data: {
                url: '',
                id: '',
                is_chromakey: false,
                shape: null,
              },
              allow_slide_share: true,
              allow_ask_questions: true,
              allow_comments: true,
              speed: 'fast',
              allow_change_speed: false,
              use_default_audio: true,
              ask_form_after_slide: 1,
              ask_form_text: '',
              individual: false,
              allow_call_presenter: true,
              allow_schedule_meeting: '',
              subtitles_enabled: false,
              is_voice_recognition: true,
              disable_push: false,
              calendly_link_url: '',
              is_slide_feed_visible: false,
              start_slide_position: 1,
              is_attach_pdf: false,
              is_send_report: true,
              is_generate_welcome_slide: false,
              has_attachment: false,
              has_debugger: false,
              iframe_settings: {
                is_show_skeleton_preview_gif: false,
                is_show_skeleton_assistant_content: false,
                is_promo_video_not_shown: false,
                is_not_padding: false,
              },
              available_languages: [],
            },
          },
          params: {},
        },
      },
    );

    await assertOk(response, `PATCH /screening-settings/${screeningSettingsId}`);
  }

  async generateAssistantMedia(
    accessToken: string,
    presentationId: string,
    assistantId: string,
    isTest = true,
  ): Promise<void> {
    const response = await this.request.post(
      `${this.baseUrl}/presentations/${presentationId}/generate-assistant-media`,
      {
        headers: this.buildJsonApiHeaders(accessToken),
        data: {
          data: {
            attributes: {
              assistant_id: assistantId,
              is_test: isTest,
            },
          },
        },
      },
    );

    await assertOk(response, `POST /presentations/${presentationId}/generate-assistant-media`);
  }

  private parseKnowledgeContentResult(payload: unknown): CmsKnowledgeContentResult {
    const nestedDocument = payload as CmsNestedJsonApiResponse<
      JsonApiResource<Record<string, unknown>>
    >;
    const document = payload as JsonApiDocument<JsonApiResource<Record<string, unknown>>>;
    const contentId = nestedDocument?.data?.data?.id ?? document?.data?.id;
    if (!contentId) {
      throw new Error('Knowledge content response missing id');
    }

    return {
      id: String(contentId),
    };
  }

  private buildJsonApiHeaders(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/vnd.api+json',
    };
  }
}
