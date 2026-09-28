import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

export type ReplyStatus = 'ok' | 'timeout' | 'ws_error' | 'server_error' | 'protocol_error';
export type TextReply = {
  status: ReplyStatus;
  sentAtUtc: string;
  sentAtMonotonicMs: number;
  traceId: string;
  messageId: string | null;
  firstTextMs: number | null;
  fullTextMs: number | null;
  elapsedMs: number;
  text: string;
  chunks: number;
  completionEvent: string | null;
  error: string | null;
};

type PendingReply = {
  result: TextReply;
  started: number;
  streaming: boolean;
  timer: NodeJS.Timeout;
  resolve: (reply: TextReply) => void;
};

/** One outstanding question per socket; IDs prevent old chunks leaking into the next turn. */
export class AvatarTextSession {
  private readonly seenIds = new Set<string>();
  private readonly idleStreams = new Set<string>();
  private readonly activityListeners = new Set<() => void>();
  private pending?: PendingReply;
  private failure?: string;

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => this.onMessage(data));
    // Keep handlers installed even between questions / during setup.
    socket.on('error', () => this.fail('WebSocket transport error'));
    socket.on('close', (code) => this.fail(`WebSocket closed (${code})`));
  }

  static async connect(url: string, timeoutMs: number, signal?: AbortSignal): Promise<AvatarTextSession> {
    signal?.throwIfAborted();
    const socket = new WebSocket(url, { handshakeTimeout: timeoutMs });
    const session = new AvatarTextSession(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('WebSocket connection timeout')), timeoutMs);
      const onOpen = () => finish();
      const onError = () => finish(new Error('WebSocket connection failed'));
      const onClose = () => finish(new Error('WebSocket closed during connection'));
      const onAbort = () => finish(new Error('WebSocket connection aborted'));
      const finish = (error?: Error) => {
        clearTimeout(timer);
        socket.off('open', onOpen);
        socket.off('error', onError);
        socket.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
        if (error) { socket.terminate(); reject(error); } else resolve();
      };
      socket.once('open', onOpen);
      socket.once('error', onError);
      socket.once('close', onClose);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    return session;
  }

  assertOpen(): void {
    if (this.failure || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(this.failure ?? 'WebSocket is not open');
    }
  }

  send(type: string, payload: Record<string, unknown>, traceId: string = randomUUID()): void {
    this.assertOpen();
    this.socket.send(JSON.stringify({ version: '1.0', type, trace_id: traceId, payload }), (error) => {
      if (error) this.fail('WebSocket send failed');
    });
  }

  setParameter(parameterName: string, value: string | boolean): void {
    // Validated on the live dev server: parameter_name is rejected as "empty name".
    this.send('set_parameter', { name: parameterName, type: typeof value === 'boolean' ? 'bool' : 'string', value });
  }

  reportAction(action: string, data: Record<string, unknown> = {}): void {
    this.send('report_action', { action, data });
  }

  /** Event-reset quiet window drains startup greetings, with a bounded setup deadline. */
  waitUntilIdle(quietMs: number, timeoutMs: number): Promise<void> {
    this.assertOpen();
    return new Promise((resolve, reject) => {
      let quietTimer: NodeJS.Timeout | undefined;
      const deadline = setTimeout(() => finish(new Error('Startup text did not settle before setup timeout')), timeoutMs);
      const finish = (error?: Error) => {
        clearTimeout(deadline);
        clearTimeout(quietTimer);
        this.activityListeners.delete(reset);
        if (error) reject(error); else resolve();
      };
      const reset = () => {
        clearTimeout(quietTimer);
        if (this.failure) return finish(new Error(this.failure));
        if (this.idleStreams.size === 0) quietTimer = setTimeout(() => finish(), quietMs);
      };
      this.activityListeners.add(reset);
      reset();
    });
  }

  ask(question: string, timeoutMs: number): Promise<TextReply> {
    this.assertOpen();
    if (this.pending) throw new Error('Only one outstanding question is allowed per session');
    const started = performance.now();
    const result: TextReply = {
      status: 'timeout', sentAtUtc: new Date().toISOString(), sentAtMonotonicMs: started,
      traceId: randomUUID(), messageId: null, firstTextMs: null, fullTextMs: null,
      elapsedMs: 0, text: '', chunks: 0, completionEvent: null, error: null,
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finish('timeout', `No complete text response within ${timeoutMs}ms`), timeoutMs);
      this.pending = { result, started, streaming: false, timer, resolve };
      try {
        // Timer starts immediately before WS send; API login / initialization is excluded.
        this.send('report_action', {
          action: 'screen_user_made_chat_message', data: { message: question },
        }, result.traceId);
      } catch {
        this.finish('ws_error', 'WebSocket send failed');
      }
    });
  }

  private onMessage(raw: WebSocket.RawData): void {
    let frame: any;
    try { frame = JSON.parse(raw.toString()); } catch { return; }
    if (!frame || typeof frame !== 'object') return;
    const type = frame.type ?? frame.event_type;
    const payload = frame.payload && typeof frame.payload === 'object' ? frame.payload : frame;
    if (type === 'security_error' || type === 'debugger_error_message') {
      // Do not persist arbitrary backend error bodies, which may contain credentials.
      if (this.pending) this.finish('server_error', `Server emitted ${type}`);
      else this.fail(`Server emitted ${type} during session setup`);
      return;
    }
    if (!['assistant_chat_message', 'chat_stream_start', 'chat_stream_chunk', 'chat_stream_end'].includes(type)) return;
    if (type === 'chat_stream_chunk' && payload.chunk_type && payload.chunk_type !== 'text') return;
    const id = payload.id === undefined || payload.id === null ? '' : String(payload.id);
    if (!this.pending) {
      if (id) {
        this.seenIds.add(id);
        if (type === 'chat_stream_start' || type === 'chat_stream_chunk') this.idleStreams.add(id);
        if (type === 'chat_stream_end' || type === 'assistant_chat_message') this.idleStreams.delete(id);
      }
      for (const listener of this.activityListeners) listener();
      return;
    }
    if (id && this.seenIds.has(id)) return;
    const pending = this.pending;
    if (!id) return this.finish('protocol_error', 'Assistant response is missing a message ID');
    if (pending.result.messageId && pending.result.messageId !== id) {
      return this.finish('protocol_error', 'Overlapping assistant message IDs; response cannot be attributed safely');
    }
    pending.result.messageId = id;
    const text = typeof payload.message === 'string' ? payload.message : '';
    const isText = !payload.chunk_type || payload.chunk_type === 'text';
    if (type === 'chat_stream_start' || type === 'chat_stream_chunk') {
      pending.streaming = true;
      if (isText && text) {
        pending.result.text += text;
        if (type === 'chat_stream_chunk') pending.result.chunks += 1;
      }
    } else if (text.trim()) {
      pending.result.text = text;
    }
    if (pending.result.text.trim() && pending.result.firstTextMs === null) {
      pending.result.firstTextMs = performance.now() - pending.started;
    }
    if (pending.result.text.length > 1_000_000) {
      return this.finish('protocol_error', 'Response exceeded 1,000,000 characters');
    }
    if (type === 'chat_stream_end' || (type === 'assistant_chat_message' && !pending.streaming)) {
      if (!pending.result.text.trim()) return this.finish('protocol_error', 'Assistant completed an empty response');
      pending.result.completionEvent = type;
      this.finish('ok');
    }
  }

  private finish(status: ReplyStatus, error: string | null = null): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    const elapsedMs = performance.now() - pending.started;
    if (pending.result.messageId) this.seenIds.add(pending.result.messageId);
    this.pending = undefined;
    pending.resolve({ ...pending.result, status, error, elapsedMs, fullTextMs: status === 'ok' ? elapsedMs : null });
  }

  private fail(message: string): void {
    this.failure ??= message;
    this.finish('ws_error', message);
    for (const listener of this.activityListeners) listener();
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.socket.terminate(), 1000);
      this.socket.once('close', () => { clearTimeout(timer); resolve(); });
      this.socket.close();
    });
  }
}
