import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

interface DescribeImageBody {
  imageDataUrl: string; // base64 JPEG data URL, e.g. "data:image/jpeg;base64,..."
  pageNumber: number;
}

/** Maximum allowed base64 payload (~4 MB decoded ≈ ~5.3 MB base64) */
const MAX_IMAGE_B64_LENGTH = 5_500_000;

const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

/**
 * POST /api/describe-image
 *
 * Sends a rendered PDF page image to Groq's vision model and returns a
 * natural-language description suitable for text-to-speech playback.
 *
 * @body imageDataUrl - A base64-encoded JPEG data URL of the page.
 * @body pageNumber   - The 1-based page number (used in the prompt).
 *
 * @returns `{ description: string }` — a readable audio-friendly description.
 */
export async function POST(req: NextRequest) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json(
      { error: "GROQ_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  let body: Partial<DescribeImageBody>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { imageDataUrl, pageNumber } = body;

  if (!imageDataUrl) {
    return NextResponse.json({ error: "imageDataUrl is required" }, { status: 400 });
  }

  if (!imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "imageDataUrl must be a valid image data URL (data:image/...)" },
      { status: 400 }
    );
  }

  if (imageDataUrl.length > MAX_IMAGE_B64_LENGTH) {
    return NextResponse.json(
      { error: "Image payload too large. Maximum is ~4 MB." },
      { status: 413 }
    );
  }

  const page = typeof pageNumber === "number" && pageNumber > 0 ? pageNumber : 1;

  try {
    const groq = new Groq({ apiKey: groqKey });

    const response = await groq.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageDataUrl },
            },
            {
              type: "text",
              text:
                `This is page ${page} of a PDF document. ` +
                `Describe all content on this page in detail so that a listener ` +
                `hearing this as audio can fully understand it. ` +
                `Include: any visible text, data in tables (read row by row), ` +
                `chart values, and figure descriptions. ` +
                `Be thorough but natural-sounding — it will be converted to speech. ` +
                `Start with "On page ${page}:" and end with a period.`,
            },
          ],
        },
      ],
      max_tokens: 1024,
    });

    const description =
      response.choices[0]?.message?.content ??
      `On page ${page}: the content could not be described.`;

    return NextResponse.json({ description });
  } catch (err) {
    console.error("[describe-image] Groq error:", err);
    return NextResponse.json(
      { error: "Image description failed", detail: String(err) },
      { status: 502 }
    );
  }
}
