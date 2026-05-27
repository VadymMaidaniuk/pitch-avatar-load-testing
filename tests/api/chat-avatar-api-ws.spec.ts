import { test, expect } from '../fixtures/test';
import WebSocket from 'ws';
import { UI_USERS, WS_BASE_URL } from '../helpers/chatConfig';
import { buildQuestion } from '../helpers/chatQuestions';
import { WS_ASSIST_TIMEOUT_MS } from '../helpers/chatRuntimeConfig';
import { ScrApiClient } from '../services/api/ScrApiClient';

const buildTraceId = () =>
  `Root=1-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;

const connectWs = (wsUrl: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const cleanup = () => {
      socket.off('open', onOpen);
      socket.off('error', onError);
    };
    const onOpen = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    socket.on('open', onOpen);
    socket.on('error', onError);
  });

const sendWsEnvelope = (
  socket: WebSocket,
  type: string,
  payload: Record<string, unknown>,
) => {
  socket.send(
    JSON.stringify({
      version: '1.0',
      type,
      trace_id: buildTraceId(),
      timestamp: new Date().toISOString(),
      payload,
    }),
  );
};

const sendWsSetParameter = (
  socket: WebSocket,
  name: string,
  type: string,
  value: string | boolean | number,
) => {
  sendWsEnvelope(socket, 'set_parameter', { name, type, value });
};

const sendWsReportAction = (socket: WebSocket, action: string, data: Record<string, unknown> = {}) => {
  sendWsEnvelope(socket, 'report_action', { action, data });
};

const extractAssistantFrameData = (
  frame: any,
): { message: string; createdAt?: string; eventType?: string } | null => {
  if (!frame || typeof frame !== 'object') return null;

  const legacyType = typeof frame.event_type === 'string' ? frame.event_type : '';
  const legacyMessage = typeof frame.message === 'string' ? frame.message.trim() : '';
  if (
    (legacyType === 'assistant_chat_message' || legacyType === 'chat_stream_chunk') &&
    legacyMessage.length > 0
  ) {
    return {
      message: legacyMessage,
      createdAt: typeof frame.createdAt === 'string' ? frame.createdAt : undefined,
      eventType: legacyType,
    };
  }

  const envelopeType = typeof frame.type === 'string' ? frame.type : '';
  const payload =
    frame.payload && typeof frame.payload === 'object'
      ? (frame.payload as Record<string, unknown>)
      : {};
  const payloadMessage =
    typeof payload.message === 'string' ? String(payload.message).trim() : '';
  if (
    (envelopeType === 'assistant_chat_message' || envelopeType === 'chat_stream_chunk') &&
    payloadMessage.length > 0
  ) {
    const createdAt =
      typeof payload.createdAt === 'string'
        ? payload.createdAt
        : typeof frame.timestamp === 'string'
          ? frame.timestamp
          : undefined;
    return {
      message: payloadMessage,
      createdAt,
      eventType: envelopeType,
    };
  }

  return null;
};

const waitForAssistantMessage = (
  socket: WebSocket,
  timeoutMs: number,
  frames: string[],
) =>
  new Promise<{ frame: any; raw: string; assistant: { message: string; createdAt?: string; eventType?: string } }>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Assistant reply not received in ${timeoutMs}ms`));
    }, timeoutMs);

    const onMessage = (data: WebSocket.RawData) => {
      const raw = typeof data === 'string' ? data : data.toString();
      frames.push(raw);
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const assistant = extractAssistantFrameData(parsed);
      if (assistant) {
        cleanup();
        resolve({ frame: parsed, raw, assistant });
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const onClose = () => {
      cleanup();
      reject(new Error('WS closed before assistant reply'));
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
    };

    socket.on('message', onMessage);
    socket.on('error', onError);
    socket.on('close', onClose);
  });

for (let userId = 1; userId <= UI_USERS; userId += 1) {
  test(`[@smoke][@api] API+WS user #${userId} assistant reply on WS`, async ({ request }) => {
    test.setTimeout(Math.max(WS_ASSIST_TIMEOUT_MS + 60_000, 120_000));
    const client = new ScrApiClient(request);
    const frames: string[] = [];
    let socket: WebSocket | undefined;
    let wsUrl = '';
    let question = '';
    let scrUserID = '';
    const {
      token,
      scrUserID: currentScrUserID,
      screeningStepID,
      languageID,
    } = await client.login();
    if (!screeningStepID) {
      throw new Error('Login response missing first screening step ID');
    }
    scrUserID = currentScrUserID;
    test.info().annotations.push({ type: 'scrUserID', description: scrUserID });

    await client.initializeScreeningParameters(token, languageID);

    wsUrl = `${WS_BASE_URL}/ws?scrUserID=${encodeURIComponent(scrUserID)}`;
    socket = await connectWs(wsUrl);

    try {
      const waitForReply = waitForAssistantMessage(socket, WS_ASSIST_TIMEOUT_MS, frames);
      sendWsSetParameter(socket, 'Voice Recognition Status', 'bool', false);
      sendWsSetParameter(socket, 'Presentation Language', 'string', languageID);
      sendWsSetParameter(socket, 'Listener Language', 'string', languageID);

      await client.reportAction(token, 'screen_user_started_screening');
      sendWsReportAction(socket, 'screen_user_started_screening');
      sendWsReportAction(socket, 'screen_user_autoplay_off', {
        screening_step_id: screeningStepID,
      });
      sendWsReportAction(socket, 'screen_user_changed_step', {
        screening_step_id: screeningStepID,
      });

      question = buildQuestion(userId);
      const reportResponse = await client.reportAction(token, 'screen_user_made_chat_message', {
        message: question,
      });
      expect(reportResponse.ok()).toBeTruthy();
      sendWsReportAction(socket, 'screen_user_made_chat_message', { message: question });

      const result = await waitForReply;
      expect(result.assistant.message).toBeTruthy();
      if (result.assistant.createdAt) {
        expect(new Date(result.assistant.createdAt).toString()).not.toBe('Invalid Date');
      }

      await test.info().attach('ws-assistant-event', {
        contentType: 'application/json',
        body: Buffer.from(
          JSON.stringify({
            scrUserID,
            screeningStepID,
            languageID,
            question,
            wsUrl,
            assistant: result.assistant,
            event: result.frame,
            framesSample: frames.slice(0, 5),
          }),
        ),
      });
    } finally {
      if (scrUserID) {
        await test.info().attach('scr-user-context', {
          contentType: 'application/json',
          body: Buffer.from(
            JSON.stringify({
              userId,
              scrUserID,
              screeningStepID,
              languageID,
              wsUrl,
              question,
              frameCount: frames.length,
              framesSample: frames.slice(0, 5),
            }),
          ),
        });
      }
      socket?.close();
    }
  });
}
