# API Reference

The application exposes two internal REST API routes. Both are Next.js App Router route handlers and run in the Node.js runtime on Vercel.

These routes are called by the browser-side React app — they are not intended to be public-facing endpoints, but their contracts are documented here for testing and future Live Read integration.

---

## POST /api/tts

Synthesises a text string to MP3 audio using Microsoft Edge TTS.

### Request body

```json
{
  "text": "The quick brown fox jumps over the lazy dog.",
  "voiceName": "en-US-JennyNeural",
  "speakingRate": 1.0,
  "pitch": 0
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | Yes | Text to synthesise. Must be non-empty and ≤ 5 000 UTF-8 bytes. |
| `voiceName` | string | Yes | An Edge TTS neural voice name. Must be one of the values in `VOICE_OPTIONS` (see `types/index.ts`). |
| `speakingRate` | number | No | Speaking speed multiplier. Clamped to [0.5, 2.0]. Default: `1.0`. |
| `pitch` | number | No | Pitch shift in semitones. Clamped to [-10, +10]. Default: `0`. |

### Response — 200 OK

```json
{
  "audioContent": "<base64-encoded MP3 string>"
}
```

Decode `audioContent` from base64 to obtain raw MP3 bytes.

### Error responses

| Status | Condition |
|---|---|
| 400 | `text` is missing, empty, whitespace-only, or exceeds 5 000 bytes |
| 400 | `voiceName` is not in the allowed set |
| 400 | Request body is not valid JSON |
| 502 | Microsoft Edge TTS service returned an error or was unreachable |

### Available voice names

**Female**

| Name | Label |
|---|---|
| `en-US-JennyNeural` | Jenny (Friendly) |
| `en-US-AriaNeural` | Aria (Natural) |
| `en-US-MichelleNeural` | Michelle (Warm) |
| `en-US-MonicaNeural` | Monica (Clear) |

**Male**

| Name | Label |
|---|---|
| `en-US-GuyNeural` | Guy (Neutral) |
| `en-US-DavisNeural` | Davis (Casual) |
| `en-US-EricNeural` | Eric (Warm) |
| `en-US-JasonNeural` | Jason (Deep) |

---

## POST /api/describe-image

Sends a rendered PDF page image to Groq's vision model and returns a natural-language description suitable for text-to-speech.

Used automatically for pages where extracted text is shorter than 80 characters (image-heavy or table-heavy pages).

### Request body

```json
{
  "imageDataUrl": "data:image/jpeg;base64,/9j/4AAQ...",
  "pageNumber": 5
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `imageDataUrl` | string | Yes | A base64-encoded JPEG data URL (e.g. from `canvas.toDataURL("image/jpeg", 0.8)`). Must start with `data:image/`. Maximum size: ~4 MB decoded (~5.3 MB as base64). |
| `pageNumber` | number | No | 1-based page number. Used in the prompt so the description says "On page N:". Defaults to `1` if omitted or invalid. |

### Response — 200 OK

```json
{
  "description": "On page 5: a bar chart showing annual revenue from 2018 to 2023. The values are: 2018, 1.2 million. 2019, 1.5 million. 2020, 0.9 million due to the pandemic..."
}
```

The description is written to be audio-friendly — complete sentences, no markdown, no bullet points.

### Error responses

| Status | Condition |
|---|---|
| 400 | `imageDataUrl` is missing |
| 400 | `imageDataUrl` does not start with `data:image/` |
| 400 | Request body is not valid JSON |
| 413 | Image payload exceeds ~4 MB |
| 500 | `GROQ_API_KEY` environment variable is not set |
| 502 | Groq API returned an error or was unreachable |

### Vision model

Currently uses `meta-llama/llama-4-scout-17b-16e-instruct` via Groq. This is a multimodal model that can read text, tables, charts, and figures from images.

To change the model, update the `VISION_MODEL` constant in `app/api/describe-image/route.ts`.
