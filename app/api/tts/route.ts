import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } from "msedge-tts";
import Groq from "groq-sdk";
import { VOICE_OPTIONS } from "@/types";
import { buildSSMLPrompt, sanitiseSSML } from "@/lib/ssml";

interface TTSRequestBody {
  text: string;
  voiceName: string;
  speakingRate: number;      // 0.5 – 2.0
  pitch: number;             // -10 to +10 semitones
  documentContext?: string;  // from /api/analyse-document; enables SSML enhancement
}

const VALID_VOICE_NAMES = new Set(
  [...VOICE_OPTIONS.MALE, ...VOICE_OPTIONS.FEMALE].map((v) => v.name)
);
const MAX_TEXT_BYTES = 5000;
const SSML_MODEL = "llama-3.3-70b-versatile";

function rateToSSML(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function pitchToSSML(pitch: number): string {
  return pitch >= 0 ? `+${pitch}st` : `${pitch}st`;
}

/**
 * Calls Groq to convert plain text to an SSML fragment with intonation markup.
 * Returns `null` on failure so the caller can fall back to plain text.
 */
async function enrichWithSSML(
  text: string,
  documentContext: string,
  voiceName: string,
  groqKey: string
): Promise<string | null> {
  try {
    const groq = new Groq({ apiKey: groqKey });
    const response = await groq.chat.completions.create({
      model: SSML_MODEL,
      messages: [
        {
          role: "user",
          content: buildSSMLPrompt(text, documentContext, voiceName),
        },
      ],
      max_tokens: Math.min(4096, text.length * 4), // SSML is ~2–3× longer than plain text
      temperature: 0.2, // low temperature for predictable, valid SSML
    });

    const raw = response.choices[0]?.message?.content ?? "";
    return sanitiseSSML(raw);
  } catch (err) {
    console.warn("[tts] SSML enrichment failed, falling back to plain text:", err);
    return null;
  }
}

/**
 * POST /api/tts
 *
 * Synthesises text to MP3 using Microsoft Edge TTS.
 * When `documentContext` is provided the text is first enriched with SSML
 * markup by Groq (adds pauses, emphasis, prosody) before synthesis —
 * producing significantly more natural-sounding audio.
 *
 * @body text            - Text to synthesise (required, ≤ 5 000 bytes).
 * @body voiceName       - Edge TTS neural voice name.
 * @body speakingRate    - Speed multiplier, clamped to [0.5, 2.0].
 * @body pitch           - Semitone shift, clamped to [-10, +10].
 * @body documentContext - (optional) Output of /api/analyse-document.
 *
 * @returns { audioContent: string } — base64-encoded MP3.
 */
export async function POST(req: NextRequest) {
  const groqKey = process.env.GROQ_API_KEY;

  let body: Partial<TTSRequestBody>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { text, voiceName, speakingRate = 1.0, pitch = 0, documentContext } = body;

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

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

    let audioStream;

    // ── SSML-enhanced path ────────────────────────────────────────────────
    if (documentContext && groqKey) {
      const ssmlFragment = await enrichWithSSML(text, documentContext, voiceName, groqKey);

      if (ssmlFragment) {
        // Wrap the LLM-generated fragment in the full SSML document the
        // Edge TTS service expects, including our user-chosen prosody settings.
        const fullSSML = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
  <voice name="${voiceName}">
    <prosody rate="${rateToSSML(clampedRate)}" pitch="${clampedPitch >= 0 ? `+${clampedPitch}st` : `${clampedPitch}st`}">
      ${ssmlFragment}
    </prosody>
  </voice>
</speak>`;
        ({ audioStream } = tts.rawToStream(fullSSML));
      }
    }

    // ── Plain-text fallback (no context, or SSML generation failed) ───────
    if (!audioStream) {
      const prosody = new ProsodyOptions();
      prosody.rate  = rateToSSML(clampedRate);
      prosody.pitch = pitchToSSML(clampedPitch);
      ({ audioStream } = tts.toStream(text, prosody));
    }

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data",  (chunk: Buffer) => chunks.push(chunk));
      audioStream.on("end",   resolve);
      audioStream.on("error", reject);
    });

    const audioContent = Buffer.concat(chunks).toString("base64");
    return NextResponse.json({ audioContent });
  } catch (err) {
    console.error("[TTS] Edge TTS error:", err);
    return NextResponse.json(
      { error: "TTS synthesis failed", detail: String(err) },
      { status: 502 }
    );
  }
}
