/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/tts/route";

// ---------------------------------------------------------------------------
// Mock msedge-tts
// ---------------------------------------------------------------------------
function makeMockAudioStream(data = "fake-mp3") {
  const { Readable } = require("stream");
  const stream = new Readable({ read() {} });
  process.nextTick(() => {
    stream.push(Buffer.from(data));
    stream.push(null);
  });
  return stream;
}

jest.mock("msedge-tts", () => ({
  MsEdgeTTS: jest.fn().mockImplementation(() => ({
    setMetadata: jest.fn().mockResolvedValue(undefined),
    toStream: jest.fn().mockReturnValue({
      audioStream: makeMockAudioStream(),
      metadataStream: null,
    }),
  })),
  OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: "mock_format" },
  ProsodyOptions: jest.fn().mockImplementation(() => ({ rate: "", pitch: "" })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  text: "Hello, this is a test.",
  voiceName: "en-US-JennyNeural",
  speakingRate: 1.0,
  pitch: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /api/tts", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns base64 audioContent for a valid request", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("audioContent");
    expect(typeof data.audioContent).toBe("string");
    expect(data.audioContent.length).toBeGreaterThan(0);
  });

  it("returns 400 when text is missing", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, text: "" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/text is required/i);
  });

  it("returns 400 when text is whitespace only", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, text: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid voiceName", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, voiceName: "not-a-real-voice" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/voiceName/i);
  });

  it("returns 400 when text exceeds 5 000 bytes", async () => {
    const oversized = "a".repeat(5100);
    const res = await POST(makeRequest({ ...VALID_BODY, text: oversized }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/5000-byte limit/i);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("clamps speakingRate to [0.5, 2.0] without erroring", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, speakingRate: 99 }));
    expect(res.status).toBe(200);
  });

  it("clamps pitch to [-10, +10] without erroring", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, pitch: -999 }));
    expect(res.status).toBe(200);
  });

  it("returns 502 when Edge TTS throws", async () => {
    const { MsEdgeTTS } = require("msedge-tts");
    MsEdgeTTS.mockImplementationOnce(() => ({
      setMetadata: jest.fn().mockRejectedValue(new Error("Network failure")),
      toStream: jest.fn(),
    }));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/TTS synthesis failed/i);
  });

  it("returns 502 when Edge TTS returns empty audio", async () => {
    const { MsEdgeTTS } = require("msedge-tts");
    const { Readable } = require("stream");
    const emptyStream = new Readable({ read() {} });
    process.nextTick(() => emptyStream.push(null)); // close with no data
    MsEdgeTTS.mockImplementationOnce(() => ({
      setMetadata: jest.fn().mockResolvedValue(undefined),
      toStream: jest.fn().mockReturnValue({ audioStream: emptyStream, metadataStream: null }),
    }));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/TTS synthesis failed/i);
  });

  it("ignores documentContext field (SSML path removed)", async () => {
    // documentContext is accepted but silently ignored — toStream is always used
    const res = await POST(makeRequest({ ...VALID_BODY, documentContext: "Academic paper." }));
    expect(res.status).toBe(200);
    const { MsEdgeTTS } = require("msedge-tts");
    // toStream should have been called (not rawToStream)
    const instance = MsEdgeTTS.mock.results[0].value;
    expect(instance.toStream).toHaveBeenCalledTimes(1);
  });
});
