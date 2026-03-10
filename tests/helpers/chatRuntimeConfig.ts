// Centralized non-secret defaults. These values are shared across environments
// and kept out of .env files so envs only store URLs, credentials, and user count.
export const UI_ASSIST_TIMEOUT_MS = 60_000;
export const WS_ASSIST_TIMEOUT_MS = 45_000;

export const AUDIO_TIMEOUT_MS = UI_ASSIST_TIMEOUT_MS;
export const AUDIO_MIN_BYTES = 1;
export const AUDIO_MIN_PACKETS = 1;
export const AUDIO_GROWTH_WAIT_MS = 3_000;
export const AUDIO_PLAYBACK_WAIT_MS = 5_000;
export const AUDIO_SYNC_POLL_MS = 500;
export const AUDIO_RECORD_MAX_MS = 120_000;
export const AUDIO_RECORD_SILENCE_MS = 2_000;
export const AUDIO_RECORD_WAIT_MS = 15_000;
export const AUDIO_RECORD_POLL_MS = 250;
export const AUDIO_RECORD_MIME = 'audio/webm;codecs=opus';
export const AUDIO_ENERGY_WAIT_MS = 5_000;
export const AUDIO_ENERGY_POLL_MS = 250;
export const AUDIO_LEVEL_THRESHOLD = 0.02;
export const AUDIO_ENERGY_DELTA = 0.001;

export const CMS_AVATAR_LANGUAGE_ID = 'en';
export const CMS_AVATAR_PROMPT = 'test';
export const CMS_AVATAR_ROLE_NAME = 'Test_avatar_creation_role';
export const CMS_AVATAR_READY_TIMEOUT_MS = 60_000;
export const CMS_VIDEO_AVATAR_READY_TIMEOUT_MS = 180_000;
export const CMS_AVATAR_READY_POLL_MS = 2_000;
export const CMS_PRESENTATION_READY_TIMEOUT_MS = 180_000;
export const CMS_PRESENTATION_READY_POLL_MS = 3_000;

export const RUN_ID = `${Date.now()}`;
export const LOG_RUN_ID = RUN_ID;
