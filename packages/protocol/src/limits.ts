/**
 * Every numeric limit of the protocol (R20). Values come from docs/architecture.md §6 and §20.
 * Names end with their unit: _BYTES, _CHARS, _MS, _COUNT, _MIN.
 * KB means 1024 bytes (KIB). Schemas reference these constants and never repeat a number.
 *
 * Configurable limits (imageMaxMB, uploadMaxMB, maxSeatsPerBot, uploadKeepDays) are node
 * configuration and are intentionally not exported here (R20.6).
 */

/** One kibibyte; every "KB" limit below is a multiple of it. */
export const KIB = 1024;

// Sizes in bytes.
export const ENVELOPE_MAX_BYTES = 256 * KIB;
export const CONSOLE_FRAME_MAX_BYTES = 64 * KIB;
export const ATTACHMENT_TEXT_MAX_BYTES = 8 * KIB;
export const HANDOFF_ATTACHMENTS_TOTAL_MAX_BYTES = 8 * KIB;
export const BOT_TOOL_OUTPUT_MAX_BYTES = 32 * KIB;
export const BOT_SUMMARY_TEXT_MAX_BYTES = 2 * KIB;
export const BOT_TERMINAL_TURN_TEXT_MAX_BYTES = 32 * KIB;
/** Decoded bytes, not base64 length. */
export const MEDIA_CHUNK_DECODED_MAX_BYTES = 32 * KIB;
export const MEDIA_THUMB_MAX_BYTES = 32 * KIB;
/** Decoded bytes, not base64 length. */
export const VOICE_AUDIO_DECODED_MAX_BYTES = 144 * KIB;
export const FILE_CONTENT_MAX_BYTES = 256 * KIB;
export const DIFF_CONTENT_MAX_BYTES = 256 * KIB;

// Text lengths in characters (Unicode code points).
export const USER_MESSAGE_TEXT_MAX_CHARS = 16_000;
export const VOICE_TEXT_MAX_CHARS = 2000;
export const MEDIA_NAME_MAX_CHARS = 200;
export const MEDIA_CAPTION_MAX_CHARS = 500;
export const WATCH_QUICK_MESSAGE_MAX_CHARS = 140;
export const WATCH_VOICE_TRANSCRIPT_MAX_CHARS = 280;
export const ROSTER_QUICK_MESSAGE_MAX_CHARS = 140;
export const INSTRUCTIONS_MAX_CHARS = 8000;
export const ROOM_NAME_MIN_CHARS = 1;
export const ROOM_NAME_MAX_CHARS = 48;
export const MEMBER_ID_MAX_CHARS = 64;
export const APPROVAL_SUMMARY_MAX_CHARS = 120;
export const AUTOPILOT_ASK_ENTRY_MAX_CHARS = 200;

// Counts.
export const MEDIA_PER_MESSAGE_MAX_COUNT = 4;
export const MENTIONS_PER_MESSAGE_MAX_COUNT = 16;
export const REQUIRES_MAX_COUNT = 8;
export const ROSTER_QUICK_MESSAGES_MAX_COUNT = 8;
export const COMMANDS_PER_BOT_MAX_COUNT = 200;
export const REWIND_POINTS_MAX_COUNT = 100;
export const REWIND_PREVIEW_FILES_MAX_COUNT = 200;
export const TERMINAL_RETURN_TURNS_MAX_COUNT = 50;
export const FS_LISTING_DIRS_MAX_COUNT = 200;
export const AUTOPILOT_ASK_MAX_COUNT = 50;

// Durations.
export const VOICE_DURATION_MAX_MS = 30_000;
export const APPROVAL_TIMEOUT_MIN_MIN = 1;
export const APPROVAL_TIMEOUT_MAX_MIN = 240;
export const TAKE_CONTROL_MAX_MIN = 10;
/** Age window for `console.input` (`now - ts`), 60 seconds expressed in milliseconds. */
export const CONSOLE_INPUT_MAX_AGE_MS = 60_000;
