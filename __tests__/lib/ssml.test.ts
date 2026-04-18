import { buildAnalysisPrompt, buildSSMLPrompt, sanitiseSSML } from "@/lib/ssml";

// ---------------------------------------------------------------------------
// buildAnalysisPrompt
// ---------------------------------------------------------------------------
describe("buildAnalysisPrompt", () => {
  it("includes the sample text in the prompt", () => {
    const prompt = buildAnalysisPrompt("This is a research paper.");
    expect(prompt).toContain("This is a research paper.");
  });

  it("instructs the model to identify document type and tone", () => {
    const prompt = buildAnalysisPrompt("some text");
    expect(prompt.toLowerCase()).toContain("document type");
    expect(prompt.toLowerCase()).toContain("tone");
  });

  it("asks for TTS-specific reading guidance", () => {
    const prompt = buildAnalysisPrompt("some text");
    expect(prompt.toLowerCase()).toContain("tts");
  });
});

// ---------------------------------------------------------------------------
// buildSSMLPrompt
// ---------------------------------------------------------------------------
describe("buildSSMLPrompt", () => {
  const ctx = "Academic paper. Formal tone. Pause after statistics.";
  const voice = "en-US-JennyNeural";

  it("includes the text to convert", () => {
    const prompt = buildSSMLPrompt("Hello world.", ctx, voice);
    expect(prompt).toContain("Hello world.");
  });

  it("includes the document context", () => {
    const prompt = buildSSMLPrompt("text", ctx, voice);
    expect(prompt).toContain(ctx);
  });

  it("includes the voice name", () => {
    const prompt = buildSSMLPrompt("text", ctx, voice);
    expect(prompt).toContain(voice);
  });

  it("instructs the model NOT to include <speak> wrapper", () => {
    const prompt = buildSSMLPrompt("text", ctx, voice);
    expect(prompt).toMatch(/do not include.*<speak>/i);
  });

  it("instructs the model to preserve all text", () => {
    const prompt = buildSSMLPrompt("text", ctx, voice);
    expect(prompt.toLowerCase()).toContain("preserve every word");
  });
});

// ---------------------------------------------------------------------------
// sanitiseSSML
// ---------------------------------------------------------------------------
describe("sanitiseSSML", () => {
  it("returns null for empty string", () => {
    expect(sanitiseSSML("")).toBeNull();
    expect(sanitiseSSML("   ")).toBeNull();
  });

  it("returns plain text unchanged", () => {
    expect(sanitiseSSML("Hello world.")).toBe("Hello world.");
  });

  it("returns an SSML fragment unchanged", () => {
    const fragment = `<emphasis level="moderate">Hello</emphasis> world.`;
    expect(sanitiseSSML(fragment)).toBe(fragment);
  });

  it("strips outer <speak>...</speak> wrapper", () => {
    const input = `<speak version="1.0" xmlns="...">\n  inner content\n</speak>`;
    expect(sanitiseSSML(input)).toBe("inner content");
  });

  it("strips <speak> + <voice> double wrapper", () => {
    const input = `<speak version="1.0"><voice name="Jenny">inner</voice></speak>`;
    expect(sanitiseSSML(input)).toBe("inner");
  });

  it("strips a top-level <prosody> wrapper", () => {
    const input = `<prosody rate="90%">inner content</prosody>`;
    expect(sanitiseSSML(input)).toBe("inner content");
  });

  it("strips markdown code fences", () => {
    const input = "```xml\n<emphasis>hello</emphasis>\n```";
    expect(sanitiseSSML(input)).toBe("<emphasis>hello</emphasis>");
  });

  it("strips ssml code fences", () => {
    const input = "```ssml\n<break time='500ms'/>\n```";
    expect(sanitiseSSML(input)).toBe("<break time='500ms'/>");
  });

  it("preserves nested SSML tags inside the fragment", () => {
    const input = `<speak><voice name="Jenny"><emphasis level="strong">key term</emphasis> followed by <break time="500ms"/> more text.</voice></speak>`;
    const result = sanitiseSSML(input);
    expect(result).toContain('<emphasis level="strong">key term</emphasis>');
    expect(result).toContain('<break time="500ms"/>');
  });
});
