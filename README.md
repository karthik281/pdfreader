# PDF to Audio

Convert any text-based PDF to a downloadable MP3, or listen section by section with real-time Q&A and voice commands.

## Features

- **Generate MP3** — pre-generate the entire PDF as a single downloadable MP3
- **Live Read** — listen section by section with transport controls, chat Q&A, and voice commands
- **AI image descriptions** — image-heavy pages are sent to a vision model and described in audio
- **Voice input** — dictate questions or control playback with spoken words
- **Web search** — optional live web search via Groq compound-beta to supplement document context
- Client-side PDF parsing — your file is never uploaded to a server

## Prerequisites

| Requirement | Details |
|---|---|
| Node.js | v20 or later |
| Groq API key | Free at [console.groq.com](https://console.groq.com) — used for chat, STT, and image description |

Microsoft Edge TTS (used for audio synthesis) requires no API key.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Add your Groq key
echo "GROQ_API_KEY=gsk_..." > .env.local

# 3. Run locally
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

```env
GROQ_API_KEY=gsk_...   # Required — used for chat, speech-to-text, and image description
```

## Usage

### Generate MP3

1. Click **Upload PDF** and choose a PDF file.
2. Adjust the voice (gender, style, speaking rate, pitch) in the Voice panel.
3. Click **Generate MP3**.
4. A progress bar tracks synthesis across all sections.
5. When complete, use the built-in player or click **Download** to save the MP3.

### Live Read

1. Upload a PDF as above.
2. Click **Live Read** instead of Generate MP3.
3. Click **Start Reading** — the first section loads and begins playing automatically.

#### Playback controls

| Control | Action |
|---|---|
| Play / Pause | Resume or pause the current section |
| ⏮ Prev | Jump to the previous section |
| ⏭ Next | Jump to the next section |
| Section dropdown | Jump to any section directly |

Sections advance automatically when one finishes.

#### Chat Q&A

Type a question in the chat box and press **Enter** or click **Send**.
The assistant answers based on the document text. Enable **Web search** to allow the model to fetch live web results as well.

#### Voice commands

Click the **microphone** button, speak, then click again to stop.

| Say | Action |
|---|---|
| "pause" or "stop" | Pause playback |
| "play", "resume", or "continue" | Resume playback |
| "next", "skip", or "forward" | Next section |
| "back", "previous", or "rewind" | Previous section |
| Anything else | Sent as a chat question |

## Development

```bash
npm run dev          # Turbopack dev server on :3000
npm run build        # Production build
npm test             # Jest test suite
npm run test:coverage # Tests with coverage report
npm run lint         # ESLint
```

## Project structure

```
pdfreader/
├── app/
│   ├── page.tsx                    # Main UI — mode switching, generate flow
│   ├── layout.tsx                  # Root layout and metadata
│   └── api/
│       ├── tts/route.ts            # POST /api/tts — Edge TTS synthesis
│       ├── chat/route.ts           # POST /api/chat — streaming LLM chat
│       ├── stt/route.ts            # POST /api/stt — Groq Whisper transcription
│       └── describe-image/route.ts # POST /api/describe-image — vision model
├── components/
│   ├── PDFUploader.tsx             # Drag-and-drop upload widget
│   ├── VoiceSelector.tsx           # Voice / speed / pitch controls
│   ├── AudioPanel.tsx              # Web Audio API player for generated MP3
│   └── LiveReader.tsx              # Full Live Read mode with chat + voice
├── lib/
│   ├── pdf-parser.ts               # pdfjs-dist extraction + chapter detection
│   └── audio.ts                    # Text chunking + MP3 blob merging
├── types/index.ts                  # Shared TypeScript types
├── public/pdf.worker.min.mjs       # Bundled pdfjs worker
├── __tests__/                      # Jest test suites
└── docs/TECHNICAL.md               # Architecture and API reference
```

## Supported PDFs

Only PDFs with **selectable text** are supported. Scanned PDFs (images of pages) will not produce readable output. Pages with fewer than 80 extracted characters are automatically sent to Groq's vision model for an audio-friendly description.

## Deploying to Vercel

```bash
# Push to GitHub, then import the repo at vercel.com/new
# Add GROQ_API_KEY in Project Settings → Environment Variables
```

Vercel auto-detects Next.js — no build configuration needed.

## Architecture overview

See [docs/TECHNICAL.md](docs/TECHNICAL.md) for the full technical design document.
