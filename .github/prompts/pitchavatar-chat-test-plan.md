# PitchAvatar Slides - Chat Functionality Test Plan

## Executive Summary

This test plan covers the interactive presentation page at https://slides.pitchavatar.com/uyqlp. The primary focus is to verify that the player loads completely, the chat with the avatar becomes available, and the chat interface works as expected. The plan includes happy path, edge cases, and error handling scenarios.

---

## 1. Player Load and Chat Availability

**Assumptions:**  
- Start from a fresh browser session (no cookies or local storage).
- Network is stable.

### 1.1 Wait for Player to Load

**Steps:**
1. Navigate to https://slides.pitchavatar.com/uyqlp.
2. Wait for the main player interface to appear (e.g., video controls, slide area).
3. Wait until the chat input box labeled "Send a message" is visible and enabled.

**Expected Results:**
- The player UI is fully rendered.
- The chat input is visible and ready for interaction.

---

## 2. Chat Interface - Basic Functionality

### 2.1 Send a Message and Receive a Response

**Steps:**
1. Type "Hello, avatar!" into the "Send a message" textbox.
2. Click the send button (paper plane icon).
3. Wait for the message to appear in the chat history.
4. Wait for a response from the avatar to appear in the chat.

**Expected Results:**
- The sent message appears in the chat.
- The avatar responds with a message.

### 2.2 Send an Empty Message

**Steps:**
1. Attempt to send an empty message (leave the textbox blank and click send).

**Expected Results:**
- The message is not sent.
- An error or validation message appears, or the send button is disabled.

### 2.3 Send a Long Message

**Steps:**
1. Type a message with 500+ characters.
2. Click send.

**Expected Results:**
- The message is sent or a validation error is shown if there is a length limit.
- The chat UI handles long messages gracefully (no overflow or layout breakage).

---

## 3. Chat UI and Accessibility

### 3.1 Keyboard Navigation

**Steps:**
1. Focus the chat input using the Tab key.
2. Type a message and press Enter to send.

**Expected Results:**
- The message is sent using the keyboard.
- The chat remains accessible via keyboard navigation.

### 3.2 Screen Reader Labels

**Steps:**
1. Inspect the chat input and send button for accessible labels (aria-label, role, etc.).

**Expected Results:**
- All interactive elements are properly labeled for screen readers.

---

## 4. Error Handling

### 4.1 Network Failure During Message Send

**Steps:**
1. Disable network after typing a message but before sending.
2. Attempt to send the message.

**Expected Results:**
- An error message is shown.
- The message is not lost and can be retried.

---

## 5. Edge Cases

### 5.1 Rapid Message Sending

**Steps:**
1. Send multiple messages in quick succession.

**Expected Results:**
- All messages are sent and responses are received in order.
- The UI does not freeze or break.

### 5.2 Special Characters and Emojis

**Steps:**
1. Send a message containing special characters and emojis.

**Expected Results:**
- The message is displayed correctly in the chat.

---

## 6. Additional UI Elements

### 6.1 Avatar Greeting

**Steps:**
1. Observe the initial greeting from the avatar when the chat loads.

**Expected Results:**
- The avatar greets the user with a welcome message.

### 6.2 Slide Navigation

**Steps:**
1. Use the slide navigation controls (next/previous).
2. Verify chat remains functional after slide changes.

**Expected Results:**
- Chat is persistent and functional across slide navigation.
