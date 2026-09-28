import type { APIRequestContext, APIResponse } from '@playwright/test';
import { API_BASE_URL, SCR_SHORT_LINK } from '../../helpers/chatConfig';
import { assertOk } from './apiClientUtils';

export type ScreeningAssistantMetadata = {
  screeningAssistantId: string;
  assistantId: string | null;
  name: string | null;
  roleName: string | null;
  languageId: string | null;
  cacheEnabled: boolean | null;
};

/** Allowlist public avatar metadata; never retain auth or media-provider credentials. */
export function readScreeningAssistantMetadata(payload: unknown): ScreeningAssistantMetadata | null {
  const resources = new Map<string, Record<string, unknown>>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const item = node as Record<string, unknown>;
    if (item.type === 'screening-assistants' && item.id != null && item.attributes && typeof item.attributes === 'object') {
      resources.set(String(item.id), item.attributes as Record<string, unknown>);
    }
    for (const value of Object.values(item)) if (value && typeof value === 'object') walk(value);
  };
  walk(payload);
  if (resources.size !== 1) return null;
  const [id, attributes] = [...resources][0];
  const string = (key: string) => typeof attributes[key] === 'string' || typeof attributes[key] === 'number' ? String(attributes[key]) : null;
  return {
    screeningAssistantId: id, assistantId: string('assistant_id'), name: string('name'),
    roleName: string('role_name'), languageId: string('language_id'),
    cacheEnabled: typeof attributes.is_cache_enabled === 'boolean' ? attributes.is_cache_enabled : null,
  };
}

export type LoginResult = {
  token: string;
  scrUserID: string;
  screeningStepID?: string;
  languageID: string;
  avatar: ScreeningAssistantMetadata | null;
};

const LOGIN_INCLUDE = [
  'screening-steps.stepable',
  'screening-steps.files',
  'files',
  'user',
  'user.files',
  'user-company.files',
  'screening-steps.controls',
  'screening-assistant',
  'screening-assistant.files',
  'introduction-slide',
  'screening-admins.files',
].join(',');

export class ScrApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly baseUrl: string = API_BASE_URL,
    private readonly shortLink: string = SCR_SHORT_LINK,
  ) {}

  async login(): Promise<LoginResult> {
    const url = `${this.baseUrl}/api/scr/${this.shortLink}/login?include=${encodeURIComponent(LOGIN_INCLUDE)}`;
    const response = await this.request.post(url, {
      headers: {
        Authorization: 'Bearer',
        'Content-Type': 'application/vnd.api+json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      data: { is_iframe: false, original_source: '' },
    });

    await assertOk(response, 'POST /login');
    const payload = await response.json();
    const token = payload?.data?.attributes?.token;
    const scrUserID = payload?.data?.attributes?.user?.data?.id;
    const screening = payload?.data?.attributes?.screening?.data;
    const screeningSteps = screening?.relationships?.['screening-steps']?.data;
    const screeningStepID = Array.isArray(screeningSteps) ? screeningSteps[0]?.id : undefined;
    const languageID = screening?.attributes?.language_id || 'en';
    if (!token || !scrUserID) {
      throw new Error('Login response missing token or scrUserID');
    }
    return {
      token,
      scrUserID: String(scrUserID),
      screeningStepID: screeningStepID ? String(screeningStepID) : undefined,
      languageID: String(languageID),
      avatar: readScreeningAssistantMetadata(payload),
    };
  }

  async initializeScreeningParameters(token: string, languageID: string): Promise<void> {
    const parametersResponse = await this.request.get(
      `${this.baseUrl}/api/scr/${this.shortLink}/parameters`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/vnd.api+json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
    );
    await assertOk(parametersResponse, 'GET /parameters');

    await this.setScreeningParameter(token, 'Voice Recognition Status', '0', 'bool');
    await this.setScreeningParameter(token, 'Presentation Language', languageID, 'string');
    await this.setScreeningParameter(token, 'Listener Language', languageID, 'string');
  }

  async setScreeningParameter(
    token: string,
    name: string,
    value: string,
    parameterType: string,
  ): Promise<APIResponse> {
    const url = `${this.baseUrl}/api/scr/${this.shortLink}/parameters/screening-parameters/${encodeURIComponent(name)}`;
    const response = await this.request.post(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/vnd.api+json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      data: {
        value,
        is_text_input: false,
        parameter_type: parameterType,
      },
    });
    await assertOk(response, `POST /parameters/screening-parameters/${name}`);
    return response;
  }

  async reportAction(
    token: string,
    action: string,
    data: Record<string, unknown> = {},
  ): Promise<APIResponse> {
    const url = `${this.baseUrl}/api/scr/${this.shortLink}/report-actions`;
    const response = await this.request.post(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/vnd.api+json',
      },
      data: {
        data: {
          type: 'report-actions',
          attributes: { action, data },
        },
      },
    });
    await assertOk(response, `POST /report-actions (${action})`);
    return response;
  }
}
