/**
 * Prompt templates and sanitisation utilities for SSML-enhanced TTS.
 *
 * The flow is:
 *  1. analyse-document  → one Groq call → documentContext string
 *  2. text-to-ssml      → one Groq call per TTS chunk → SSML markup
 *  3. Edge TTS toStream → receives SSML markup inside its own <speak> wrapper
 */

// ---------------------------------------------------------------------------
// Prompt: document analysis (called once per PDF)
// ---------------------------------------------------------------------------
export function buildAnalysisPrompt(sampleText: string): string {
  return `You are preparing a document to be read aloud by a text-to-speech system.
Analyse the following excerpt and respond with a single short paragraph (4–6 sentences) describing:
1. The document type (e.g. academic paper, news article, business report, fiction novel, technical manual, self-help book)
2. The overall tone (e.g. formal, conversational, dramatic, instructional, persuasive)
3. Specific TTS reading guidance: where natural pauses should fall, which kinds of words deserve emphasis, and what speaking pace suits the content
4. Any structural patterns to watch for (e.g. numbered lists, headings, quotations, statistics)

Be concise and actionable. This description will be fed directly into a subsequent prompt that adds SSML markup to each paragraph.

DOCUMENT EXCERPT:
${sampleText}`;
}

// ---------------------------------------------------------------------------
// Prompt: SSML markup generation (called once per TTS chunk)
// ---------------------------------------------------------------------------
export function buildSSMLPrompt(
  text: string,
  documentContext: string,
  voiceName: string
): string {
  return `You are a speech synthesis expert converting text to SSML for Microsoft Edge Neural TTS (voice: ${voiceName}).

DOCUMENT CONTEXT:
${documentContext}

SSML RULES — follow these exactly:
- Return ONLY the inner SSML markup. Do NOT include <speak>, <voice>, or <prosody> wrapper tags.
- Preserve every word of the original text — do not paraphrase, summarise, or skip anything.
- Use <break time="Xms"/> for pauses:
    • 800ms after a paragraph or major section heading
    • 500ms after a sentence that ends a thought or introduces a new idea
    • 250ms after list items or bullet points
- Use <emphasis level="moderate"> around key terms, named entities, statistics, and conclusions.
- Use <emphasis level="strong"> sparingly — only for the most critical phrases.
- Use <prosody rate="85%"> to slow down for headings, definitions, and important statements.
- Use <prosody rate="110%"> to speed up parenthetical notes, examples, or asides.
- For questions, add pitch variation: <prosody pitch="+10%">question text?</prosody>
- Escape XML special characters: & → &amp;   < → &lt;   > → &gt;
- Do NOT add any explanation, commentary, or markdown. Return raw SSML fragment only.

TEXT TO CONVERT:
${text}`;
}

// ---------------------------------------------------------------------------
// Sanitise LLM output before passing to Edge TTS
// ---------------------------------------------------------------------------

/**
 * Strips outer <speak>, <voice>, and <prosody> wrapper tags if the LLM
 * accidentally included them, and does a basic sanity check.
 *
 * Returns the cleaned inner SSML string, or `null` if the output looks
 * unusable (empty or clearly not SSML/text).
 */
export function sanitiseSSML(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;

  // Strip markdown code fences if present
  s = s.replace(/^```(?:xml|ssml)?\n?/i, "").replace(/\n?```$/i, "").trim();

  // If LLM wrapped in <speak>...</speak>, extract inner content
  const speakMatch = s.match(/<speak[\s\S]*?>([\s\S]*)<\/speak>/i);
  if (speakMatch) {
    s = speakMatch[1].trim();
    // If there's a <voice> wrapper inside, strip that too
    const voiceMatch = s.match(/<voice[\s\S]*?>([\s\S]*)<\/voice>/i);
    if (voiceMatch) s = voiceMatch[1].trim();
  }

  // Strip a top-level <prosody> wrapper (Edge TTS adds its own)
  const prosodyMatch = s.match(/^<prosody[^>]*>([\s\S]*)<\/prosody>$/i);
  if (prosodyMatch) s = prosodyMatch[1].trim();

  return s.length > 0 ? s : null;
}
