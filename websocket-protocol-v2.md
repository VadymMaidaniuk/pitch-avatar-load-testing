# WebSocket Protocol v2 Specification

## Overview

Unified envelope-based WebSocket protocol for real-time communication.

**Protocol Version:** `1.0`

---

## Connection Management

### Connection Parameters
- **Ping Interval**: 54 seconds - Server sends ping to client
- **Pong Wait**: 60 seconds - Server waits for pong response
- **Write Timeout**: 20 seconds - Timeout for write operations
- **Session Close Delay**: 10 seconds - Wait before closing session

### Session Registration
Each WebSocket connection is registered with a `scrUserID` and maintains **Gorilla WebSocket connection**

---

## Base Envelope Structure

All messages use this envelope format:

```json
{
  "version": "1.0",
  "type": "<message_type>",
  "trace_id": "<optional_string>",
  "timestamp": "<optional_iso8601>",
  "payload": { ... }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | yes | Protocol version, always `"1.0"` |
| `type` | string | yes | Message type identifier |
| `trace_id` | string | no | Optional trace ID for request correlation |
| `timestamp` | string | no | ISO 8601 timestamp (server → client only) |
| `payload` | object | yes | Type-specific payload data |

---

## Message Types Summary

### Client → Server

| Type | Description |
|------|-------------|
| `set_parameter` | Update parameter value |
| `action_finish` | Report action completion |
| `report_action` | Container for user/presenter actions |
| `trigger_control` | Execute a control trigger by step control ID |

### Server → Client

| Type | Description |
|------|-------------|
| `action_started` | Action execution started |
| `action_finished` | Action execution finished |
| `parameter_changed` | Parameter value changed |
| `assistant_chat_message` | Assistant response |
| `chat_stream_start` | Text streaming started |
| `chat_stream_chunk` | Text streaming chunk |
| `chat_stream_end` | Text streaming ended |
| `security_error` | Security violation |
| `webhook_result` | Webhook execution result |
| `debugger_error_message` | Debug error message |

### Report Action Sub-types

| Action | Data Required | Description |
|--------|---------------|-------------|
| `screen_user_started_screening` | no | User started screening |
| `screen_user_made_chat_message` | **yes** | User sent chat message |
| `screen_user_changed_step` | **yes** | User changed step |
| `user_enter_to_screening` | no | Presenter connected |
| `user_exit_from_screening` | no | Presenter disconnected |
| `presenter_send_chat_message` | **yes** | Presenter sent message |
| `presenter_mark_messages_read` | no | Presenter marked messages read |

---

# Client → Server Messages

## 1. `set_parameter`

Update a parameter value.

**Payload Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parameter_name` | string | yes | Name of the parameter |
| `value` | string | yes | New value (string, backend converts) |
| `is_text_input` | boolean | no | Whether value comes from text input |

**Example:**

```json
{
  "version": "1.0",
  "type": "set_parameter",
  "payload": {
    "parameter_name": "Play Status",
    "value": "true",
    "is_text_input": false
  }
}
```

---

## 2. `action_finish`

Report that an action has completed on the frontend.

**Payload Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uuid` | string | yes | Action UUID that was completed |
| `status` | string | yes | Completion status: `"success"` or `"error"` |

**Example:**

```json
{
  "version": "1.0",
  "type": "action_finish",
  "payload": {
    "uuid": "38a7f2f6-1234-5678-9abc-def012345678",
    "status": "success"
  }
}
```

---

## 3. `report_action`

Container for user/presenter actions. Uses nested sub-envelope structure.

**Payload Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | yes | Report action type |
| `data` | object | depends | Action-specific data (see sub-types below) |

**General Structure:**

```json
{
  "version": "1.0",
  "type": "report_action",
  "payload": {
    "action": "<action_type>",
    "data": { ... }
  }
}
```

---

### 3.1 `screen_user_started_screening`

User started the screening session.

**Data:** Not required. Can be `{}`, `null`, or omitted.

**Example:**

```json
{
  "version": "1.0",
  "type": "report_action",
  "payload": {
    "action": "screen_user_started_screening",
    "data": {}
  }
}
```

**Also valid:**

```json
{
  "version": "1.0",
  "type": "report_action",
  "payload": {
    "action": "screen_user_started_screening"
  }
}
```

---

### 3.2 `screen_user_made_chat_message`

User sent a chat message.

**Data:** Required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | yes | Chat message text (non-empty) |

**Example:**

```json
{
  "version": "1.0",
  "type": "report_action",
  "payload": {
    "action": "screen_user_made_chat_message",
    "data": {
      "message": "Hello, I have a question about your product."
    }
  }
}
```

---

### 3.3 `screen_user_changed_step`

User changed the current step/slide.

**Data:** Required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `screening_step_id` | string | yes | ID of the new step |

**Example:**

```json
{
  "version": "1.0",
  "type": "report_action",
  "payload": {
    "action": "screen_user_changed_step",
    "data": {
      "screening_step_id": "5"
    }
  }
}
```

---

### 3.4 `user_enter_to_screening`

Presenter connected to the session.

**Data:** Not required. Can be `{}`, `null`, or omitted.

**Example:**

```json
{
  "version": "1.0",
  "type": "report_action",
  "payload": {
    "action": "user_enter_to_screening",
    "data": {}
  }
}
```
**Also valid:**

```json
{
  "version": "1.0",
  "type": "report_action",
  "payload": {
    "action": "user_enter_to_screening"
  }
}
```
---

### 3.5 `user_exit_from_screening`

Presenter disconnected from the session.

**Data:** Not required. Can be `{}`, `null`, or omitted.

**Example:**

```json
{
  "version": "1.0",
  "type": "report_action",
  "payload": {
    "action": "user_exit_from_screening"
  }
}
```

---

### 3.6 `presenter_send_chat_message`

Presenter sent a chat message.

**Data:** Required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | yes | Chat message text (non-empty) |

**Example:**

```json
{
  "version": "1.0",
  "type": "report_action",
  "payload": {
    "action": "presenter_send_chat_message",
    "data": {
      "message": "Note from the presenter: please check slide 3."
    }
  }
}
```

---

### 3.7 `presenter_mark_messages_read`

Presenter marked all their messages as read.

**Data:** Not required. Can be `{}`, `null`, or omitted.

**Example:**

```json
{
  "version": "1.0",
  "type": "report_action",
  "payload": {
    "action": "presenter_mark_messages_read"
  }
}
```

---

## 4. `trigger_control`

Execute a control trigger by its step control ID. The server finds the trigger by `step_control_id` in the current session and enqueues it for execution.

**Note:** `screening_user_id` is not required — the server resolves it from the WebSocket session.

**Payload Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `step_control_id` | string | yes | ID of the control step/trigger to execute |

**Example:**

```json
{
  "version": "1.0",
  "type": "trigger_control",
  "payload": {
    "step_control_id": "control_123"
  }
}
```

---

# Server → Client Messages

## 5. `action_started`

Action execution has started.

**Payload Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Action ID |
| `uuid` | string | Unique action identifier |
| `action_type` | string | Type of action (e.g., `speak_text`, `change_step`) |
| `data` | object | Action configuration data |
| `trigger_id` | number | Parent trigger ID |
| `trigger_name` | string | Parent trigger name |
| `delay` | number | Delay in seconds before action |
| `timeout` | number | Action timeout in seconds |
| `started_at` | string | Start timestamp (`YYYY-MM-DD HH:mm:ss`) |
| `created_at` | string | Creation timestamp |
| `updated_at` | string | Last update timestamp |
| `status` | string | Always `"in_progress"` |
| `screening_action_id` | number | Same as `id` |
| `screening_trigger_id` | number | Same as `trigger_id` |
| `payload` | string | Pre-processed action payload |
| `non_stoppable` | boolean | Whether action can be interrupted |
| `initiator` | object | Parameter that triggered the action |

**Example:**

```json
{
  "version": "1.0",
  "type": "action_started",
  "timestamp": "2025-10-03T11:15:21.544Z",
  "payload": {
    "id": 123,
    "uuid": "38a7f2f6-1234-5678-9abc-def012345678",
    "action_type": "speak_text",
    "data": {
      "text": "Welcome to our presentation!"
    },
    "trigger_id": 456,
    "trigger_name": "Welcome Message",
    "delay": 0,
    "timeout": 30,
    "started_at": "2025-10-03 11:15:21",
    "created_at": "2025-10-03 11:15:21",
    "updated_at": "2025-10-03 11:15:21",
    "status": "in_progress",
    "screening_action_id": 123,
    "screening_trigger_id": 456,
    "payload": "<prepared_action_payload>",
    "non_stoppable": false,
    "initiator": {
      "parameter": {}
    }
  }
}
```

---

## 6. `action_finished`

Action execution has completed.

**Payload Schema:** Same as `action_started`, but:
- `status` is `"finished"`
- `payload` is empty string `""`

**Example:**

```json
{
  "version": "1.0",
  "type": "action_finished",
  "timestamp": "2025-10-03T11:15:25.123Z",
  "payload": {
    "id": 123,
    "uuid": "38a7f2f6-1234-5678-9abc-def012345678",
    "action_type": "speak_text",
    "data": {},
    "trigger_id": 456,
    "trigger_name": "Welcome Message",
    "delay": 0,
    "timeout": 30,
    "started_at": "2025-10-03 11:15:25",
    "created_at": "2025-10-03 11:15:25",
    "updated_at": "2025-10-03 11:15:25",
    "status": "finished",
    "screening_action_id": 123,
    "screening_trigger_id": 456,
    "payload": "",
    "non_stoppable": false,
    "initiator": {
      "parameter": {}
    }
  }
}
```

---

## 7. `parameter_changed`

A parameter value has changed.

**Payload Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `parameter` | object | Parameter object |

**Parameter Object:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Parameter name |
| `type` | string | Parameter type (`bool`, `string`, `integer`, etc.) |
| `value` | any | Current value |
| `old_value` | any | Previous value |
| `defined` | boolean | Whether parameter is defined |
| `updated_at` | string | Last update timestamp |
| `inner_type` | string | Inner type for complex parameters |

**Example:**

```json
{
  "version": "1.0",
  "type": "parameter_changed",
  "timestamp": "2025-10-03T11:15:21.544Z",
  "payload": {
    "parameter": {
      "name": "Play Status",
      "type": "bool",
      "value": true,
      "old_value": false,
      "defined": true,
      "updated_at": "2025-10-03 11:15:21",
      "inner_type": ""
    }
  }
}
```

---

## 8. `assistant_chat_message`

Assistant response message (non-streaming).

**Payload Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique message ID (UUID) |
| `message` | string | Message text content |
| `message_count` | number | Total message count |
| `unread_message_count` | number | Unread message count |
| `action_uuid` | string | Associated action UUID (if any) |
| `chunk_type` | string | Optional chunk type |
| `createdAt` | string | ISO 8601 timestamp |

**Example:**

```json
{
  "version": "1.0",
  "type": "assistant_chat_message",
  "timestamp": "2025-10-03T11:15:21.544Z",
  "payload": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "message": "Hello! How can I help you today?",
    "message_count": 1,
    "unread_message_count": 1,
    "action_uuid": "",
    "createdAt": "2025-10-03T11:15:21.544Z"
  }
}
```

---

## 9. `chat_stream_start`

Text streaming has started.

**Payload Schema:** Same as `assistant_chat_message`

**Example:**

```json
{
  "version": "1.0",
  "type": "chat_stream_start",
  "timestamp": "2025-10-03T11:15:21.544Z",
  "payload": {
    "id": "1d19d055-1234-5678-9abc-def012345678",
    "message": "",
    "message_count": 0,
    "unread_message_count": 0,
    "action_uuid": "",
    "createdAt": "2025-10-03T11:15:21.544Z"
  }
}
```

---

## 10. `chat_stream_chunk`

Text streaming chunk.

**Payload Schema:** Same as `assistant_chat_message`, plus:

| Field | Type | Description |
|-------|------|-------------|
| `chunk_type` | string | Type of chunk (e.g., `"text"`) |

**Example:**

```json
{
  "version": "1.0",
  "type": "chat_stream_chunk",
  "timestamp": "2025-10-03T11:15:21.600Z",
  "payload": {
    "id": "1d19d055-1234-5678-9abc-def012345678",
    "message": "Hello ",
    "message_count": 0,
    "unread_message_count": 0,
    "action_uuid": "",
    "chunk_type": "text",
    "createdAt": "2025-10-03T11:15:21.600Z"
  }
}
```

---

## 11. `chat_stream_end`

Text streaming has ended.

**Payload Schema:** Same as `assistant_chat_message`

**Example:**

```json
{
  "version": "1.0",
  "type": "chat_stream_end",
  "timestamp": "2025-10-03T11:15:22.100Z",
  "payload": {
    "id": "1d19d055-1234-5678-9abc-def012345678",
    "message": "",
    "message_count": 0,
    "unread_message_count": 0,
    "action_uuid": "",
    "createdAt": "2025-10-03T11:15:22.100Z"
  }
}
```

---

## 12. `security_error`

Security violation detected.

**Payload Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Security error code |
| `type` | string | Error type (e.g., `prompt_injection`, `document_injection`) |
| `classification` | string | Always `"error"` |
| `message` | string | Human-readable description |

**Example:**

```json
{
  "version": "1.0",
  "type": "security_error",
  "timestamp": "2025-10-03T11:15:21.544Z",
  "payload": {
    "code": "PROMPT_INJECTION_DETECTED",
    "type": "prompt_injection",
    "classification": "error",
    "message": "Your message was blocked due to security policy violation"
  }
}
```

---

## 13. `webhook_result`

Webhook execution result.

**Payload Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `action_id` | number | Action ID |
| `action_uuid` | string | Action UUID |
| `status` | string | `"success"` or `"error"` |
| `url` | string | Webhook URL that was called |
| `status_code` | number | HTTP response status code (optional) |
| `error` | string | Error message if failed (optional) |
| `executed_at` | string | ISO 8601 execution timestamp |

**Example:**

```json
{
  "version": "1.0",
  "type": "webhook_result",
  "timestamp": "2025-10-03T11:15:21.544Z",
  "payload": {
    "action_id": 123,
    "action_uuid": "38a7f2f6-1234-5678-9abc-def012345678",
    "status": "success",
    "url": "https://api.example.com/webhook",
    "status_code": 200,
    "error": "",
    "executed_at": "2025-10-03T11:15:21Z"
  }
}
```

---

## 14. `debugger_error_message`

Debug error message for development/debugging.

**Payload Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | Debug/error message |

**Example:**

```json
{
  "version": "1.0",
  "type": "debugger_error_message",
  "timestamp": "2025-10-03T11:15:21.544Z",
  "payload": {
    "message": "Failed to process instruction: invalid parameter type"
  }
}
```

---

## Error Handling

### Connection Errors
- **Read Errors**: Trigger connection cleanup and session unregistration
- **Write Errors**: Close connection and broadcast channel
- **Ping/Pong Timeout**: Force connection termination

### Message Processing Errors
- Individual handler failures don't stop pipeline execution
- Malformed JSON messages are logged but don't crash handlers
- Missing required fields cause handler-specific error responses

### Session Management Errors
- Invalid `scrUserID` causes message rejection
- Concurrent access protected by mutex locks

---

## Connection Lifecycle

### 1. Connection Establishment
```
Client connects to /ws → WebSocket upgrade → Session registration
```

### 2. Active Connection
```
ReadPump: Receives messages → Handler pipeline
WritePump: Broadcasts messages + Keepalive pings (every 54s)
TickerWorker: Sends every 1 second "Time Spent in Presentation" and "Time Spent in Slide"
`parameter_value_changed` events if `Play Status` parameter is set to true
```

### 3. Connection Termination
```
Context cancellation → ReadPump/WritePump shutdown → Session cleanup (after 10s delay) → Resource cleanup
```

### Session Cleanup Process
1. Wait 10 seconds after context cancellation
2. Check if new session opened for same `scrUserID`
3. If no new session, send close notification to external API
4. Clean up session resources

---

## Implementation Notes

### Concurrency Safety
- All WebSocket writes are serialized through channels
- Session access protected by appropriate locking mechanisms
- Goroutines used for non-blocking message broadcasts

### Performance Considerations
- Buffered channels (capacity: 100) for message queuing
- 5-second timeout for message sends to prevent blocking
- Parallel handler execution where possible

### Data Specific Notes

1. **Timestamps:**
   - Envelope `timestamp`: ISO 8601 format (`2025-10-03T11:15:21.544Z`)
   - Payload timestamps: `YYYY-MM-DD HH:mm:ss` format (for backward compatibility)

2. **Report action data field:**
   - Actions with **required data**: `screen_user_made_chat_message`, `screen_user_changed_step`, `presenter_send_chat_message`
   - Actions with **optional data**: `screen_user_started_screening`, `user_enter_to_screening`, `user_exit_from_screening`, `presenter_mark_messages_read`
   - For optional data actions, `data` can be `{}`, `null`, or omitted entirely

3. **trace_id:** Optional field for request correlation, can be used for debugging
