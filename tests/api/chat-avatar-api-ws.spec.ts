import { test, expect } from '../fixtures/test';
import WebSocket from 'ws';
import { UI_USERS, WS_ASSIST_TIMEOUT_MS, WS_BASE_URL } from '../helpers/chatConfig';
import { buildQuestion } from '../helpers/chatQuestions';
import { ScrApiClient } from '../services/api/ScrApiClient';

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

const sendWsReportAction = (socket: WebSocket, action: string, data: Record<string, unknown> = {}) => {
  const traceId = `Root=1-${Date.now().toString(16)}`;
  const payload = {
    data: {
      type: 'report-actions',
      attributes: { action, data },
    },
    traceId,
  };
  socket.send(JSON.stringify(payload));
};

const waitForAssistantMessage = (
  socket: WebSocket,
  timeoutMs: number,
  frames: string[],
) =>
  new Promise<{ frame: any; raw: string }>((resolve, reject) => {
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
      if (parsed?.event_type === 'assistant_chat_message' || parsed?.message) {
        cleanup();
        resolve({ frame: parsed, raw });
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
    const { token, scrUserID: currentScrUserID } = await client.login();
    scrUserID = currentScrUserID;
    test.info().annotations.push({ type: 'scrUserID', description: scrUserID });

    wsUrl = `${WS_BASE_URL}/ws?scrUserID=${encodeURIComponent(scrUserID)}`;
    socket = await connectWs(wsUrl);

    try {
      const waitForReply = waitForAssistantMessage(socket, WS_ASSIST_TIMEOUT_MS, frames);
      await client.reportAction(token, 'screen_user_started_screening');
      sendWsReportAction(socket, 'screen_user_started_screening');

      question = buildQuestion(userId);
      const reportResponse = await client.reportAction(token, 'screen_user_made_chat_message', {
        message: question,
      });
      expect(reportResponse.ok()).toBeTruthy();
      sendWsReportAction(socket, 'screen_user_made_chat_message', { message: question });

      const result = await waitForReply;
      expect(result.frame?.message).toBeTruthy();
      if (result.frame?.createdAt) {
        expect(new Date(result.frame.createdAt).toString()).not.toBe('Invalid Date');
      }

      await test.info().attach('ws-assistant-event', {
        contentType: 'application/json',
        body: Buffer.from(
          JSON.stringify({
            scrUserID,
            question,
            wsUrl,
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
