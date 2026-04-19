import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } from "msedge-tts";
import { VOICE_OPTIONS } from "@/types";

interface TTSRequestBody {
  text: string;
  voiceName: string;
  speakingRate: number;  // 0.5 – 2.0
  pitch: number;         // -10 to +10 semitones
}

const VALID_VOICE_NAMES = new Set(
  [...VOICE_OPTIONS.MALE, ...VOICE_OPTIONS.FEMALE].map((v) => v.name)
);
const MAX_TEXT_BYTES = 5000;

function rateToSSML(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function pitchToSSML(pitch: number): string {
  return pitch >= 0 ? `+${pitch}st` : `${pitch}st`;
}

/**
 * Escapes XML-special characters so the text is safe to embed in SSML.
 * msedge-tts wraps the input in <prosody> SSML — if the text contains
 * raw &, <, or > the resulting SSML is malformed and Edge TTS silently
 * returns 0 bytes.
 *
 * Also strips C0/C1 control characters (except tab and newline) that can
 * appear in poorly-extracted PDF text and similarly break the SSML.
 */
function sanitizeForSSML(text: string): string {
  return text
    // Strip control characters that break XML (keep tab \x09 and newline \x0A)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ")
    // Escape the five XML special characters
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Collapse any runs of whitespace introduced by the above passes
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * POST /api/tts
 *
 * Synthesises text to MP3 using Microsoft Edge TTS neural voices.
 * Uses the plain-text path (`toStream`) which is the only path the free
 * Edge TTS endpoint reliably supports — SSML elements such as <break> and
 * <emphasis> cause the service to return empty audio silently.
 *
 * @body text         - Text to synthesise (required, ≤ 5 000 bytes).
 * @body voiceName    - Edge TTS neural voice name.
 * @body speakingRate - Speed multiplier, clamped to [0.5, 2.0].
 * @body pitch        - Semitone shift, clamped to [-10, +10].
 *
 * @returns { audioContent: string } — base64-encoded MP3.
 */
export async function POST(req: NextRequest) {
  let body: Partial<TTSRequestBody>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { text, voiceName, speakingRate = 1.0, pitch = 0 } = body;

  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required and must be non-empty" }, { status: 400 });
  }

  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
    return NextResponse.json(
      { error: `text exceeds the ${MAX_TEXT_BYTES}-byte limit` },
      { status: 400 }
    );
  }

  if (!voiceName || !VALID_VOICE_NAMES.has(voiceName)) {
    return NextResponse.json(
      { error: `voiceName must be one of: ${[...VALID_VOICE_NAMES].join(", ")}` },
      { status: 400 }
    );
  }

  const clampedRate  = Math.max(0.5, Math.min(2.0, speakingRate));
  const clampedPitch = Math.max(-10, Math.min(10, pitch));

  // Escape XML-special characters before injecting into SSML.
  // msedge-tts wraps the text in <prosody> — raw & / < / > produce
  // malformed XML and Edge TTS silently returns 0 bytes.
  const safeText = sanitizeForSSML(text);
  if (!safeText) {
    return NextResponse.json({ error: "text is required and must be non-empty" }, { status: 400 });
  }

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

    const prosody = new ProsodyOptions();
    prosody.rate  = rateToSSML(clampedRate);
    prosody.pitch = pitchToSSML(clampedPitch);

    const { audioStream } = tts.toStream(safeText, prosody);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data",  (chunk: Buffer) => chunks.push(chunk));
      audioStream.on("end",   resolve);
      audioStream.on("error", reject);
    });

    const audioContent = Buffer.concat(chunks).toString("base64");

    if (!audioContent) {
      return NextResponse.json(
        { error: "TTS synthesis failed", detail: "Edge TTS returned empty audio" },
        { status: 502 }
      );
    }

    return NextResponse.json({ audioContent });
  } catch (err) {
    console.error("[TTS] Edge TTS error:", err);
    return NextResponse.json(
      { error: "TTS synthesis failed", detail: String(err) },
      { status: 502 }
    );
  }
}
