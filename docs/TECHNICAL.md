# Technical Design — PDF to Audio

This document describes the architecture, data flows, and key design decisions for the
PDF to Audio application.

---

## System overview

```
Browser                              Vercel Edge / Node.js
─────────────────────────────────    ──────────────────────────────────────────
PDF file (stays in browser)
    │
    ▼
pdfjs-dist (WASM worker)             POST /api/describe-image
  extract text per page  ──────────►   Groq Vision (llama-4-scout)
  render image pages ───────────────►  returns spoken description
    │
    ▼ (text assembled per section)
chunkText() — ≤4,800-byte chunks     POST /api/tts
    │──────────────────────────────►  msedge-tts → Microsoft Edge Neural TTS
    │                                 returns base64 MP3 chunk
    ▼
mergeMP3sToBlob() — join all chunks
    │
    ├── Generate MP3 mode:
    │     Blob URL → AudioPanel (Web Audio API) + <a download>
    │
    └── Live Read mode:
          AudioContext.decodeAudioData() → AudioBufferSourceNode.start()
          Chat Q&A: POST /api/chat → Groq LLaMA (SSE stream)
          Voice input: MediaRecorder → POST /api/stt → Groq Whisper
```

### Core principle: PDF data never leaves the browser

`pdfjs-dist` runs entirely client-side in a Web Worker. Raw PDF bytes are never sent
to the server. Only the following leave the browser:
- JPEG canvas snapshots of image-heavy pages → `/api/describe-image`
- Extracted text chunks → `/api/tts`
- Document context excerpt (first 12,000 chars) → `/api/chat`
- Recorded audio blobs → `/api/stt`

---

## Module reference

### `lib/pdf-parser.ts` (client-only)

| Export | Purpose |
|---|---|
| `parsePDF(file, onProgress)` | Load a PDF file, extract per-page text and optional image snapshots |
| `detectChapters(pages)` | Identify chapter headings; fall back to page groups |
| `makeChapter(title, start, end, pages)` | Build a `Chapter` from a page range |
| `groupByPages(pages, groupSize)` | Fixed-size page grouping fallback |
| `looksLikeHeading(line)` | Test a single line against chapter heading patterns |

**Chapter detection algorithm:**

```
For each page, inspect the first 6 lines only:
  If a line matches any CHAPTER_PATTERN → close previous chapter, open new one

CHAPTER_PATTERNS (first match wins):
  1. /^(chapter|part|section|unit)\s+(\d+|roman|word-number)/i
  2. /^(\d+)\.\s+[A-Z].{2,60}$/        — "1. Introduction"
  3. /^[A-Z][A-Z\s]{4,50}$/            — ALL-CAPS SHORT LINES

Fallback (either condition triggers groupByPages):
  - No headings found at all
  - Exactly one heading found (entire document is one section)

Fallback groups: every DEFAULT_GROUP_SIZE (10) pages → "Section N (pages X–Y)"
```

### `lib/audio.ts` (shared client + server)

| Export | Purpose |
|---|---|
| `chunkText(text, maxBytes)` | Split at sentence, then word boundaries into ≤4,800 byte pieces |
| `mergeMP3sToBlob(b64chunks)` | Decode base64 MP3 fragments, concatenate bytes, return `blob:` URL |

**Why MP3 concatenation works:** MP3 is a frame-based format. Adjacent frames play
independently. Byte-concatenating valid frames produces a valid MP3 stream without
re-encoding.

### `app/api/tts/route.ts`

- **Input:** `{ text, voiceName, speakingRate, pitch }`
- **Output:** `{ audioContent: string }` (base64 MP3)
- Validates `voiceName` against `VOICE_OPTIONS` constant
- Clamps `speakingRate` to `[0.5, 2.0]` and `pitch` to `[-10, 10]`
- Uses `msedge-tts` `toStream()` — always plain text, never SSML `rawToStream()`
- Returns 502 if Edge TTS returns empty audio (rare; indicates upstream service issue)

**Why `toStream()` not `rawToStream()`:** Empirical testing showed that `rawToStream()`
with SSML containing `<break>` or `<emphasis>` elements causes Edge TTS to silently
return 0 bytes. `toStream()` with plain text + `prosody` wrapper is always reliable.

### `app/api/chat/route.ts`

- **Input:** `{ message, documentContext, history, webSearch? }`
- **Output:** `text/event-stream` — `data: {"content":"..."}` per token, `data: [DONE]`
- Model: `llama-3.3-70b-versatile` (default) or `compound-beta` (when `webSearch: true`)
- `documentContext` is truncated to `MAX_CONTEXT_CHARS` (12,000) before injection
- History capped at `MAX_HISTORY_TURNS` (10) most recent messages
- Stream errors are forwarded as `data: {"error":"..."}` events (not HTTP 5xx)
- `groq.chat.completions.create()` itself throwing returns HTTP 502

### `app/api/stt/route.ts`

- **Input:** raw audio bytes in request body; `Content-Type: audio/*`
- **Output:** `{ text: string }`
- Rejects non-`audio/*` MIME types (400) and empty bodies (400)
- Enforces 25 MB maximum (Whisper API limit) — returns 400
- Derives filename extension from MIME type (e.g. `audio/mp4` → `recording.mp4`)
- Model: `whisper-large-v3-turbo`
- Returns 502 on Whisper errors

### `app/api/describe-image/route.ts`

- **Input:** `{ imageDataUrl: string, pageNumber: number }`
- **Output:** `{ description: string }`
- Validates `data:image/` prefix; enforces ~4 MB cap on the data URL
- Model: `meta-llama/llama-4-scout-17b-16e-instruct` (vision)
- Prompt instructs the model to describe the page for a listener, not a reader

---

## Component reference

### `AudioPanel.tsx`

Player for the pre-generated MP3 (Generate MP3 mode).

**Web Audio API pipeline:**
```
audioUrl (blob:)
  → fetch() → ArrayBuffer
  → AudioContext.decodeAudioData() → AudioBuffer
  → AudioBufferSourceNode.start(offset)
  → requestAnimationFrame loop → currentTime state
```

Key design decisions:
- `decodeAudioData` replaces `HTMLMediaElement` to eliminate "no supported sources" errors
- `durationRef` mirrors `duration` state so the rAF callback reads it without stale closure
- Decode error surfaces as an inline actionable message, not a thrown exception
- Cleanup effect closes `AudioContext` and cancels rAF on URL change or unmount

States: `decoding` → `ready` → `playing | paused | stopped`

### `LiveReader.tsx`

Full-screen Live Read experience: section-by-section playback + chat + voice.

**State machine (useReducer):**

```
idle ──[Start Reading]──► loading ──[LOADED]──► playing
                              ▲                    │
                              │      [PAUSED]◄─────┤
                              │      [PLAYING]─────┤
                              │                    │
                    [START_LOAD next] ◄──[SECTION_END + onended]
                              │
                           [DONE] ──► done
                           [ERROR] ──► error ──[retry]──► loading
```

**Section load sequence (`loadSection`):**
1. Get text for the section from `allPages` filtered by chapter page range
2. `chunkText()` → array of text chunks
3. For each chunk: `POST /api/tts` → collect `audioContent` (base64)
4. `mergeMP3sToBlob()` → `blob:` URL
5. `fetch(blobUrl)` → `ArrayBuffer` → `URL.revokeObjectURL(blobUrl)`
6. `AudioContext.decodeAudioData(ab)` → `AudioBuffer`
7. `playBuffer()` — creates a fresh `AudioBufferSourceNode`, starts playback

**Auto-advance:** `src.onended` checks `naturalEndRef.current` (true = natural end,
false = manual stop). On natural end it dispatches `SECTION_END` then
`START_LOAD(next)`, which triggers the `useEffect([sectionIdx, playState])` to call
`loadSection` again.

**Stale closure prevention:** `sectionIdxRef.current` is assigned on every render so
that `onended` reads the latest index without capturing a stale closure.

**Voice pipeline:**
```
MediaRecorder.start()
  → ondataavailable → push Blob chunk
  → onstop → merge chunks → POST /api/stt
  → parseVoiceCommand(text)
      → "pause/stop"   → handlePause()
      → "play/resume"  → handlePlay()
      → "next/skip"    → handleNext()
      → "back/previous"→ handlePrev()
      → anything else  → sendMessage(text)
```

**Chat SSE consumption:**
```
fetch /api/chat → ReadableStream
  → TextDecoder (streaming)
  → split on "\n"
  → parse "data: {...}" lines
  → append content to last message in state
  → render progressively
```

---

## Data flow diagrams

### Generate MP3 mode

```
User clicks "Generate MP3"
    │
    ▼
for each chapter:
  for each page in chapter:
    if hasImages → POST /api/describe-image → append description
    else          → append page.text
  chunkText(sectionText) → chunks[]
  for each chunk:
    POST /api/tts → base64 MP3
    push to allAudioChunks[]
mergeMP3sToBlob(allAudioChunks) → blob: URL
AudioPanel receives audioUrl → decodes → plays / downloads
```

### Live Read mode

```
User clicks "Start Reading"
    │
    dispatch START_LOAD(sectionIdx=0)
    │
    ▼
loadSection(0):
  getSectionText(0) → string
  chunkText() → chunks[]
  for chunk: POST /api/tts → b64
  mergeMP3sToBlob() → blobUrl
  fetch(blobUrl) → ArrayBuffer
  revokeObjectURL(blobUrl)
  decodeAudioData(ab) → AudioBuffer
  playBuffer() → AudioBufferSourceNode.start()
    │
    ▼
rAF loop: currentTime updates every frame
    │
    ▼
src.onended (natural):
  dispatch SECTION_END
  dispatch START_LOAD(sectionIdx+1)
  → loadSection(1) ...
```

---

## Audio subsystem: HTMLMediaElement vs Web Audio API

The app originally used `<audio>` + `HTMLMediaElement`. This produced persistent
"NotSupportedError: The element has no supported sources" errors in Next.js
development mode because the blob URL was sometimes read before the source was
attached to the element.

The replacement uses `AudioContext.decodeAudioData()`:
- No `src` attribute / no timing race
- Throws a typed `DOMException` if audio is corrupt — surfaced as a readable error
- Same API works in jsdom (with mocking) and production browsers
- Enables seek-from-offset without re-downloading the audio

---

## Testing strategy

Tests live in `__tests__/` and use Jest + React Testing Library.

| Area | File | Coverage target |
|---|---|---|
| PDF chapter detection | `__tests__/lib/pdf-parser.test.ts` | All exported functions, all fallback branches |
| Text chunking + MP3 merge | `__tests__/lib/audio.test.ts` | Boundary, multibyte, empty inputs |
| TTS API route | `__tests__/api/tts.test.ts` | Valid, missing key, Edge TTS error, empty audio |
| Chat API route | `__tests__/api/chat.test.ts` | SSE stream, models, history, truncation, errors |
| STT API route | `__tests__/api/stt.test.ts` | Valid, non-audio, empty, 25 MB limit, model |
| Image description API | `__tests__/api/describe-image.test.ts` | Valid, invalid prefix, size limit |
| AudioPanel component | `__tests__/components/AudioPanel.test.tsx` | All states: idle, processing, ready, decode error, play/pause/stop/seek |
| LiveReader component | `__tests__/components/LiveReader.test.tsx` | Render, chat, web search, section loading, auto-advance |
| VoiceSelector component | `__tests__/components/VoiceSelector.test.tsx` | Voice selection, sliders |

Web Audio API is mocked via a `MockAudioContext` class that exposes `jest.fn()`
methods for `createBufferSource`, `decodeAudioData`, `resume`, and `close`.
`MediaRecorder` is mocked similarly for STT/voice tests.

Run the full suite with coverage:

```bash
npm run test:coverage
```

---

## Deployment

The app is a standard Next.js application and deploys to Vercel with zero
configuration. The only environment variable required is `GROQ_API_KEY`.

The `public/pdf.worker.min.mjs` file is committed to the repository and served as a
static asset. This ensures the pdfjs worker version always matches the installed
`pdfjs-dist` package. After upgrading `pdfjs-dist`, copy the new worker:

```bash
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs
```
