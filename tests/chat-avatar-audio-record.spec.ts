import { test, expect, Page, Locator, Frame } from '@playwright/test';
import fs from 'fs';
import { UI_ASSIST_TIMEOUT_MS, UI_USERS } from './chatConfig';
import { openChat, buildQuestion, userBubble, assistantBubbles } from './chatShared';

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

const floatEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw ? parseFloat(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return fallback;
};

const AUDIO_TIMEOUT_MS = intEnv('CHAT_AUDIO_TIMEOUT_MS', UI_ASSIST_TIMEOUT_MS);
const AUDIO_MIN_BYTES = intEnv('CHAT_AUDIO_MIN_BYTES', 1);
const AUDIO_MIN_PACKETS = intEnv('CHAT_AUDIO_MIN_PACKETS', 1);
const AUDIO_RECORD_MAX_MS = intEnv('CHAT_AUDIO_RECORD_MS', 30000);
const AUDIO_RECORD_SILENCE_MS = intEnv('CHAT_AUDIO_RECORD_SILENCE_MS', 2000);
const AUDIO_RECORD_WAIT_MS = intEnv('CHAT_AUDIO_RECORD_WAIT_MS', 15000);
const AUDIO_RECORD_POLL_MS = intEnv('CHAT_AUDIO_RECORD_POLL_MS', 250);
const AUDIO_RECORD_MIME = process.env.CHAT_AUDIO_RECORD_MIME || '';
const AUDIO_LEVEL_THRESHOLD = floatEnv('CHAT_AUDIO_LEVEL_THRESHOLD', 0.02);
const AUDIO_ENERGY_DELTA = floatEnv('CHAT_AUDIO_ENERGY_DELTA', 0.001);

type AudioStats = {
  frameCount: number;
  evaluatedFrames: number;
  frameOrigins: string[];
  pcCount: number;
  connectedPcs: number;
  iceConnectedPcs: number;
  audioReportCount: number;
  totalBytes: number;
  totalPackets: number;
};

type AudioSample = {
  ts: number;
  stats: AudioStats;
};

type RecordingResult = {
  base64: string;
  mimeType: string;
  size: number;
  trackId: string | null;
  trackLabel: string | null;
  startedAt: number;
  endedAt: number;
  stopReason: 'silence' | 'maxDuration';
  hadSpeech: boolean;
  lastAudioLevel: number;
  lastTotalAudioEnergy: number;
};

type AssistantTextResult = {
  text: string;
  visibleAt: number;
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
    totalBytes: 0,
    totalPackets: 0,
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
        let audioReportCount = 0;
        let connectedPcs = 0;
        let iceConnectedPcs = 0;
        for (const pc of pcs) {
          if (!pc) continue;
          if (pc.connectionState === 'connected') {
            connectedPcs += 1;
          }
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            iceConnectedPcs += 1;
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
            }
          });
        }
        return {
          pcCount: pcs.length,
          connectedPcs,
          iceConnectedPcs,
          audioReportCount,
          totalBytes,
          totalPackets,
        };
      });

      aggregate.evaluatedFrames += 1;
      aggregate.pcCount += stats.pcCount || 0;
      aggregate.connectedPcs += stats.connectedPcs || 0;
      aggregate.iceConnectedPcs += stats.iceConnectedPcs || 0;
      aggregate.audioReportCount += stats.audioReportCount || 0;
      aggregate.totalBytes += stats.totalBytes || 0;
      aggregate.totalPackets += stats.totalPackets || 0;
    } catch {
      // ignore frames that cannot be evaluated
    }
  }

  return aggregate;
};

const sampleAudioStats = async (page: Page): Promise<AudioSample> => {
  const ts = await page.evaluate(() => Date.now());
  const stats = await collectAudioStats(page);
  return { ts, stats };
};

const waitForInboundAudio = async (
  page: Page,
  timeoutMs: number,
  minBytes: number,
  minPackets: number,
): Promise<AudioSample> => {
  const deadline = Date.now() + timeoutMs;
  let last = await sampleAudioStats(page);
  if (last.stats.totalBytes >= minBytes || last.stats.totalPackets >= minPackets) return last;

  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    last = await sampleAudioStats(page);
    if (last.stats.totalBytes >= minBytes || last.stats.totalPackets >= minPackets) return last;
  }

  throw new Error(
    `No inbound audio in ${timeoutMs}ms (bytes=${last.stats.totalBytes}, packets=${last.stats.totalPackets}, reports=${last.stats.audioReportCount})`,
  );
};

const waitForAssistantText = async (
  page: Page,
  assistantBubbleLocator: Locator,
  startIndex: number,
  messageList: Locator,
): Promise<AssistantTextResult> => {
  const deadline = Date.now() + UI_ASSIST_TIMEOUT_MS;
  let lastText = '';
  const stripLabel = (text: string) =>
    text.replace(/^chat avatar\s*(\[[^\]]*])?\s*/i, '').trim();
  const stripTimestamp = (text: string) => text.replace(/\b\d{1,2}:\d{2}\b/g, '').trim();
  const cleanText = (text: string) => stripTimestamp(stripLabel(text.replace(/\s+/g, ' ').trim()));
  const hasContent = (text: string) => text && /[A-Za-z]/.test(text) && text.length >= 4;
  const isLabelOnly = (text: string) => /^chat avatar\b/i.test(text) || /^\d{1,2}:\d{2}$/.test(text);

  while (Date.now() < deadline) {
    const currentCount = await assistantBubbleLocator.count();
    await messageList
      .evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      })
      .catch(() => {});

    for (let idx = startIndex; idx < currentCount; idx += 1) {
      const candidate = assistantBubbleLocator.nth(idx);
      const parts = (await candidate.locator('p, span, div').allInnerTexts().catch(() => [])) ?? [];
      for (const part of parts) {
        const cleaned = cleanText(part);
        if (cleaned) lastText = cleaned;
        if (hasContent(cleaned) && !isLabelOnly(cleaned)) {
          const visibleAt = await page.evaluate(() => Date.now());
          return { text: cleaned, visibleAt };
        }
      }
      const fallback = cleanText(await candidate.innerText({ timeout: 2_000 }).catch(() => ''));
      if (fallback) lastText = fallback;
      if (hasContent(fallback) && !isLabelOnly(fallback)) {
        const visibleAt = await page.evaluate(() => Date.now());
        return { text: fallback, visibleAt };
      }
    }
    await page.waitForTimeout(500);
  }

  throw new Error(
    `Assistant reply text not received in ${UI_ASSIST_TIMEOUT_MS}ms (last text: "${lastText}")`,
  );
};

const hasLiveAudioTrack = async (frame: Frame): Promise<boolean> => {
  try {
    return await frame.evaluate(() => {
      const w = window as any;
      const pcs = w.__peerConnections || [];
      for (const pc of pcs) {
        if (!pc || typeof pc.getReceivers !== 'function') continue;
        const receivers = pc.getReceivers();
        for (const receiver of receivers) {
          const track = receiver?.track;
          if (track && track.kind === 'audio' && track.readyState === 'live') {
            return true;
          }
        }
      }
      const stored = w.__rtcAudioTracks || [];
      for (const track of stored) {
        if (track && track.kind === 'audio' && track.readyState === 'live') {
          return true;
        }
      }
      return false;
    });
  } catch {
    return false;
  }
};

const findAudioFrame = async (
  page: Page,
  waitMs: number,
  pollMs: number,
): Promise<Frame | null> => {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const frames = page.frames();
    for (const frame of frames) {
      if (await hasLiveAudioTrack(frame)) {
        return frame;
      }
    }
    await page.waitForTimeout(pollMs);
  }
  return null;
};

const recordAudioClip = async (
  frame: Frame,
  maxMs: number,
  silenceMs: number,
  pollMs: number,
  mimePreference: string,
  levelThreshold: number,
  energyDelta: number,
): Promise<RecordingResult> => {
  return frame.evaluate(
    async ({ maxMs, silenceMs, pollMs, mimePreference, levelThreshold, energyDelta }) => {
      const w = window as any;
      const findAudioTrack = () => {
        const pcs = w.__peerConnections || [];
        for (const pc of pcs) {
          if (!pc || typeof pc.getReceivers !== 'function') continue;
          const receivers = pc.getReceivers();
          for (const receiver of receivers) {
            const track = receiver?.track;
            if (track && track.kind === 'audio' && track.readyState === 'live') {
              return track;
            }
          }
        }
        const stored = w.__rtcAudioTracks || [];
        for (const track of stored) {
          if (track && track.kind === 'audio' && track.readyState === 'live') {
            return track;
          }
        }
        return null;
      };

      const readEnergy = async () => {
        const pcs = w.__peerConnections || [];
        let maxAudioLevel = 0;
        let totalAudioEnergy = 0;
        let reportCount = 0;
        for (const pc of pcs) {
          if (!pc) continue;
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
              if (typeof report.audioLevel === 'number') {
                maxAudioLevel = Math.max(maxAudioLevel, report.audioLevel);
              }
              if (typeof report.totalAudioEnergy === 'number') {
                totalAudioEnergy += report.totalAudioEnergy;
              }
              reportCount += 1;
            }
          });
        }
        return { maxAudioLevel, totalAudioEnergy, reportCount };
      };

      if (!('MediaRecorder' in window)) {
        throw new Error('MediaRecorder is not available in this browser context');
      }

      const track = findAudioTrack();
      if (!track) {
        throw new Error('No live audio track in selected frame');
      }

      const stream = new MediaStream([track]);
      const candidates = [
        mimePreference || '',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ].filter((value) => value);
      let mimeType = '';
      for (const candidate of candidates) {
        if (MediaRecorder.isTypeSupported(candidate)) {
          mimeType = candidate;
          break;
        }
      }
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.addEventListener('dataavailable', (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      });
      const startedAt = Date.now();
      const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
      recorder.start();
      let lastEnergy: number | null = null;
      let lastNonSilent = startedAt;
      let hadSpeech = false;
      let lastAudioLevel = 0;
      let lastTotalAudioEnergy = 0;
      let stopReason: 'silence' | 'maxDuration' = 'maxDuration';

      while (Date.now() - startedAt < maxMs) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        const energy = await readEnergy();
        if (energy.reportCount > 0) {
          lastAudioLevel = energy.maxAudioLevel || 0;
          lastTotalAudioEnergy = energy.totalAudioEnergy || 0;
          const deltaEnergy = lastEnergy === null ? 0 : energy.totalAudioEnergy - lastEnergy;
          lastEnergy = energy.totalAudioEnergy;
          const hasSignal =
            energy.maxAudioLevel >= levelThreshold ||
            (deltaEnergy >= energyDelta && energy.totalAudioEnergy > 0);
          if (hasSignal) {
            hadSpeech = true;
            lastNonSilent = Date.now();
          }
        }
        if (hadSpeech && Date.now() - lastNonSilent >= silenceMs) {
          stopReason = 'silence';
          break;
        }
      }

      recorder.stop();
      await stopped;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < buffer.length; i += chunkSize) {
        binary += String.fromCharCode(...buffer.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      return {
        base64,
        mimeType: blob.type,
        size: blob.size,
        trackId: track.id || null,
        trackLabel: track.label || null,
        startedAt,
        endedAt: Date.now(),
        stopReason,
        hadSpeech,
        lastAudioLevel,
        lastTotalAudioEnergy,
      };
    },
    {
      maxMs,
      silenceMs,
      pollMs,
      mimePreference,
      levelThreshold,
      energyDelta,
    },
  );
};

async function runScenario(page: Page, userId: number, testInfo: import('@playwright/test').TestInfo) {
  const timeout = Math.max(
    UI_ASSIST_TIMEOUT_MS + AUDIO_TIMEOUT_MS + AUDIO_RECORD_WAIT_MS + AUDIO_RECORD_MAX_MS + 60_000,
    180_000,
  );
  test.setTimeout(timeout);

  await page.addInitScript(() => {
    const w = window as any;
    if (!w.__peerConnections) w.__peerConnections = [];
    if (!w.__rtcAudioTracks) w.__rtcAudioTracks = [];
    const Original = w.RTCPeerConnection || w.webkitRTCPeerConnection;
    if (!Original || w.__pcInstrumented) return;
    w.__pcInstrumented = true;
    const Instrumented = function (...args: any[]) {
      const pc = new Original(...args);
      try {
        pc.addEventListener('track', (event: RTCTrackEvent) => {
          const track = event.track;
          if (track && track.kind === 'audio') {
            w.__rtcAudioTracks.push(track);
          }
        });
      } catch {
        // ignore
      }
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

  const { input, sendButton, messageList } = await openChat(page);
  const assistantBubbleLocator = assistantBubbles(page);

  const question = buildQuestion(userId);
  await input.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });

  const botCountBefore = await assistantBubbleLocator.count();
  await sendButton.click();
  await expect(userBubble(page, question)).toBeVisible({ timeout: 20_000 });

  const assistantText = await waitForAssistantText(
    page,
    assistantBubbleLocator,
    botCountBefore,
    messageList,
  );

  const audioSample = await waitForInboundAudio(
    page,
    AUDIO_TIMEOUT_MS,
    AUDIO_MIN_BYTES,
    AUDIO_MIN_PACKETS,
  );

  const recordFrame = await findAudioFrame(page, AUDIO_RECORD_WAIT_MS, AUDIO_RECORD_POLL_MS);
  if (!recordFrame) {
    throw new Error(`No live audio track after ${AUDIO_RECORD_WAIT_MS}ms`);
  }

  const recording = await recordAudioClip(
    recordFrame,
    AUDIO_RECORD_MAX_MS,
    AUDIO_RECORD_SILENCE_MS,
    AUDIO_RECORD_POLL_MS,
    AUDIO_RECORD_MIME,
    AUDIO_LEVEL_THRESHOLD,
    AUDIO_ENERGY_DELTA,
  );
  expect(recording.size).toBeGreaterThan(0);

  const extension = recording.mimeType.includes('ogg') ? 'ogg' : 'webm';
  const outputPath = testInfo.outputPath(`audio-${userId}-${Date.now()}.${extension}`);
  fs.writeFileSync(outputPath, Buffer.from(recording.base64, 'base64'));

  await testInfo.attach('recorded-audio', {
    path: outputPath,
    contentType: recording.mimeType || 'audio/webm',
  });

  await testInfo.attach('recording-info', {
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify(
        {
          question,
          assistantText,
          audioSample,
          recording: {
            ...recording,
            base64: undefined,
          },
        },
        null,
        2,
      ),
    ),
  });
}

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`UI records audio for user #${userId}`, async ({ page }, testInfo) => {
    await runScenario(page, userId, testInfo);
  });
}
