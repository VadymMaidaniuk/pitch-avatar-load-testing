const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const prefix = `${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix));
  if (value) return value.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const chatUrl = argValue('--url', process.env.CHAT_URL || 'https://slides.pitchavatar.com/x6xv2');
const durationMs = Number(argValue('--duration-ms', '20000'));
const clickStart = hasFlag('--click-start');
const autoplayBypass = hasFlag('--autoplay-bypass');
const headed = !hasFlag('--headless');
const question =
  argValue('--question', '') ||
  `Diagnose avatar audio playback in one short answer. (${Date.now()})`;

const selectors = {
  startButton: 'button[title="Tap to start"], button:has(svg[data-icon="play"])',
  messageInput: 'textarea[placeholder*="message" i], textarea[aria-label*="message" i]',
  sendButton:
    'button[type="submit"], button[aria-label*="send" i], button:has(svg), button:has(img[alt*="send" i])',
  messageList: 'ul, [role="list"]',
  assistantBubble:
    'li[type="assistant"], li[data-author="assistant"], li[aria-label*="assistant" i], [role="listitem"][data-author="assistant"], li:has-text("Chat Avatar")',
};

function cleanText(text) {
  return String(text || '')
    .replace(/^chat avatar\s*(\[[^\]]*])?\s*/i, '')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAssistantContent(text) {
  const cleaned = cleanText(text);
  return cleaned && /[A-Za-z]/.test(cleaned) && cleaned.length >= 4;
}

async function installInstrumentation(page) {
  await page.addInitScript(() => {
    const w = window;
    if (!w.__paDiag) {
      w.__paDiag = {
        wsFrames: [],
        wsUrls: [],
        playErrors: [],
        mediaEvents: [],
        rtcEvents: [],
        audioContextEvents: [],
        peerConnections: [],
      };
    }

    const diag = w.__paDiag;
    const safePush = (key, value, limit = 300) => {
      try {
        diag[key].push(value);
        if (diag[key].length > limit) diag[key].splice(0, diag[key].length - limit);
      } catch {
        // ignore
      }
    };

    if (!w.__paDiagWsInstrumented && w.WebSocket) {
      w.__paDiagWsInstrumented = true;
      const OriginalWs = w.WebSocket;
      const decoder = new TextDecoder();
      class InstrumentedWS extends OriginalWs {
        constructor(url, protocols) {
          super(url, protocols);
          safePush('wsUrls', String(url), 100);
          this.addEventListener('message', async (event) => {
            try {
              const data = event.data;
              let text = '';
              if (typeof data === 'string') {
                text = data;
              } else if (data instanceof ArrayBuffer) {
                text = decoder.decode(data);
              } else if (data && typeof data.text === 'function') {
                text = await data.text();
              }
              safePush('wsFrames', { url: String(url), data: text, ts: Date.now() }, 500);
            } catch {
              // ignore
            }
          });
        }
      }
      w.WebSocket = InstrumentedWS;
    }

    if (!w.__paDiagMediaInstrumented) {
      w.__paDiagMediaInstrumented = true;
      const trackCounts = (el) => {
        let audioTracks = 0;
        let videoTracks = 0;
        try {
          const stream = el.srcObject;
          if (stream && typeof stream.getAudioTracks === 'function') {
            audioTracks = stream.getAudioTracks().length;
            videoTracks = stream.getVideoTracks().length;
          }
        } catch {
          // ignore
        }
        return { audioTracks, videoTracks };
      };

      const mediaState = (el) => {
        const counts = trackCounts(el);
        return {
          ts: Date.now(),
          tagName: el.tagName,
          eventType: null,
          currentTime: el.currentTime || 0,
          paused: el.paused,
          ended: el.ended,
          readyState: el.readyState,
          networkState: el.networkState,
          muted: el.muted,
          defaultMuted: el.defaultMuted,
          volume: el.volume,
          src: el.currentSrc || el.src || null,
          hasSrcObject: !!el.srcObject,
          audioTracks: counts.audioTracks,
          videoTracks: counts.videoTracks,
        };
      };

      const recordMediaEvent = (el, eventType) => {
        const entry = mediaState(el);
        entry.eventType = eventType;
        safePush('mediaEvents', entry, 500);
      };

      const attach = (el) => {
        if (el.__paDiagAttached) return;
        el.__paDiagAttached = true;
        [
          'play',
          'playing',
          'timeupdate',
          'canplay',
          'loadedmetadata',
          'pause',
          'ended',
          'waiting',
          'stalled',
          'suspend',
          'error',
          'volumechange',
        ].forEach((eventType) => {
          el.addEventListener(eventType, () => recordMediaEvent(el, eventType), { passive: true });
        });
      };

      const scan = () => {
        document.querySelectorAll('audio,video').forEach((node) => attach(node));
      };

      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...playArgs) {
        recordMediaEvent(this, 'play-called');
        try {
          const result = originalPlay.apply(this, playArgs);
          if (result && typeof result.catch === 'function') {
            result.catch((error) => {
              safePush('playErrors', {
                ts: Date.now(),
                tagName: this.tagName,
                name: error?.name || null,
                message: error?.message || String(error),
                state: mediaState(this),
              });
            });
          }
          return result;
        } catch (error) {
          safePush('playErrors', {
            ts: Date.now(),
            tagName: this.tagName,
            name: error?.name || null,
            message: error?.message || String(error),
            state: mediaState(this),
          });
          throw error;
        }
      };

      const root = document.documentElement || document.body;
      if (root) {
        const observer = new MutationObserver(() => scan());
        observer.observe(root, { childList: true, subtree: true });
      }
      scan();
    }

    if (!w.__paDiagAudioContextInstrumented) {
      w.__paDiagAudioContextInstrumented = true;
      const wrapAudioContext = (name) => {
        const Original = w[name];
        if (!Original) return;
        w[name] = class InstrumentedAudioContext extends Original {
          constructor(...contextArgs) {
            super(...contextArgs);
            safePush('audioContextEvents', { ts: Date.now(), eventType: 'construct', state: this.state });
            const originalResume = this.resume;
            this.resume = (...resumeArgs) => {
              safePush('audioContextEvents', { ts: Date.now(), eventType: 'resume-called', state: this.state });
              const result = originalResume.apply(this, resumeArgs);
              if (result && typeof result.then === 'function') {
                result
                  .then(() =>
                    safePush('audioContextEvents', {
                      ts: Date.now(),
                      eventType: 'resume-resolved',
                      state: this.state,
                    }),
                  )
                  .catch((error) =>
                    safePush('audioContextEvents', {
                      ts: Date.now(),
                      eventType: 'resume-rejected',
                      state: this.state,
                      name: error?.name || null,
                      message: error?.message || String(error),
                    }),
                  );
              }
              return result;
            };
          }
        };
      };
      wrapAudioContext('AudioContext');
      wrapAudioContext('webkitAudioContext');
    }

    const OriginalPc = w.RTCPeerConnection || w.webkitRTCPeerConnection;
    if (OriginalPc && !w.__paDiagPcInstrumented) {
      w.__paDiagPcInstrumented = true;
      const InstrumentedPc = function (...pcArgs) {
        const pc = new OriginalPc(...pcArgs);
        try {
          diag.peerConnections.push(pc);
          pc.addEventListener('connectionstatechange', () => {
            safePush('rtcEvents', {
              ts: Date.now(),
              eventType: 'connectionstatechange',
              connectionState: pc.connectionState || null,
              iceConnectionState: pc.iceConnectionState || null,
            });
          });
          pc.addEventListener('iceconnectionstatechange', () => {
            safePush('rtcEvents', {
              ts: Date.now(),
              eventType: 'iceconnectionstatechange',
              connectionState: pc.connectionState || null,
              iceConnectionState: pc.iceConnectionState || null,
            });
          });
          pc.addEventListener('track', (event) => {
            const track = event.track;
            const trackInfo = () => ({
              kind: track?.kind || null,
              id: track?.id || null,
              label: track?.label || null,
              enabled: typeof track?.enabled === 'boolean' ? track.enabled : null,
              muted: typeof track?.muted === 'boolean' ? track.muted : null,
              readyState: track?.readyState || null,
              streams: event.streams ? event.streams.length : 0,
            });
            safePush('rtcEvents', { ts: Date.now(), eventType: 'track', ...trackInfo() });
            if (track) {
              track.addEventListener('mute', () =>
                safePush('rtcEvents', { ts: Date.now(), eventType: 'track-mute', ...trackInfo() }),
              );
              track.addEventListener('unmute', () =>
                safePush('rtcEvents', { ts: Date.now(), eventType: 'track-unmute', ...trackInfo() }),
              );
              track.addEventListener('ended', () =>
                safePush('rtcEvents', { ts: Date.now(), eventType: 'track-ended', ...trackInfo() }),
              );
            }
          });
        } catch {
          // ignore
        }
        return pc;
      };
      InstrumentedPc.prototype = OriginalPc.prototype;
      try {
        Object.setPrototypeOf(InstrumentedPc, OriginalPc);
      } catch {
        // ignore
      }
      w.RTCPeerConnection = InstrumentedPc;
      if (w.webkitRTCPeerConnection) w.webkitRTCPeerConnection = InstrumentedPc;
    }
  });
}

function parseAssistantFrame(rawFrame) {
  if (!rawFrame?.data) return null;
  try {
    const parsed = JSON.parse(rawFrame.data);
    const legacyType = typeof parsed?.event_type === 'string' ? parsed.event_type : '';
    const legacyMessage = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
    if (
      (legacyType === 'assistant_chat_message' || legacyType === 'chat_stream_chunk') &&
      legacyMessage
    ) {
      return {
        observedAt: rawFrame.ts || null,
        wsUrl: rawFrame.url || null,
        eventType: legacyType,
        message: legacyMessage,
      };
    }

    const envelopeType = typeof parsed?.type === 'string' ? parsed.type : '';
    const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
    const payloadMessage = typeof payload?.message === 'string' ? payload.message.trim() : '';
    if (
      (envelopeType === 'assistant_chat_message' || envelopeType === 'chat_stream_chunk') &&
      payloadMessage
    ) {
      return {
        observedAt: rawFrame.ts || null,
        wsUrl: rawFrame.url || null,
        eventType: envelopeType,
        message: payloadMessage,
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function collectFrameSnapshot(frame) {
  return frame.evaluate(async () => {
    const diag = window.__paDiag || {};
    const media = [...document.querySelectorAll('audio,video')].map((el) => {
      let audioTracks = 0;
      let videoTracks = 0;
      try {
        const stream = el.srcObject;
        if (stream && typeof stream.getAudioTracks === 'function') {
          audioTracks = stream.getAudioTracks().length;
          videoTracks = stream.getVideoTracks().length;
        }
      } catch {
        // ignore
      }
      return {
        tagName: el.tagName,
        currentTime: el.currentTime || 0,
        paused: el.paused,
        ended: el.ended,
        readyState: el.readyState,
        networkState: el.networkState,
        muted: el.muted,
        defaultMuted: el.defaultMuted,
        volume: el.volume,
        src: el.currentSrc || el.src || null,
        hasSrcObject: !!el.srcObject,
        audioTracks,
        videoTracks,
      };
    });

    const pcs = [];
    for (const pc of diag.peerConnections || []) {
      const pcInfo = {
        connectionState: pc.connectionState || null,
        iceConnectionState: pc.iceConnectionState || null,
        signalingState: pc.signalingState || null,
        receivers: [],
        inboundAudio: [],
        inboundVideo: [],
      };
      try {
        pcInfo.receivers = (pc.getReceivers ? pc.getReceivers() : []).map((receiver) => ({
          kind: receiver?.track?.kind || null,
          id: receiver?.track?.id || null,
          enabled: typeof receiver?.track?.enabled === 'boolean' ? receiver.track.enabled : null,
          muted: typeof receiver?.track?.muted === 'boolean' ? receiver.track.muted : null,
          readyState: receiver?.track?.readyState || null,
        }));
      } catch {
        // ignore
      }
      try {
        const reportSet = await pc.getStats();
        reportSet.forEach((report) => {
          const kind = report.kind || report.mediaType;
          if (report.type === 'inbound-rtp' && kind === 'audio') {
            pcInfo.inboundAudio.push({
              id: report.id,
              bytesReceived: report.bytesReceived || 0,
              packetsReceived: report.packetsReceived || 0,
              packetsLost: report.packetsLost || 0,
              audioLevel: typeof report.audioLevel === 'number' ? report.audioLevel : null,
              totalAudioEnergy:
                typeof report.totalAudioEnergy === 'number' ? report.totalAudioEnergy : null,
              totalSamplesReceived:
                typeof report.totalSamplesReceived === 'number' ? report.totalSamplesReceived : null,
              concealedSamples:
                typeof report.concealedSamples === 'number' ? report.concealedSamples : null,
              silentConcealedSamples:
                typeof report.silentConcealedSamples === 'number' ? report.silentConcealedSamples : null,
            });
          }
          if (report.type === 'inbound-rtp' && kind === 'video') {
            pcInfo.inboundVideo.push({
              id: report.id,
              bytesReceived: report.bytesReceived || 0,
              packetsReceived: report.packetsReceived || 0,
              packetsLost: report.packetsLost || 0,
              framesDecoded: report.framesDecoded || 0,
            });
          }
        });
      } catch {
        // ignore
      }
      pcs.push(pcInfo);
    }

    return {
      href: location.href,
      wsUrls: diag.wsUrls || [],
      wsFrames: (diag.wsFrames || []).slice(-20),
      playErrors: (diag.playErrors || []).slice(-20),
      mediaEvents: (diag.mediaEvents || []).slice(-40),
      rtcEvents: (diag.rtcEvents || []).slice(-40),
      audioContextEvents: diag.audioContextEvents || [],
      media,
      pcs,
    };
  });
}

async function collectSnapshot(page, consoleEvents) {
  const frames = [];
  for (const frame of page.frames()) {
    try {
      const data = await collectFrameSnapshot(frame);
      frames.push({ frameUrl: frame.url(), ok: true, ...data });
    } catch (error) {
      frames.push({ frameUrl: frame.url(), ok: false, error: error.message });
    }
  }
  return {
    ts: Date.now(),
    iso: new Date().toISOString(),
    pageUrl: page.url(),
    frames,
    consoleEvents: consoleEvents.slice(-50),
  };
}

function summarizeSamples(samples) {
  const summary = {
    maxAudioLevel: 0,
    totalAudioEnergyFirst: null,
    totalAudioEnergyLast: null,
    totalAudioEnergyDelta: null,
    audioBytesFirst: null,
    audioBytesLast: null,
    audioBytesDelta: null,
    audioPacketsFirst: null,
    audioPacketsLast: null,
    audioPacketsDelta: null,
    playErrors: [],
    mediaHadPlayingEvent: false,
    mediaWithAudioTrackFinal: [],
    receiverAudioFinal: [],
  };

  const totalsForSample = (sample) => {
    let bytes = 0;
    let packets = 0;
    let energy = 0;
    let hasEnergy = false;
    let maxLevel = 0;
    for (const frame of sample.frames || []) {
      for (const pc of frame.pcs || []) {
        for (const report of pc.inboundAudio || []) {
          bytes += report.bytesReceived || 0;
          packets += report.packetsReceived || 0;
          if (typeof report.totalAudioEnergy === 'number') {
            energy += report.totalAudioEnergy;
            hasEnergy = true;
          }
          if (typeof report.audioLevel === 'number') {
            maxLevel = Math.max(maxLevel, report.audioLevel);
          }
        }
      }
    }
    return { bytes, packets, energy: hasEnergy ? energy : null, maxLevel };
  };

  if (!samples.length) return summary;
  const first = totalsForSample(samples[0]);
  const last = totalsForSample(samples[samples.length - 1]);
  summary.totalAudioEnergyFirst = first.energy;
  summary.totalAudioEnergyLast = last.energy;
  summary.totalAudioEnergyDelta =
    first.energy === null || last.energy === null ? null : last.energy - first.energy;
  summary.audioBytesFirst = first.bytes;
  summary.audioBytesLast = last.bytes;
  summary.audioBytesDelta = last.bytes - first.bytes;
  summary.audioPacketsFirst = first.packets;
  summary.audioPacketsLast = last.packets;
  summary.audioPacketsDelta = last.packets - first.packets;

  for (const sample of samples) {
    const totals = totalsForSample(sample);
    summary.maxAudioLevel = Math.max(summary.maxAudioLevel, totals.maxLevel);
    for (const frame of sample.frames || []) {
      for (const error of frame.playErrors || []) {
        const key = `${error.ts}|${error.name}|${error.message}|${error.state?.src || ''}`;
        if (
          !summary.playErrors.some(
            (existing) =>
              `${existing.ts}|${existing.name}|${existing.message}|${existing.state?.src || ''}` === key,
          )
        ) {
          summary.playErrors.push(error);
        }
      }
      if ((frame.mediaEvents || []).some((event) => event.eventType === 'playing')) {
        summary.mediaHadPlayingEvent = true;
      }
    }
  }

  const final = samples[samples.length - 1];
  for (const frame of final.frames || []) {
    for (const media of frame.media || []) {
      if (media.audioTracks > 0 || media.videoTracks > 0) {
        summary.mediaWithAudioTrackFinal.push({ frameUrl: frame.frameUrl, ...media });
      }
    }
    for (const pc of frame.pcs || []) {
      for (const receiver of pc.receivers || []) {
        if (receiver.kind === 'audio') {
          summary.receiverAudioFinal.push({
            frameUrl: frame.frameUrl,
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            ...receiver,
          });
        }
      }
    }
  }
  return summary;
}

async function findAssistantWs(page, sentAt) {
  for (const frame of page.frames()) {
    try {
      const frames = await frame.evaluate(() => window.__paDiag?.wsFrames || []);
      for (const rawFrame of frames) {
        if (rawFrame.ts && rawFrame.ts < sentAt) continue;
        const parsed = parseAssistantFrame(rawFrame);
        if (parsed) return { ...parsed, frameUrl: frame.url() };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function waitForSignals(page, assistantBubbles, botCountBefore, sentAt) {
  const deadline = Date.now() + 60000;
  let uiSignal = null;
  let wsSignal = null;

  while (Date.now() < deadline) {
    if (!uiSignal) {
      const count = await assistantBubbles.count().catch(() => 0);
      for (let index = botCountBefore; index < count; index += 1) {
        const candidate = assistantBubbles.nth(index);
        const text = cleanText(await candidate.innerText({ timeout: 1000 }).catch(() => ''));
        if (hasAssistantContent(text)) {
          uiSignal = { observedAt: Date.now(), text };
          break;
        }
      }
    }
    if (!wsSignal) {
      wsSignal = await findAssistantWs(page, sentAt);
    }
    if (uiSignal || wsSignal) break;
    await page.waitForTimeout(250);
  }

  return { uiSignal, wsSignal };
}

(async () => {
  fs.mkdirSync(path.join(process.cwd(), 'test-results'), { recursive: true });

  const launchArgs = ['--use-fake-ui-for-media-stream'];
  if (autoplayBypass) launchArgs.push('--autoplay-policy=no-user-gesture-required');

  const browser = await chromium.launch({ headless: !headed, args: launchArgs });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleEvents = [];

  page.on('console', (message) => {
    const type = message.type();
    if (['error', 'warning', 'warn'].includes(type)) {
      consoleEvents.push({ ts: Date.now(), type, text: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    consoleEvents.push({ ts: Date.now(), type: 'pageerror', text: error.message });
  });
  page.on('requestfailed', (request) => {
    consoleEvents.push({
      ts: Date.now(),
      type: 'requestfailed',
      text: `${request.failure()?.errorText || 'failed'} ${request.url()}`,
    });
  });

  await installInstrumentation(page);
  await page.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator(selectors.messageInput).first().waitFor({ state: 'visible', timeout: 60000 });

  const startButton = page.locator(selectors.startButton).first();
  const startButtonVisible = await startButton.isVisible({ timeout: 2000 }).catch(() => false);
  if (clickStart && startButtonVisible) {
    await startButton.click({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }

  const input = page.locator(selectors.messageInput).first();
  const form = input.locator('xpath=ancestor::form[1]');
  const sendButton = form.locator(selectors.sendButton).first();
  const container = page.locator('section, div, aside').filter({ has: input }).first();
  const messageList = container.locator(selectors.messageList).first();
  const assistantBubbles = messageList.locator(selectors.assistantBubble);
  const botCountBefore = await assistantBubbles.count().catch(() => 0);

  await input.fill(question);
  await sendButton.waitFor({ state: 'visible', timeout: 10000 });

  const beforeSend = await collectSnapshot(page, consoleEvents);
  const sentAt = Date.now();
  await sendButton.click();

  const signals = { uiSignal: null, wsSignal: null };
  const samples = [];
  const startedSamplingAt = Date.now();
  while (Date.now() - startedSamplingAt < durationMs) {
    if (!signals.wsSignal) {
      signals.wsSignal = await findAssistantWs(page, sentAt);
    }
    if (!signals.uiSignal) {
      const count = await assistantBubbles.count().catch(() => 0);
      await messageList
        .evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        })
        .catch(() => {});
      for (let index = botCountBefore; index < count; index += 1) {
        const candidate = assistantBubbles.nth(index);
        const text = cleanText(await candidate.innerText({ timeout: 1000 }).catch(() => ''));
        if (hasAssistantContent(text)) {
          signals.uiSignal = { observedAt: Date.now(), text };
          break;
        }
      }
    }
    samples.push(await collectSnapshot(page, consoleEvents));
    await page.waitForTimeout(500);
  }
  if (!signals.wsSignal) {
    signals.wsSignal = await findAssistantWs(page, sentAt);
  }
  samples.push(await collectSnapshot(page, consoleEvents));

  const output = {
    url: chatUrl,
    question,
    options: {
      clickStart,
      startButtonVisible,
      autoplayBypass,
      headed,
      durationMs,
    },
    sentAt,
    sentAtIso: new Date(sentAt).toISOString(),
    signals,
    summary: summarizeSamples(samples),
    beforeSend,
    samples,
  };

  const slug = chatUrl.split('/').filter(Boolean).pop()?.replace(/[^a-zA-Z0-9_-]/g, '') || 'chat';
  const mode = `${autoplayBypass ? 'autoplay-bypass' : 'default'}${clickStart ? '-click-start' : ''}`;
  const outputPath = path.join('test-results', `diagnose-audio-${slug}-${mode}-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(
    JSON.stringify(
      {
        outputPath,
        signals,
        summary: {
          ...output.summary,
          playErrorCount: output.summary.playErrors.length,
          playErrors: output.summary.playErrors.slice(0, 5),
        },
      },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
