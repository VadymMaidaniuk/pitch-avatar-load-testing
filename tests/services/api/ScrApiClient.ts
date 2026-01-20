import type { APIRequestContext, APIResponse } from '@playwright/test';
import { API_BASE_URL, SCR_SHORT_LINK } from '../../helpers/chatConfig';

export type LoginResult = { token: string; scrUserID: string };

const readErrorSnippet = async (response: APIResponse): Promise<string> => {
  try {
    const text = await response.text();
    if (!text) return '';
    return text.slice(0, 500);
  } catch {
    return '';
  }
};

const assertOk = async (response: APIResponse, context: string) => {
  if (response.ok()) return;
  const snippet = await readErrorSnippet(response);
  const details = snippet ? ` - ${snippet}` : '';
  throw new Error(`${context} failed: ${response.status()} ${response.statusText()}${details}`);
};

export class ScrApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly baseUrl: string = API_BASE_URL,
    private readonly shortLink: string = SCR_SHORT_LINK,
  ) {}

  async login(): Promise<LoginResult> {
    const url = `${this.baseUrl}/api/scr/${this.shortLink}/login?include=steps,files,assistant`;
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
    if (!token || !scrUserID) {
      throw new Error('Login response missing token or scrUserID');
    }
    return { token, scrUserID: String(scrUserID) };
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
