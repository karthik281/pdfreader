import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB — Whisper limit

/**
 * POST /api/stt
 *
 * Transcribes audio to text using Groq Whisper.
 * Accepts raw audio as the request body with the appropriate Content-Type
 * (e.g. `audio/webm`, `audio/mp4`, `audio/wav`).
 *
 * @returns { text: string } — transcribed text.
 */
export async function POST(req: NextRequest) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("audio/")) {
    return NextResponse.json(
      { error: "Content-Type must be an audio/* MIME type" },
      { status: 400 }
    );
  }

  const arrayBuffer = await req.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    return NextResponse.json({ error: "Empty audio body" }, { status: 400 });
  }
  if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio exceeds 25 MB limit" }, { status: 400 });
  }

  // Derive a filename extension from the MIME type so Whisper can identify the format
  const ext  = contentType.split("/")[1]?.split(";")[0] ?? "webm";
  const file = new File([arrayBuffer], `recording.${ext}`, { type: contentType });

  try {
    const groq          = new Groq({ apiKey: groqKey });
    const transcription = await groq.audio.transcriptions.create({
      file,
      model:           "whisper-large-v3-turbo",
      response_format: "json",
    });

    return NextResponse.json({ text: transcription.text ?? "" });
  } catch (err) {
    console.error("[stt] Whisper error:", err);
    return NextResponse.json(
      { error: "Transcription failed", detail: String(err) },
      { status: 502 }
    );
  }
}
