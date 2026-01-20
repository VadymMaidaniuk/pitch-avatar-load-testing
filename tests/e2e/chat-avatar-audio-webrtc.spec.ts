import { test, expect } from '../fixtures/test';
import type { Page } from '@playwright/test';
import { UI_ASSIST_TIMEOUT_MS, UI_USERS } from '../helpers/chatConfig';
import { buildQuestion } from '../helpers/chatQuestions';
import { ChatPage } from '../pages/ChatPage';

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
const AUDIO_PLAYBACK_WAIT_MS = intEnv('CHAT_AUDIO_PLAYBACK_WAIT_MS', 5000);

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
  observedAt?: number;
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
                return { frame: parsed, wsUrl: f.url, observedAt: Date.now() };
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
    if (!w.__mediaPlaybackEvents) w.__mediaPlaybackEvents = [];
    if (!w.__mediaPlaybackStart) w.__mediaPlaybackStart = null;
    if (!w.__rtcTrackEvents) w.__rtcTrackEvents = [];
    if (!w.__rtcPlaybackStart) w.__rtcPlaybackStart = null;
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
        const counts = trackCounts(el);
        const entry = {
          ts: Date.now(),
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
        pc.addEventListener('track', (event: RTCTrackEvent) => {
          const track = event.track;
          const entry = {
            ts: Date.now(),
            eventType: 'track',
            kind: track?.kind || null,
            muted: !!track?.muted,
            readyState: track?.readyState || null,
            trackId: track?.id || null,
            trackLabel: track?.label || null,
            streams: event.streams ? event.streams.length : 0,
          };
          w.__rtcTrackEvents.push(entry);
          if (track && !(track as any).__pbAttached) {
            (track as any).__pbAttached = true;
            track.addEventListener('unmute', () => {
              const unmuteEntry = {
                ts: Date.now(),
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
              w.__rtcTrackEvents.push({
                ts: Date.now(),
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

  const chat = new ChatPage(page);
  await chat.open();
  const input = chat.input;
  const sendButton = chat.sendButton;

  const question = buildQuestion(userId);
  await input.fill(question);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  await sendButton.click();
  await expect(chat.userBubble(question)).toBeVisible({ timeout: 20_000 });

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
  const audioDetectedAt = await page.evaluate(() => Date.now());

  await page.waitForTimeout(AUDIO_GROWTH_WAIT_MS);
  const audioStatsAfter = await collectAudioStats(page);
  const deltaBytes = audioStatsAfter.totalBytes - audioStats.totalBytes;
  const deltaPackets = audioStatsAfter.totalPackets - audioStats.totalPackets;
  expect(deltaBytes + deltaPackets).toBeGreaterThan(0);

  const playbackInfo = await waitForPlaybackStart(page, AUDIO_PLAYBACK_WAIT_MS);
  const playbackStartDelayMs =
    playbackInfo.playbackStart && assistantWs.observedAt
      ? playbackInfo.playbackStart.ts - assistantWs.observedAt
      : null;
  const playbackStartAfterAudioMs =
    playbackInfo.playbackStart ? playbackInfo.playbackStart.ts - audioDetectedAt : null;

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
          audioDetectedAt,
          playbackInfo,
          playbackStartDelayMs,
          playbackStartAfterAudioMs,
          audioPlaybackWaitMs: AUDIO_PLAYBACK_WAIT_MS,
        },
        null,
        2,
      ),
    ),
  });
}

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`[@smoke][@e2e] UI WebRTC audio for user #${userId}`, async ({ page }) => {
    await runScenario(page, userId);
  });
}
