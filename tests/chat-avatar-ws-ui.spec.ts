import { test, expect, Page, BrowserContext } from '@playwright/test';
import { CHAT_URL, UI_ASSIST_TIMEOUT_MS } from './chatConfig';

const SELECTORS = {
  startButton: 'button[title="Tap to start"], button:has(svg[data-icon="play"])',
  messageInput: 'textarea[placeholder="Send a message"]',
  sendButton: 'form button.sc-izQBue',
  messageList: 'ul.sc-fKWMtX',
};

function randomTopic(userId: number): string {
  const words = [
    'analytics',
    'automation',
    'security',
    'compliance',
    'scalability',
    'resilience',
    'performance',
    'observability',
    'integration',
    'governance',
  ];
  const word = words[Math.floor(Math.random() * words.length)];
  const slug = Math.random().toString(36).slice(2, 6);
  return `${word}-${userId}-${slug}`;
}

async function startChatAndSend(page: Page, userId: number) {
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });

  const tapToStart = page.locator('button[title="Tap to start"]').first();
  if (await tapToStart.isVisible().catch(() => false)) {
    await tapToStart.click();
  } else {
    const genericPlay = page.locator(SELECTORS.startButton).first();
    if (await genericPlay.isVisible().catch(() => false)) {
      await genericPlay.click();
    }
  }

  const input = page.locator(SELECTORS.messageInput);
  await expect(input).toBeVisible({ timeout: 60_000 });
  await expect(input).toBeEnabled({ timeout: 60_000 });

  const sendButton = page.locator(SELECTORS.sendButton);
  const messageList = page.locator(SELECTORS.messageList);
  await messageList.waitFor({ state: 'visible', timeout: 30_000 });

  const topic = randomTopic(userId);
  const question = `Tell me about ${topic}`;
  await input.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });

  const userBubble = page.locator(`ul.sc-fKWMtX li[type="sent"]:has-text("${question}")`).first();

  await sendButton.click();
  await expect(userBubble).toBeVisible({ timeout: 20_000 });

  return { question };
}

test('UI send yields assistant reply on haproxy WS (no bubble wait)', async ({ page, context }) => {
  test.setTimeout(Math.max(UI_ASSIST_TIMEOUT_MS + 60_000, 120_000));

  // Instrument WS before navigation so we capture frames from the in-page socket.
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    (window as any).__wsFrames = [];
    (window as any).__wsUrls = [];
    const decoder = new TextDecoder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    class InstrumentedWS extends Original {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols as any);
        try {
          (window as any).__wsUrls.push(url);
        } catch {
          // ignore
        }
        this.addEventListener('message', async (event) => {
          try {
            const data = event.data;
            let text = '';
            if (typeof data === 'string') {
              text = data;
            } else if (data instanceof ArrayBuffer) {
              text = decoder.decode(data);
            } else if (data && typeof (data as any).text === 'function') {
              text = await (data as any).text();
            }
            (window as any).__wsFrames.push({ url, data: text });
          } catch {
            // ignore
          }
        });
      }
    }
    // @ts-ignore
    window.WebSocket = InstrumentedWS;
  });

  const { question } = await startChatAndSend(page, 1);

  const frameHandle = await page.waitForFunction(
    () => {
      const frames: { url: string; data: string }[] = (window as any).__wsFrames || [];
      for (const f of frames) {
        try {
          const parsed = JSON.parse(f.data);
          if (parsed?.event_type === 'assistant_chat_message' || parsed?.message) {
            return { frame: parsed, url: f.url };
          }
        } catch {
          continue;
        }
      }
      return null;
    },
    { timeout: UI_ASSIST_TIMEOUT_MS },
  );

  const result = (await frameHandle.jsonValue()) as { frame: any; url: string } | null;
  if (!result || !result.frame) {
    throw new Error('No assistant_chat_message frame captured');
  }

  expect(result.frame.message).toBeTruthy();
  expect(String(result.frame.message).length).toBeGreaterThan(0);
  if (result.frame.createdAt) {
    expect(new Date(result.frame.createdAt).toString()).not.toBe('Invalid Date');
  }

  const scrUserID = (() => {
    try {
      const u = new URL(result.url);
      return u.searchParams.get('scrUserID');
    } catch {
      return undefined;
    }
  })();

  await test.info().attach('ws-assistant-event', {
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify({
        scrUserID,
        question,
        wsUrl: result.url,
        event: result.frame,
        seenWs: await page.evaluate(() => (window as any).__wsUrls || []),
        capturedFramesSample: await page.evaluate(() => (window as any).__wsFrames?.slice(0, 5) || []),
      }),
    ),
  });
});
