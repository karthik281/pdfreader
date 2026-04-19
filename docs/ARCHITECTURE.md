# Architecture

This document describes how PDF to Audio is designed, the key decisions made, and the planned evolution toward Live Read mode.

---

## System overview

```
Browser                          Vercel Edge / Node.js
──────────────────────────────   ──────────────────────────────────────
PDF file (stays in browser)
    │
    ▼
pdfjs-dist (WASM worker)         POST /api/describe-image
  extract text per page   ──────►   Groq Vision (llama-4-scout)
  render image pages ────────────►  returns spoken description
    │
    ▼ (text assembled)
chunk into ≤4 800-byte blocks
    │
    ▼ for each chunk             POST /api/tts
    ├──────────────────────────► Microsoft Edge TTS (free)
    │                              returns base64 MP3
    ▼
merge MP3 chunks in browser
    │
    ▼
Blob URL → <a download> → .mp3
```

### Key principle: PDF data never leaves the browser

`pdfjs-dist` runs entirely client-side via a Web Worker. The raw PDF bytes are never sent to the server. Only:
- Rendered JPEG snapshots of image-heavy pages go to `/api/describe-image`
- Extracted text chunks go to `/api/tts`

This keeps the architecture simple, avoids storage costs, and means there is no file size limit imposed by Next.js upload constraints.

---

## Module breakdown

### `lib/pdf-parser.ts` (client-only)

Responsibilities:
- Dynamically imports `pdfjs-dist` to avoid SSR errors (`DOMMatrix` is not defined in Node.js)
- Caches the pdfjs instance so the worker initialises only once per page load
- Serves the worker from `/public/pdf.worker.min.mjs` — avoids CDN version-mismatch failures
- Extracts text using `page.getTextContent()` with item-level type narrowing (`"str" in item`)
- Detects image-heavy pages (< 80 extracted chars) and renders them to JPEG canvas snapshots
- Detects chapter headings using regex patterns, falls back to 10-page grouping

**Why client-side parsing?**
Server-side PDF parsing (e.g. via a multipart form upload) would require temporary storage, has file size limits on Vercel's free tier (4.5 MB), and introduces latency. Running pdfjs in the browser eliminates all three concerns.

### `lib/audio.ts` (client-only)

Responsibilities:
- `chunkText`: splits text at sentence boundaries, then word boundaries, into ≤4 800-byte pieces. Uses `Buffer.byteLength` in Node.js (tests) and `Blob.size` in the browser — same result, different API.
- `mergeMP3sToBlob`: concatenates base64-decoded MP3 frames into a single `Blob` and returns a `blob:` URL. MP3 is a frame-based format; concatenation produces a valid file without re-encoding.

### `app/api/tts/route.ts` (server — Node.js runtime)

- Receives `{ text, voiceName, speakingRate, pitch }`
- Validates voice name against the `VOICE_OPTIONS` constant (single source of truth)
- Clamps rate and pitch to safe ranges before passing to Edge TTS
- Uses `msedge-tts` which opens a WebSocket to Microsoft's service and streams audio frames back
- Returns `{ audioContent: string }` (base64 MP3)

**Why a server route and not a direct browser call?**
The `msedge-tts` package uses Node.js streams and `ws`. It cannot run in a browser. A thin proxy route is the cleanest solution.

### `app/api/describe-image/route.ts` (server — Node.js runtime)

- Receives `{ imageDataUrl, pageNumber }` where `imageDataUrl` is a JPEG data URL
- Validates the data URL prefix and enforces a ~4 MB size cap
- Calls Groq's vision model (`llama-4-scout-17b-16e-instruct`) with a prompt that instructs it to describe the page in audio-friendly language
- Returns `{ description: string }`

### `components/`

| Component | Responsibility |
|---|---|
| `PDFUploader` | Drag-and-drop + click-to-browse; validates `.pdf` MIME type; shows selected file |
| `VoiceSelector` | Gender toggle + voice dropdown + speed/pitch sliders; resets voice when gender changes |
| `ChapterList` | Renders chapter rows with per-row progress bars, status icons, generate/retry/download buttons |

### `app/page.tsx`

Orchestrates the full workflow:

1. `handleFile` → calls `parsePDF` + `detectChapters`, stores results in state
2. `generateChapter` → image description → text chunking → TTS → MP3 merge
3. `handleGenerateAll` → iterates idle/errored chapters sequentially using `processingRef` to prevent double-triggering
4. Uses `chaptersRef` (a ref mirror of `chapters` state) to read current chapter status inside async callbacks without stale closures

**Error handling:** Errors surface as a dismissible inline banner (no `alert()`). Each chapter also has its own error state with a Retry button.

---

## Chapter detection algorithm

```
For each page (inspect first 6 lines only):
  If a line matches CHAPTER_PATTERNS → close previous chapter, start new one

CHAPTER_PATTERNS (in priority order):
  1. /^(chapter|part|section|unit)\s+(\d+|roman|word-number)/i
  2. /^(\d+)\.\s+[A-Z].{2,60}$/          — "1. Introduction"
  3. /^[A-Z][A-Z\s]{4,50}$/              — ALL-CAPS SHORT LINES

Fallback conditions (either triggers groupByPages):
  - No headings found at all
  - Only one heading found (entire doc is one chapter)

Fallback: group every 10 pages into a "Section N (pages X–Y)"
```

The algorithm is conservative — it only looks at the first 6 lines of each page to avoid false positives from body text that happens to match.

---

## Voice options

Both the frontend (`VoiceSelector`) and the backend (`/api/tts` validation) import from `types/index.ts`:

```typescript
export const VOICE_OPTIONS = {
  MALE:   [GuyNeural, DavisNeural, EricNeural, JasonNeural],
  FEMALE: [JennyNeural, AriaNeural, MichelleNeural, MonicaNeural],
};
```

`VOICE_OPTIONS` is the single source of truth. The API validates the submitted voice name against this set, so adding a new voice only requires editing one file.

---

## Deployment (Vercel)

No special configuration is needed. Vercel detects Next.js automatically. The only required environment variable is `GROQ_API_KEY`.

The `public/pdf.worker.min.mjs` file is committed to the repository and served as a static asset — this ensures the pdfjs worker version always matches the installed `pdfjs-dist` package, regardless of what CDN versions are available.

To keep the worker in sync after a `pdfjs-dist` upgrade:

```bash
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs
git add public/pdf.worker.min.mjs
```

---

## Planned: Mode 2 — Live Read

Live Read streams audio to the browser in real time and accepts voice or typed commands.

### Proposed additions

| Addition | Technology |
|---|---|
| Streaming TTS | Server-Sent Events or WebSocket; Edge TTS stream piped directly to browser |
| Voice commands | `MediaRecorder` API → send audio chunk → `POST /api/stt` → Groq Whisper |
| NLP command parsing | Groq LLaMA — classify intent (navigate / explain / research) from transcript |
| Web research | Groq `compound-beta` model — has built-in web search, no extra API key |
| Playback state | React context storing current paragraph index + audio position |

### Command examples

| User says / types | Action |
|---|---|
| "Go back 10 seconds" | Seek audio position back 10 s |
| "Previous paragraph" | Re-synthesise and play the prior paragraph |
| "What does this mean?" | Send surrounding paragraph to Groq LLaMA for explanation |
| "Research quantum entanglement" | Groq compound-beta search → summarise → speak result |

### Why Groq for everything in Live Read?

Groq provides LLM inference, Whisper (STT), vision, and compound-beta (web search) all under one API key with low latency. This keeps the dependency footprint minimal — one key, one SDK, one billing relationship.
