import { test, expect, Page } from '@playwright/test';
import { UI_ASSIST_TIMEOUT_MS, UI_USERS } from './chatConfig';
import { openChat, buildQuestion, userBubble } from './chatShared';

test.use({
  headless: false,
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
  },
});

const intEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

const AUDIO_TIMEOUT_MS = intEnv('CHAT_AUDIO_TIMEOUT_MS', UI_ASSIST_TIMEOUT_MS);
const AUDIO_MIN_BYTES = intEnv('CHAT_AUDIO_MIN_BYTES', 1);
const AUDIO_MIN_PACKETS = intEnv('CHAT_AUDIO_MIN_PACKETS', 1);
const AUDIO_GROWTH_WAIT_MS = intEnv('CHAT_AUDIO_GROWTH_WAIT_MS', 1500);

type AudioStats = {
  frameCount: number;
  evaluatedFrames: number;
  frameOrigins: string[];
  pcCount: number;
  connectedPcs: number;
  iceConnectedPcs: number;
  audioReportCount: number;
  videoReportCount: number;
  totalBytes: number;
  totalPackets: number;
  videoBytes: number;
  videoPackets: number;
  audioReceivers: number;
  videoReceivers: number;
};

type WsAssistantMessage = {
  frame: any;
  wsUrl?: string;
  frameUrl?: string;
};

const collectAudioStats = async (page: Page): Promise<AudioStats> => {
  const frames = page.frames();
  const aggregate: AudioStats = {
    frameCount: frames.length,
    evaluatedFrames: 0,
    frameOrigins: [],
    pcCount: 0,
    connectedPcs: 0,
    iceConnectedPcs: 0,
    audioReportCount: 0,
    videoReportCount: 0,
    totalBytes: 0,
    totalPackets: 0,
    videoBytes: 0,
    videoPackets: 0,
    audioReceivers: 0,
    videoReceivers: 0,
  };

  for (const frame of frames) {
    const frameUrl = frame.url();
    try {
      aggregate.frameOrigins.push(new URL(frameUrl).origin);
    } catch {
      aggregate.frameOrigins.push(frameUrl);
    }

    try {
      const stats = await frame.evaluate(async () => {
        const pcs = (window as any).__peerConnections || [];
        let totalBytes = 0;
        let totalPackets = 0;
        let videoBytes = 0;
        let videoPackets = 0;
        let audioReportCount = 0;
        let videoReportCount = 0;
        let connectedPcs = 0;
        let iceConnectedPcs = 0;
        let audioReceivers = 0;
        let videoReceivers = 0;
        for (const pc of pcs) {
          if (!pc) continue;
          if (pc.connectionState === 'connected') {
            connectedPcs += 1;
          }
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            iceConnectedPcs += 1;
          }
          try {
            const receivers = pc.getReceivers ? pc.getReceivers() : [];
            for (const receiver of receivers) {
              const kind = receiver?.track?.kind;
              if (kind === 'audio') audioReceivers += 1;
              if (kind === 'video') videoReceivers += 1;
            }
          } catch {
            // ignore
          }
          let reportSet: any;
          try {
            reportSet = await pc.getStats();
          } catch {
            continue;
          }
          reportSet.forEach((report: any) => {
            if (
              report.type === 'inbound-rtp' &&
              (report.kind === 'audio' || report.mediaType === 'audio')
            ) {
              totalBytes += report.bytesReceived || 0;
              totalPackets += report.packetsReceived || 0;
              audioReportCount += 1;
              return;
            }
            if (
              report.type === 'inbound-rtp' &&
              (report.kind === 'video' || report.mediaType === 'video')
            ) {
              videoBytes += report.bytesReceived || 0;
              videoPackets += report.packetsReceived || 0;
              videoReportCount += 1;
            }
          });
        }
        return {
          pcCount: pcs.length,
          connectedPcs,
          iceConnectedPcs,
          audioReportCount,
          videoReportCount,
          totalBytes,
          totalPackets,
          videoBytes,
          videoPackets,
          audioReceivers,
          videoReceivers,
        };
      });

      aggregate.evaluatedFrames += 1;
      aggregate.pcCount += stats.pcCount || 0;
      aggregate.connectedPcs += stats.connectedPcs || 0;
      aggregate.iceConnectedPcs += stats.iceConnectedPcs || 0;
      aggregate.audioReportCount += stats.audioReportCount || 0;
      aggregate.videoReportCount += stats.videoReportCount || 0;
      aggregate.totalBytes += stats.totalBytes || 0;
      aggregate.totalPackets += stats.totalPackets || 0;
      aggregate.videoBytes += stats.videoBytes || 0;
      aggregate.videoPackets += stats.videoPackets || 0;
      aggregate.audioReceivers += stats.audioReceivers || 0;
      aggregate.videoReceivers += stats.videoReceivers || 0;
    } catch {
      // ignore frames that cannot be evaluated
    }
  }

  return aggregate;
};

const waitForAssistantWsMessage = async (
  page: Page,
  timeoutMs: number,
): Promise<WsAssistantMessage> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const result = await frame.evaluate(() => {
          const frames: { url?: string; data?: string }[] = (window as any).__wsFrames || [];
          for (const f of frames) {
            if (!f?.data) continue;
            try {
              const parsed = JSON.parse(f.data);
              if (parsed?.event_type === 'assistant_chat_message' || parsed?.message) {
                return { frame: parsed, wsUrl: f.url };
              }
            } catch {
              // ignore non-json
            }
          }
          return null;
        });
        if (result?.frame) {
          return { ...result, frameUrl: frame.url() };
        }
      } catch {
        // ignore frames that cannot be evaluated
      }
    }
    await page.waitForTimeout(500);
  }

  throw new Error(`No assistant WS message in ${timeoutMs}ms`);
};

const waitForInboundAudio = async (
  page: Page,
  timeoutMs: number,
  minBytes: number,
  minPackets: number,
): Promise<AudioStats> => {
  const deadline = Date.now() + timeoutMs;
  let last: AudioStats = {
    frameCount: 0,
    evaluatedFrames: 0,
    frameOrigins: [],
    pcCount: 0,
    connectedPcs: 0,
    iceConnectedPcs: 0,
    audioReportCount: 0,
    videoReportCount: 0,
    totalBytes: 0,
    totalPackets: 0,
    videoBytes: 0,
    videoPackets: 0,
    audioReceivers: 0,
    videoReceivers: 0,
  };

  while (Date.now() < deadline) {
    last = await collectAudioStats(page);
    if (last.totalBytes >= minBytes || last.totalPackets >= minPackets) {
      return last;
    }
    await page.waitForTimeout(1000);
  }

  throw new Error(
    `No inbound audio in ${timeoutMs}ms (frames=${last.frameCount}, evalFrames=${last.evaluatedFrames}, pcs=${last.pcCount}, connected=${last.connectedPcs}, iceConnected=${last.iceConnectedPcs}, audioReceivers=${last.audioReceivers}, videoReceivers=${last.videoReceivers}, audioReports=${last.audioReportCount}, videoReports=${last.videoReportCount}, audioBytes=${last.totalBytes}, audioPackets=${last.totalPackets}, videoBytes=${last.videoBytes}, videoPackets=${last.videoPackets})`,
  );
};

async function runScenario(page: Page, userId: number) {
  const timeout = Math.max(UI_ASSIST_TIMEOUT_MS + AUDIO_TIMEOUT_MS + 60_000, 150_000);
  test.setTimeout(timeout);

  await page.addInitScript(() => {
    const w = window as any;
    if (!w.__peerConnections) w.__peerConnections = [];
    if (!w.__wsFrames) w.__wsFrames = [];
    if (!w.__wsUrls) w.__wsUrls = [];
    const OriginalWs = w.WebSocket;
    if (OriginalWs && !w.__wsInstrumented) {
      w.__wsInstrumented = true;
      const decoder = new TextDecoder();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      class InstrumentedWS extends OriginalWs {
        constructor(url: string, protocols?: string | string[]) {
          super(url, protocols as any);
          try {
            w.__wsUrls.push(url);
          } catch {
            // ignore
          }
          this.addEventListener('message', async (event: MessageEvent) => {
            try {
              const data = (event as any).data;
              let text = '';
              if (typeof data === 'string') {
                text = data;
              } else if (data instanceof ArrayBuffer) {
                text = decoder.decode(data);
              } else if (data && typeof (data as any).text === 'function') {
                text = await (data as any).text();
              }
              w.__wsFrames.push({ url, data: text });
            } catch {
              // ignore
            }
          });
        }
      }
      // @ts-ignore
      w.WebSocket = InstrumentedWS;
    }
    const Original = w.RTCPeerConnection || w.webkitRTCPeerConnection;
    if (!Original || w.__pcInstrumented) return;
    w.__pcInstrumented = true;
    const Instrumented = function (...args: any[]) {
      const pc = new Original(...args);
      try {
        w.__peerConnections.push(pc);
      } catch {
        // ignore
      }
      return pc;
    };
    Instrumented.prototype = Original.prototype;
    try {
      Object.setPrototypeOf(Instrumented, Original);
    } catch {
      // ignore
    }
    w.RTCPeerConnection = Instrumented;
    if (w.webkitRTCPeerConnection) {
      w.webkitRTCPeerConnection = Instrumented;
    }
  });

  const { input, sendButton } = await openChat(page);

  const question = buildQuestion(userId);
  await input.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  await sendButton.click();
  await expect(userBubble(page, question)).toBeVisible({ timeout: 20_000 });

  const assistantWs = await waitForAssistantWsMessage(page, UI_ASSIST_TIMEOUT_MS);
  if (assistantWs.frame?.message) {
    expect(String(assistantWs.frame.message).length).toBeGreaterThan(0);
  }

  const audioStats = await waitForInboundAudio(
    page,
    AUDIO_TIMEOUT_MS,
    AUDIO_MIN_BYTES,
    AUDIO_MIN_PACKETS,
  );
  expect(audioStats.totalBytes + audioStats.totalPackets).toBeGreaterThan(0);

  await page.waitForTimeout(AUDIO_GROWTH_WAIT_MS);
  const audioStatsAfter = await collectAudioStats(page);
  const deltaBytes = audioStatsAfter.totalBytes - audioStats.totalBytes;
  const deltaPackets = audioStatsAfter.totalPackets - audioStats.totalPackets;
  expect(deltaBytes + deltaPackets).toBeGreaterThan(0);

  await test.info().attach('webrtc-audio-stats', {
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify(
        {
          question,
          assistantWs,
          audioStats,
          audioStatsAfter,
          audioGrowthWaitMs: AUDIO_GROWTH_WAIT_MS,
        },
        null,
        2,
      ),
    ),
  });
}

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`UI WebRTC audio for user #${userId}`, async ({ page }) => {
    await runScenario(page, userId);
  });
}
