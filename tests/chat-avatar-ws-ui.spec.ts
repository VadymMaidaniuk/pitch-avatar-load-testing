import { test, expect } from '@playwright/test';
import { UI_ASSIST_TIMEOUT_MS, UI_USERS } from './chatConfig';
import { openChat, buildQuestion, userBubble } from './chatShared';

async function runScenario(page, userId: number) {
  const timeout = Math.max(UI_ASSIST_TIMEOUT_MS + 60_000, 120_000);
  test.setTimeout(timeout);

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

  const { input, sendButton } = await openChat(page);
  const question = buildQuestion(userId);
  await input.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  const sendTs = Date.now();
  await sendButton.click();
  await expect(userBubble(page, question)).toBeVisible({ timeout: 20_000 });

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
  const receivedTs = Date.now();
  const latencyMs = receivedTs - sendTs;
  console.log(`[WS] assistant reply latency ${latencyMs} ms`);

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
        sendTimestamp: sendTs,
        receivedTimestamp: receivedTs,
        latencyMs,
        seenWs: await page.evaluate(() => (window as any).__wsUrls || []),
        capturedFramesSample: await page.evaluate(() => (window as any).__wsFrames?.slice(0, 5) || []),
      }),
    ),
  });
}

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`UI+WS user #${userId} assistant reply on WS`, async ({ page }) => {
    await runScenario(page, userId);
  });
}
