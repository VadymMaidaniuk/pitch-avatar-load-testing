import type { APIRequestContext, APIResponse } from '@playwright/test';
import { API_BASE_URL, SCR_SHORT_LINK } from '../../helpers/chatConfig';
import { assertOk } from './apiClientUtils';

export type LoginResult = {
  token: string;
  scrUserID: string;
  screeningStepID?: string;
  languageID: string;
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
