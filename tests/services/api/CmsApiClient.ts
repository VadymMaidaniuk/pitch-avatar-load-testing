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
  voiceId: string;
  avatarImageId: string;
  avatarImageUrl: string;
  presentationId: string;
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
            is_video_avatar_enabled: false,
            is_voiceover_enabled: true,
            is_voice_recognition_enabled: false,
            avatar_settings: {
              video_type: 'talk',
              talk_image_url: input.avatarImageUrl,
              audio: {
                vendor: 'internal',
                speech_voice_id: input.voiceId,
              },
              lipsync: {
                avatar_image_id: input.avatarImageId,
              },
              is_streamable: true,
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

  private buildJsonApiHeaders(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/vnd.api+json',
    };
  }
}
