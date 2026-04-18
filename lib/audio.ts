"use client";

/**
 * Returns the UTF-8 byte length of a string.
 * Works in both browser (Blob API) and Node.js (Buffer API),
 * making this module testable in Jest without jsdom.
 */
function byteSize(str: string): number {
  if (typeof Buffer !== "undefined") {
    return Buffer.byteLength(str, "utf8");
  }
  return new Blob([str]).size;
}

/**
 * Concatenates multiple base64-encoded MP3 chunks into a single Blob URL
 * that the browser can use as a download href.
 *
 * MP3 is a frame-based format — concatenating raw frames produces a valid
 * file that every mainstream player handles correctly.
 *
 * @param base64Chunks - Array of base64-encoded MP3 strings from the TTS API.
 * @returns A `blob:` URL pointing to the merged audio. Revoke it with
 *          `URL.revokeObjectURL` when no longer needed to free memory.
 */
export function mergeMP3sToBlob(base64Chunks: string[]): string {
  if (base64Chunks.length === 0) {
    throw new Error("mergeMP3sToBlob: received empty chunks array");
  }

  const binaryChunks = base64Chunks.map((b64) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  });

  const totalLength = binaryChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of binaryChunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const blob = new Blob([merged], { type: "audio/mpeg" });
  return URL.createObjectURL(blob);
}

/**
 * Splits text into chunks that each fit within `maxBytes` UTF-8 bytes.
 * Splits first at sentence boundaries (`.`, `!`, `?`), then at word
 * boundaries if a single sentence exceeds the limit.
 *
 * The Microsoft Edge TTS API accepts up to ~5 000 bytes per request.
 * We default to 4 800 to leave headroom for SSML overhead.
 *
 * @param text     - The full text to chunk.
 * @param maxBytes - Maximum bytes per chunk (default 4 800).
 * @returns Array of non-empty text chunks, each within the byte limit.
 */
export function chunkText(text: string, maxBytes = 4800): string[] {
  if (!text.trim()) return [];

  const chunks: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) ?? [text];

  let current = "";

  for (const sentence of sentences) {
    if (byteSize(current + sentence) > maxBytes) {
      if (current) chunks.push(current.trim());

      if (byteSize(sentence) > maxBytes) {
        // Single sentence is too long — split by words
        const words = sentence.split(" ");
        let wordChunk = "";
        for (const word of words) {
          if (byteSize(wordChunk + " " + word) > maxBytes) {
            if (wordChunk) chunks.push(wordChunk.trim());
            wordChunk = word;
          } else {
            wordChunk += (wordChunk ? " " : "") + word;
          }
        }
        current = wordChunk;
      } else {
        current = sentence;
      }
    } else {
      current += sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}
