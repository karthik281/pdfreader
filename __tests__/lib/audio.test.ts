import { chunkText, mergeMP3sToBlob } from "@/lib/audio";

// ---------------------------------------------------------------------------
// chunkText
// ---------------------------------------------------------------------------
describe("chunkText", () => {
  it("returns an empty array for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns a single chunk for short text", () => {
    const result = chunkText("Hello world. This is a test.");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Hello world. This is a test.");
  });

  it("splits text into multiple chunks when it exceeds maxBytes", () => {
    // Each sentence is ~30 chars; 200 of them = ~6 000 chars > 4 800 byte default
    const sentence = "This is a normal sentence with some words. ";
    const longText = sentence.repeat(150);
    const chunks = chunkText(longText);

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk must be within the byte limit
    chunks.forEach((chunk) => {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(4800);
    });
  });

  it("reassembles to the same content when chunks are joined", () => {
    const sentence = "The quick brown fox jumps over the lazy dog. ";
    const original = sentence.repeat(120).trim();
    const chunks = chunkText(original);
    const reassembled = chunks.join(" ").replace(/\s+/g, " ").trim();

    // Normalise both sides and compare word sets
    expect(reassembled.split(" ").sort()).toEqual(original.split(" ").sort());
  });

  it("handles text with no sentence terminators (falls back to whole text)", () => {
    const text = "word ".repeat(10).trim();
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // All content must be preserved
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toBe(text);
  });

  it("respects a custom maxBytes parameter", () => {
    const text = "Short sentence one. Short sentence two. Short sentence three.";
    // 10-byte limit forces splits
    const chunks = chunkText(text, 10);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(10);
    });
  });

  it("splits a long sentence by words when it exceeds maxBytes", () => {
    // Use short words so each word fits within the limit
    // "one two three." = 14 bytes, limit = 10 → splits into multiple chunks
    const longSentence = "one two three four five six seven eight nine ten.";
    const chunks = chunkText(longSentence, 10);
    // Must produce more than one chunk
    expect(chunks.length).toBeGreaterThan(1);
    // All content must be present across chunks
    const words = chunks.join(" ").split(" ");
    expect(words).toContain("one");
    expect(words).toContain("ten.");
  });
});

// ---------------------------------------------------------------------------
// mergeMP3sToBlob
// ---------------------------------------------------------------------------
describe("mergeMP3sToBlob", () => {
  it("returns a blob URL string", () => {
    const fakeBase64 = Buffer.from("fake-mp3-data").toString("base64");
    const result = mergeMP3sToBlob([fakeBase64]);
    expect(result).toBe("blob:mock-url");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("concatenates multiple chunks into one Blob", () => {
    const chunk1 = Buffer.from("chunk1").toString("base64");
    const chunk2 = Buffer.from("chunk2").toString("base64");
    mergeMP3sToBlob([chunk1, chunk2]);
    // createObjectURL should receive a single Blob
    const call = (URL.createObjectURL as jest.Mock).mock.calls[0][0];
    expect(call).toBeInstanceOf(Blob);
    expect(call.type).toBe("audio/mpeg");
  });

  it("throws when given an empty array", () => {
    expect(() => mergeMP3sToBlob([])).toThrow("mergeMP3sToBlob: received empty chunks array");
  });
});
