import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { buildAnalysisPrompt } from "@/lib/ssml";

interface AnalyseDocumentBody {
  sampleText: string;
}

const MAX_SAMPLE_BYTES = 6000;
const ANALYSIS_MODEL = "llama-3.3-70b-versatile";

/**
 * POST /api/analyse-document
 *
 * Reads a short sample of the PDF's text and returns a plain-English
 * description of the document's type, tone, and reading style.
 * This "document context" is then passed to every /api/tts call so the
 * SSML generation is consistent across the whole document.
 *
 * @body sampleText - First ~3 000 characters of extracted PDF text.
 * @returns { documentContext: string }
 */
export async function POST(req: NextRequest) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json(
      { error: "GROQ_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  let body: Partial<AnalyseDocumentBody>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sampleText } = body;

  if (!sampleText?.trim()) {
    return NextResponse.json({ error: "sampleText is required" }, { status: 400 });
  }

  // Trim sample to avoid huge payloads
  const sample = sampleText.length > MAX_SAMPLE_BYTES
    ? sampleText.slice(0, MAX_SAMPLE_BYTES) + "…"
    : sampleText;

  try {
    const groq = new Groq({ apiKey: groqKey });
    const response = await groq.chat.completions.create({
      model: ANALYSIS_MODEL,
      messages: [{ role: "user", content: buildAnalysisPrompt(sample) }],
      max_tokens: 300,
      temperature: 0.3, // low temperature for consistent, factual analysis
    });

    const documentContext =
      response.choices[0]?.message?.content?.trim() ??
      "General document. Use a clear, neutral reading pace with natural pauses between sentences.";

    return NextResponse.json({ documentContext });
  } catch (err) {
    console.error("[analyse-document] Groq error:", err);
    // Non-fatal: caller should fall back to plain TTS without context
    return NextResponse.json(
      { error: "Document analysis failed", detail: String(err) },
      { status: 502 }
    );
  }
}
