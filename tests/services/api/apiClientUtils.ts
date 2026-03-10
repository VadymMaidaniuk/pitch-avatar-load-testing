import type { APIResponse } from '@playwright/test';

export const readErrorSnippet = async (response: APIResponse): Promise<string> => {
  try {
    const text = await response.text();
    if (!text) return '';
    return text.slice(0, 500);
  } catch {
    return '';
  }
};

export const assertOk = async (response: APIResponse, context: string) => {
  if (response.ok()) return;
  const snippet = await readErrorSnippet(response);
  const details = snippet ? ` - ${snippet}` : '';
  throw new Error(`${context} failed: ${response.status()} ${response.statusText()}${details}`);
};
