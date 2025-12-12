# Overview of chat-avatar communication
- Page: `https://slides.pitchavatar.com/qjs2y` loads a chat avatar player. On load it POSTs a screening login to get a bearer token and `scrUserID`, preloads parameters, opens two Socket.IO presence sockets plus a main WS at `wss://haproxy-prod.pitchavatar.com/ws?scrUserID=...`, and fetches chat history.
- Text chat flows through the haproxy WS: client sends `report-actions` (including `screen_user_made_chat_message`) and `SetParameterValue`; server streams `parameter_value_changed` and `assistant_chat_message`. Presence socket.io channels mirror chat events as `ReportActionCreatedBroadcast`.
- Sending a text message triggers both a REST `report-actions` POST and a WS message; server replies over WS with assistant messages and updates `Last Listener chat message`. Chat history is fetched via REST.
- Reloading the page creates a new `scrUserID` and new tokens; all sockets reconnect with the new IDs; previous WS closes (no close code observed). Voice path was not exercised; only voice-recognition token retrieval and disabling voice recognition were observed.
- Captures taken via Playwright headless with chat messages “Hello from automation 1” and “Second message after first” and a page reload. Observed IDs: `scrUserID` 368444 (first run) and 368448 (chat run). Bearer tokens: `riqxdq...` (first), `PYAxJR...` (chat); scr short link: `qjs2y`; screening id: 199901; presentation id: 60397; assistant userable_id: 11345; stream provider: `microsoft`; presenter_id: `matt-9C51DD6lgH`; driver_id: `mBHOFBuOHq`; streamId example: `strm_SWyEH22gfuMsn-_jFW6x1$v1_EKS`.

# REST API Map
| Method | Path | When | Key headers | Query params | Request body | Response | Testing notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/scr/qjs2y/login?include=...` | Initial load and reload | `Authorization: Bearer` (empty), `Content-Type: application/vnd.api+json`, `X-Requested-With` | `include` of steps/files/assistant | `{"is_iframe":false,"original_source":""}` | 200 JSON: `token`, `user.id` (=scrUserID), screening metadata, slides | Token present; scrUserID created; 4xx on bad short |
| GET | `/api/scr/qjs2y/parameters` | After login to preload | `Authorization: Bearer <token>` | — | — | 200 JSON: `parameters` map (string/bool/int) including languages, slides text | Required keys exist; types match `data_type` |
| POST | `/api/scr/qjs2y/parameters/screening-parameters` | Set languages on load | `Authorization: Bearer`, `Content-Type: application/vnd.api+json` | — | `{"parameters":{"Presentation Language":"en","Listener Language":"en"}}` | 200 empty | Language validation; rejects bad codes |
| POST | `/api/scr/qjs2y/parameters/screening-parameters/Voice Recognition Status` | Disable voice recognition on load | Same | — | `{"value":"0","is_text_input":false}` | 200 empty | Bool/string handling; idempotent |
| POST | `/api/scr/qjs2y/report-actions` | On load (`started_screening`, `changed_step`, `turn_off_voice_recognition`) and on chat send (`screen_user_made_chat_message`) | `Authorization: Bearer`, `Content-Type: application/vnd.api+json` | Optional `filter[action]` for GET | `{"data":{"type":"report-actions","attributes":{"action":"screen_user_made_chat_message","data":{"message":"Hello from automation 1"}}}}` | 201 JSON: `data.id`, `attributes.action`, `attributes.data`, timestamps | Action required; message validation; 4xx on missing fields |
| GET | `/api/scr/qjs2y/report-actions?filter[action]=screen_user_faq_answer_read` | On load | `Authorization: Bearer` | `filter[action]` | — | 200 pagination, often empty | Handle empty data; pagination |
| GET | `https://haproxy-prod.pitchavatar.com/screening-chat-messages?scrUserID=<id>&sort=id` | On load and after chat to refresh history | `Authorization: Bearer <token>` | `scrUserID`, `sort` | — | 200 array of chat messages (assistant & user) with ids, text, timestamps | scrUserID scoping; ordering; unread flags |
| POST | `/api/wrapper/v1/voice-recognition/token` | On load (twice observed) | `Authorization: Bearer`, `Content-Type: application/json` | — | `{}` | 200 JSON: `token` (JWT), `region`, `expiresIn` | Expiry handling; 4xx on bad bearer |
| POST | `/api/wrapper/v1/streams/connect` | On load to start media stream | `Authorization: Bearer`, `Content-Type: application/json` | — | `{"service":"clips","presenter_id":"matt-9C51DD6lgH","driver_id":"mBHOFBuOHq","streamWarmup":false,"provider":"microsoft","isCompatibilityMode":false,"compatibility_mode":"off"}` | 201 JSON: `id` (streamId), `offer` (SDP) | Required fields; invalid provider |
| POST | `/api/wrapper/v1/streams/sdp` | After connect to send client answer | Same | — | `{"service":"clips","sessionClientAnswer":{"sdp": "...","type":"answer"}}` | 201 JSON: `session_id` cookie string | SDP format; 4xx on malformed SDP |
| POST | `/api/wrapper/v1/streams/ice` | ICE candidates | Same | — | `{"service":"clips","streamId":"<from connect>","settings":{"candidate": "...","sdpMid":"a","sdpMLineIndex":0,"session_id":"<cookie>"},"provider":"microsoft"}` | 200 JSON: `status":"created"`, `session_id` cookies | Multiple candidates accepted; candidate validation |
| GET | `/api/scr/qjs2y/emotions`, `/languages`, `/triggers`, `/time-no-action-rules`, `/setting` | On load config | `Authorization: Bearer` | — | — | 200 JSON config | Presence; handle missing config |

Key example payloads:
```json
// login request
{"is_iframe": false, "original_source": ""}

// login response (trimmed)
{"data":{"type":"api-token","attributes":{"token":"<Bearer>","user":{"data":{"id":"368448"}}}}}

// chat message action
{"data":{"type":"report-actions","attributes":{"action":"screen_user_made_chat_message","data":{"message":"Hello from automation 1"}}}}
```

# WebSocket Map
## Endpoint A (main chat/control)
- URL: `wss://haproxy-prod.pitchavatar.com/ws?scrUserID=<scrUserID>`
- Opened: after login/parameter setup; reopens after reload with new scrUserID.
- Protocols: none specified.
- Client → Server
| Type | Payload shape | Example | Meaning |
| --- | --- | --- | --- |
| `SetParameterValue` | `{"event_type":"SetParameterValue","parameter_name":string,"value":string/bool,"is_text_input":bool,"traceId":string}` | `{"event_type":"SetParameterValue","parameter_name":"Voice Recognition Status","value":"0","is_text_input":false,"traceId":"Root=1-19ade422e7f-2578ba9e86cb2"}` | Initialize/update runtime parameters |
| `report-actions` | `{"data":{"type":"report-actions","attributes":{"action":string,"data":object}},"traceId":string}` | `{"data":{"type":"report-actions","attributes":{"action":"screen_user_started_screening","data":{}}},"traceId":"Root=1-19ade422e7f-2578ba9e86cb2"}` | Emit behavioral events |
| `screen_user_made_chat_message` | Same envelope with `action":"screen_user_made_chat_message","data":{"message":string}` | `{"data":{"type":"report-actions","attributes":{"action":"screen_user_made_chat_message","data":{"message":"Second message after first"}}},"traceId":"Root=1-19ade422e7f-2578ba9e86cb2"}` | User sends text chat |
- Server → Client
| Type | Payload shape | Example | UX meaning |
| --- | --- | --- | --- |
| `parameter_value_changed` | `{"event_type":"parameter_value_changed","parameter":{"name":string,"type":string,"value":...,"old_value":...,"defined":bool,"updated_at":ts,"inner_type":""}}` | `{"parameter":{"name":"Last Listener chat message","type":"string","value":"Second message after first"}}` | Update local state flags (languages, slide IDs, last chat message, etc.) |
| `assistant_chat_message` | `{"id":uuid,"event_type":"assistant_chat_message","message":string,"instructions":null,"controls":null,"message_count":int,"unread_message_count":int,"action_uuid":"","createdAt":ts}` | Reply: `"message":"Hello again from Automation 1!..."` | Render assistant reply; update counters |
| Broadcast (Socket.IO-style inside same WS) | `42["ReportActionCreatedBroadcast","presence-v1.screening_user.qjs2y.<id>",{data:[{type:"report-actions",...},{type:"screening-chat-messages",...},{type:"data",attributes:{message_count,unread_message_count}}]}]` | Contains both action and chat record mirrors | Presence sync for other listeners |
| Close | Close observed on reload (no code surfaced) | — | Connection ends on reload |

## Endpoint B (presence / translations via Socket.IO)
- URL: `wss://api.pitchavatar.com/socket.io/?EIO=3&transport=websocket&sid=<sid>`
- Opened: on load; additional instance after reload and one for `presence-v1.<uuid>` channel.
- Protocol: Socket.IO EIO=3 (`2probe/3probe/5`, `42[...]`).
- Client → Server frames:
  - `2probe`, `5` (handshake)
  - `42["subscribe",{"channel":"presence-v1.screening_user.qjs2y.<scrUserID>","auth":{"headers":{"Authorization":"Bearer <token>"}}}]`
  - `42["subscribe",{"channel":"presence-v1.screening.qjs2y",...}]`
  - `42["subscribe",{"channel":"presence-v1.<uuid>",...}]`
  - `42["client event",{"channel":"presence-v1.<uuid>","event":"client-updateUser","data":{"id":"<scrUserID>","name":null,"company_name":null}}]`
- Server → Client frames:
| Event | Payload | Meaning |
| --- | --- | --- |
| `presence:subscribed` | `42["presence:subscribed","<channel>",[{user_id,user_info,socketId}]]` | Subscription ack |
| `ScreeningStepTranslated` | `42["ScreeningStepTranslated","<channel>",{"data":[{"type":"data","attributes":{"screening_step":{id,uuid,screening_id,presentation_id,presentation_step_id,position,short_script,...}}}]}]` | Delivers slide/step content |
| `ReportActionCreatedBroadcast` | Same structure with `report-actions` and `screening-chat-messages` entries (user/assistant chat, other actions) plus counters | Presence mirror of actions |
| Keepalive | `2` / `3` ping/pong |

# Key Sequence Flows
1) Start chat session (happy path)
   1. UI load → POST `/api/scr/qjs2y/login` (token + scrUserID).
   2. GET parameters; POST screening-parameters (languages); POST Voice Recognition Status; POST report-actions (`started_screening`, `changed_step`, `turn_off_voice_recognition`); GET config.
   3. WS `socket.io` opens; client subscribes to presence channels.
   4. WS haproxy opens; client sends SetParameterValue + report-actions; server returns `parameter_value_changed`.
   5. REST media setup: streams/connect → streams/sdp → streams/ice.
   6. GET `screening-chat-messages?scrUserID=<id>` for history.

2) User sends a text message
   1. UI enter + Enter → REST POST `/report-actions` with `action":"screen_user_made_chat_message"`, `data.message`.
   2. WS haproxy send same action with traceId.
   3. Server WS responses: `parameter_value_changed` (`Last Listener chat message`, `Listener Has Posted a Chat Message`), `assistant_chat_message` reply; presence WS broadcasts `ReportActionCreatedBroadcast` containing action + `screening-chat-messages` record.
   4. REST GET chat history updates list (assistant + user messages).

3) Voice/audio message (not observed)
   - Only voice-recognition token retrieval and `Voice Recognition Status` set to “0”. No audio chunks or uploads seen. Likely STT over a separate path; needs verification.

4) Page reload / reconnect
   1. Reload → new POST login → new token + new scrUserID.
   2. Old WS closes; new presence and haproxy WS open with new IDs.
   3. Parameters and initial report-actions re-sent.
   4. Chat history uses new scrUserID; previous session messages not reused automatically.

# Test Ideas
## Positive
- Successful session start opens both WS and returns parameters.
- Send text message: REST 201, WS assistant reply, history reflects both.
- Multiple sequential messages preserve order in WS and REST history.
- Presence subscribers receive `ReportActionCreatedBroadcast` for chat.

## Negative
- Missing/invalid `action` in `/report-actions` → 4xx; no WS broadcast.
- WS malformed payload → server ignores/errors without side effects.
- Expired/invalid bearer token → REST 401; presence subscribe fails; WS should not deliver data.
- Invalid `scrUserID` in haproxy WS URL → reject or no updates.

## Edge Cases
- Very long chat message: expect validation/truncation; WS/REST consistency.
- Rapid consecutive messages: ordering preserved; no drops.
- WS drop mid-stream (e.g., close 1001): client reconnect logic should reopen with same token or refresh.
- Reload mid-conversation: new scrUserID; old WS closed; history tied to old ID.
- Voice recognition toggled on (value “1”): expect STT path; confirm events.

# Unknown / To Clarify
- Audio/voice path: where voice is sent (WS vs REST vs WebRTC) and message shapes for audio/chunks/STT results.
- WS close codes and retry policy: not surfaced in capture; needed for reconnection tests.
- Token expiry/refresh: screening bearer and voice-recognition JWT (3600s) refresh flow not observed.
- Validation limits: max chat length, allowed chars, rate limits; needed for negative/edge design.
