# Gemini Voice Lab

A local HTML testing console for `gemini-3.8-live-extended-thinking` and `gemini-3.1-flash-live-preview`, built with Google's native `@google/genai` JavaScript SDK (2.32.0).

## Run

Requires Node.js 22 or later.

```sh
npm ci
npm start
```

Open http://localhost:8787 in Chrome, Edge, or another browser with AudioWorklet and microphone support. The app must be served over localhost or HTTPS; opening index.html as a file will not work.

1. Paste a Gemini API key in the page, or copy `.env.example` to `.env` and set `GEMINI_API_KEY` there.
2. Choose the model, thinking level, voice, and system instruction.
3. Click **Start session**.
4. Click **Turn mic on** and allow microphone access, or type a message.
5. Use **Export session** to download the entire transcript, API thought summaries, and sanitized event log as JSON.

Use a key with access to the requested model and any required billing enabled. The app never silently substitutes a different model. Do not paste credentials into chat.

## Compare 3.1 and 3.8 thought summaries

1. Select **Gemini 3.1 Flash Live**, leave thinking at **High**, and start a fresh session.
2. Click **Use comparison prompt** and send the loaded text. Wait for the completed answer, then end the session.
3. Select **Gemini 3.8 Extended Thinking** and start a fresh session with the same thinking level, voice, and system instruction. Enter your key again if it is not configured on the local server.
4. Load and send the same comparison prompt. Wait for the interaction to finish before ending the session.
5. Compare the run table and export the results. Repeat a few times because summary emission can vary. Text input removes microphone/transcription differences from this comparison.

Both models request `thinkingConfig: { thinkingLevel: 'high', includeThoughts: true }` by default and use the same native SDK transport and thought-part decoder. The common Low/Medium/High settings deliberately exclude Minimal for a matched comparison; 3.8 does not support Minimal.

The table records summary chunks, summary characters, completed utterances, and connection state per run. Exports include each run's exact model and configuration, transcript and event attribution, usage metadata when supplied, and counts of thought-marked parts, opaque signature parts, ordinary text parts, and audio parts. Thought signatures are not readable summaries. The visible summary counter resets for each run; prior transcripts and runs remain available for comparison.

A completed 3.1 run with summaries and a completed 3.8 run without summaries under matched settings is useful evidence of different API behavior. It does not alone establish a 3.8 bug or absence of internal reasoning. Check the exported server events to distinguish an absent summary from an error or incomplete run. Live behavior still requires testing with your authorized key.

## What is shown

- Conversation: streaming input and output audio transcriptions, plus messages typed by the user. Transcripts are the text returned by the API and may differ from exactly what was heard, particularly during interruptions.
- Thought summaries: every text part marked `thought: true` returned by the Live API. This is Google's exposed summary, not a full internal chain of thought. No summary is fabricated when the API emits none.
- Reasoning state: for 3.8, `interactionStatus` tracks `IN_PROGRESS` and `IDLE`; `turnComplete` only closes an utterance. For 3.1, `turnComplete` returns to idle unless the event supplies an explicit interaction status.
- Event log: the latest 80 sanitized events are visible; all session events are retained in memory and included in the export. Audio payloads and opaque thought signatures are omitted.

The setup requests:

```js
thinkingConfig: { thinkingLevel: 'high', includeThoughts: true },
responseModalities: ['AUDIO'],
inputAudioTranscription: {},
outputAudioTranscription: {}
```

## Implementation

- `server.mjs`: localhost-only HTTP server; uses `GoogleGenAI.authTokens.create` to issue a one-use, 30-minute token constrained to the model and session configuration. The token has a one-minute window to start the session. Uses the `v1beta` API documented by Google's current ephemeral-token guide.
- `public/app.js`: native SDK `ai.live.connect`, `sendRealtimeInput`, full event processing, transcript assembly, export, connection lifecycle, error display.
- `public/audio.js` and `public/pcm-worklet.js`: microphone capture via AudioWorklet, 16-bit little-endian mono PCM, explicit sample rate, streamed playback, immediate queue cancellation on interruption. Mic-off sends `audioStreamEnd`.
- `public/protocol.js`: configuration validation, event decoding, export sanitization.
- `build.mjs`: bundles the native SDK and its browser dependencies with esbuild. Runs automatically before `npm start`.

API keys are never written to storage or logs by the app. A key entered in the page is sent only to the local server for token creation, then cleared from the field. The browser uses the temporary token to send microphone audio and text directly to Google. Conversation data remains in browser memory until export; a page reload clears it.

This is a local test environment. It has no user accounts or public hosting. The server accepts only same-origin token requests and listens on loopback. No tool functions are configured. Session reconnection/resumption is not automatic: a disconnect or GoAway requires starting a new session, with a fresh model context; the displayed transcript remains available. Google responses and any model-access errors require a real API key to verify.

## Validation

```sh
npm test
npm run build
```

Tests cover mixed thought/audio/transcription events, model-specific completion handling, matching summary configurations for both models, unsupported-model rejection, thought/signature separation, interruption ordering, transcription completion, valid thinking configuration, and sanitized exports. No authenticated Gemini or microphone round trip was performed during creation.

## Official references

- [Model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking)
- [Gemini 3.1 Flash Live model](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview)
- [Live API capabilities and thought summaries](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Thinking and interaction status](https://ai.google.dev/gemini-api/docs/live-api/thinking)
- [Ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens)
