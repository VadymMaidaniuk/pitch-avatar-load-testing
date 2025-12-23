import { test, expect, Page, Locator } from '@playwright/test';
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

const AUDIO_TIMEOUT_MS = intEnv('CHAT_AUDIO_TIMEOUT_MS', UI_ASSIST_TIMEOUT_MS);
const AUDIO_PLAYBACK_WAIT_MS = intEnv('CHAT_AUDIO_PLAYBACK_WAIT_MS', 5000);
const AUDIO_SYNC_POLL_MS = intEnv('CHAT_AUDIO_SYNC_POLL_MS', 500);

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

type AudioGrowth = {
  baseline: AudioSample;
  firstGrowth: AudioSample;
  deltaBytes: number;
  deltaPackets: number;
};

type PlaybackEvent = {
  ts: number;
  eventType: string;
  tagName: string;
  currentTime: number;
  paused: boolean;
  readyState: number;
  muted: boolean;
  volume: number;
  src: string | null;
  hasSrcObject: boolean;
  audioTracks: number;
  videoTracks: number;
};

type RtcTrackEvent = {
  ts: number;
  eventType: string;
  kind: string | null;
  muted: boolean;
  readyState: string | null;
  trackId: string | null;
  trackLabel: string | null;
  streams: number;
};

type PlaybackFrameInfo = {
  frameUrl: string;
  playbackStart: PlaybackEvent | null;
  eventsSample: PlaybackEvent[];
  rtcAudioUnmute: RtcTrackEvent | null;
  rtcEventsSample: RtcTrackEvent[];
};

type PlaybackStartInfo = {
  source: 'media' | 'track';
  frameUrl: string;
} & (PlaybackEvent | RtcTrackEvent);

type PlaybackInfo = {
  frames: PlaybackFrameInfo[];
  playbackStart?: PlaybackStartInfo;
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

const waitForAudioGrowth = async (
  page: Page,
  baseline: AudioSample,
  timeoutMs: number,
  pollMs: number,
): Promise<AudioGrowth> => {
  const baselineBytes = baseline.stats.totalBytes;
  const baselinePackets = baseline.stats.totalPackets;
  const deadline = Date.now() + timeoutMs;
  let lastSample = baseline;

  while (Date.now() < deadline) {
    await page.waitForTimeout(pollMs);
    const sample = await sampleAudioStats(page);
    const deltaBytes = sample.stats.totalBytes - baselineBytes;
    const deltaPackets = sample.stats.totalPackets - baselinePackets;
    if (deltaBytes > 0 || deltaPackets > 0) {
      return {
        baseline,
        firstGrowth: sample,
        deltaBytes,
        deltaPackets,
      };
    }
    lastSample = sample;
  }

  throw new Error(
    `No audio growth in ${timeoutMs}ms (baselineBytes=${baselineBytes}, baselinePackets=${baselinePackets}, lastBytes=${lastSample.stats.totalBytes}, lastPackets=${lastSample.stats.totalPackets})`,
  );
};

const collectPlaybackInfo = async (page: Page): Promise<PlaybackInfo> => {
  const frames = page.frames();
  const framesInfo: PlaybackFrameInfo[] = [];
  let earliest: PlaybackStartInfo | undefined;

  for (const frame of frames) {
    try {
      const result = await frame.evaluate(() => {
        const start = (window as any).__mediaPlaybackStart || null;
        const events = (window as any).__mediaPlaybackEvents || [];
        const rtcEvents = (window as any).__rtcTrackEvents || [];
        const rtcStart = (window as any).__rtcPlaybackStart || null;
        return {
          playbackStart: start,
          eventsSample: events.slice(0, 5),
          rtcPlaybackStart: rtcStart,
          rtcEventsSample: rtcEvents.slice(0, 5),
        };
      });
      const frameUrl = frame.url();
      framesInfo.push({
        frameUrl,
        playbackStart: result.playbackStart,
        eventsSample: result.eventsSample || [],
        rtcAudioUnmute: result.rtcPlaybackStart,
        rtcEventsSample: result.rtcEventsSample || [],
      });
      if (result.playbackStart) {
        const candidate = { ...result.playbackStart, source: 'media', frameUrl } as PlaybackStartInfo;
        if (!earliest || candidate.ts < earliest.ts) {
          earliest = candidate;
        }
      }
      if (result.rtcPlaybackStart) {
        const candidate = { ...result.rtcPlaybackStart, source: 'track', frameUrl } as PlaybackStartInfo;
        if (!earliest || candidate.ts < earliest.ts) {
          earliest = candidate;
        }
      }
    } catch {
      // ignore frames that cannot be evaluated
    }
  }

  return { frames: framesInfo, playbackStart: earliest };
};

const waitForPlaybackStart = async (
  page: Page,
  timeoutMs: number,
): Promise<PlaybackInfo> => {
  const deadline = Date.now() + timeoutMs;
  let info = await collectPlaybackInfo(page);
  if (info.playbackStart || timeoutMs <= 0) return info;

  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    info = await collectPlaybackInfo(page);
    if (info.playbackStart) return info;
  }

  return info;
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

async function runScenario(page: Page, userId: number) {
  const timeout = Math.max(
    UI_ASSIST_TIMEOUT_MS + AUDIO_TIMEOUT_MS + AUDIO_PLAYBACK_WAIT_MS + 60_000,
    180_000,
  );
  test.setTimeout(timeout);

  await page.addInitScript(() => {
    const w = window as any;
    if (!w.__peerConnections) w.__peerConnections = [];
    if (!w.__mediaPlaybackEvents) w.__mediaPlaybackEvents = [];
    if (!w.__mediaPlaybackStart) w.__mediaPlaybackStart = null;
    if (!w.__rtcTrackEvents) w.__rtcTrackEvents = [];
    if (!w.__rtcPlaybackStart) w.__rtcPlaybackStart = null;
    if (typeof w.__syncGateTs !== 'number') w.__syncGateTs = 0;

    if (!w.__mediaPlaybackInstrumented) {
      w.__mediaPlaybackInstrumented = true;
      const trackCounts = (el: HTMLMediaElement) => {
        let audioTracks = 0;
        let videoTracks = 0;
        try {
          const stream = el.srcObject;
          if (stream && typeof (stream as any).getAudioTracks === 'function') {
            audioTracks = (stream as any).getAudioTracks().length;
            videoTracks = (stream as any).getVideoTracks().length;
          }
        } catch {
          // ignore
        }
        return { audioTracks, videoTracks };
      };
      const record = (el: HTMLMediaElement, eventType: string) => {
        const ts = Date.now();
        if (ts < (w.__syncGateTs || 0)) return;
        const counts = trackCounts(el);
        const entry = {
          ts,
          eventType,
          tagName: el.tagName,
          currentTime: el.currentTime || 0,
          paused: el.paused,
          readyState: el.readyState,
          muted: el.muted,
          volume: el.volume,
          src: el.currentSrc || el.src || null,
          hasSrcObject: !!el.srcObject,
          audioTracks: counts.audioTracks,
          videoTracks: counts.videoTracks,
        };
        w.__mediaPlaybackEvents.push(entry);
        const isPlayback =
          eventType === 'playing' ||
          (eventType === 'timeupdate' && !entry.paused && entry.currentTime > 0);
        if (isPlayback && !w.__mediaPlaybackStart) {
          w.__mediaPlaybackStart = entry;
        }
      };
      const attach = (el: HTMLMediaElement) => {
        if ((el as any).__pbAttached) return;
        (el as any).__pbAttached = true;
        const events = [
          'play',
          'playing',
          'timeupdate',
          'canplay',
          'loadedmetadata',
          'pause',
          'ended',
          'waiting',
          'stalled',
          'error',
        ];
        for (const evt of events) {
          el.addEventListener(evt, () => record(el, evt), { passive: true });
        }
      };
      const scan = () => {
        const nodes = document.querySelectorAll('audio,video');
        for (const node of nodes) {
          attach(node as HTMLMediaElement);
        }
      };
      const root = document.documentElement || document.body;
      if (root) {
        const observer = new MutationObserver(() => scan());
        observer.observe(root, { childList: true, subtree: true });
      }
      scan();
    }

    const Original = w.RTCPeerConnection || w.webkitRTCPeerConnection;
    if (!Original || w.__pcInstrumented) return;
    w.__pcInstrumented = true;
    const Instrumented = function (...args: any[]) {
      const pc = new Original(...args);
      try {
        pc.addEventListener('track', (event: RTCTrackEvent) => {
          const track = event.track;
          const ts = Date.now();
          if (ts >= (w.__syncGateTs || 0)) {
            w.__rtcTrackEvents.push({
              ts,
              eventType: 'track',
              kind: track?.kind || null,
              muted: !!track?.muted,
              readyState: track?.readyState || null,
              trackId: track?.id || null,
              trackLabel: track?.label || null,
              streams: event.streams ? event.streams.length : 0,
            });
          }
          if (track && !(track as any).__pbAttached) {
            (track as any).__pbAttached = true;
            track.addEventListener('unmute', () => {
              const unmuteTs = Date.now();
              if (unmuteTs < (w.__syncGateTs || 0)) return;
              const unmuteEntry = {
                ts: unmuteTs,
                eventType: 'unmute',
                kind: track.kind || null,
                muted: !!track.muted,
                readyState: track.readyState || null,
                trackId: track.id || null,
                trackLabel: track.label || null,
                streams: event.streams ? event.streams.length : 0,
              };
              w.__rtcTrackEvents.push(unmuteEntry);
              if (track.kind === 'audio' && !w.__rtcPlaybackStart) {
                w.__rtcPlaybackStart = unmuteEntry;
              }
            });
            track.addEventListener('mute', () => {
              const muteTs = Date.now();
              if (muteTs < (w.__syncGateTs || 0)) return;
              w.__rtcTrackEvents.push({
                ts: muteTs,
                eventType: 'mute',
                kind: track.kind || null,
                muted: !!track.muted,
                readyState: track.readyState || null,
                trackId: track.id || null,
                trackLabel: track.label || null,
                streams: event.streams ? event.streams.length : 0,
              });
            });
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

  await page.evaluate((gateTs) => {
    const w = window as any;
    w.__syncGateTs = gateTs;
    w.__mediaPlaybackStart = null;
    w.__rtcPlaybackStart = null;
    w.__mediaPlaybackEvents = [];
    w.__rtcTrackEvents = [];
  }, assistantText.visibleAt);

  const baseline = await sampleAudioStats(page);
  const [audioGrowth, playbackInfo] = await Promise.all([
    waitForAudioGrowth(page, baseline, AUDIO_TIMEOUT_MS, AUDIO_SYNC_POLL_MS),
    waitForPlaybackStart(page, AUDIO_PLAYBACK_WAIT_MS),
  ]);

  const textToAudioStartMs = audioGrowth.firstGrowth.ts - assistantText.visibleAt;
  const textToPlaybackMs = playbackInfo.playbackStart
    ? playbackInfo.playbackStart.ts - assistantText.visibleAt
    : null;

  console.log(
    `[sync] text->audioBytes ${textToAudioStartMs} ms, text->playback ${textToPlaybackMs ?? 'n/a'} ms`,
  );

  await test.info().attach('text-audio-sync', {
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify(
        {
          question,
          assistantText,
          audioGrowth,
          playbackInfo,
          textToAudioStartMs,
          textToPlaybackMs,
          audioTimeoutMs: AUDIO_TIMEOUT_MS,
          audioPlaybackWaitMs: AUDIO_PLAYBACK_WAIT_MS,
          audioSyncPollMs: AUDIO_SYNC_POLL_MS,
        },
        null,
        2,
      ),
    ),
  });
}

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`UI text to audio delay for user #${userId}`, async ({ page }) => {
    await runScenario(page, userId);
  });
}
