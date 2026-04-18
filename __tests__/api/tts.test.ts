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

const mockRawToStream = jest.fn().mockReturnValue({
  audioStream: makeMockAudioStream("ssml-mp3"),
  metadataStream: null,
});

jest.mock("msedge-tts", () => ({
  MsEdgeTTS: jest.fn().mockImplementation(() => ({
    setMetadata: jest.fn().mockResolvedValue(undefined),
    toStream: jest.fn().mockReturnValue({
      audioStream: makeMockAudioStream(),
      metadataStream: null,
    }),
    rawToStream: mockRawToStream,
  })),
  OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: "mock_format" },
  ProsodyOptions: jest.fn().mockImplementation(() => ({ rate: "", pitch: "" })),
}));

// Mock Groq for SSML enrichment
const mockGroqCreate = jest.fn().mockResolvedValue({
  choices: [{ message: { content: "<emphasis>Hello</emphasis> world." } }],
});
jest.mock("groq-sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockGroqCreate } },
  })),
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
      rawToStream: jest.fn(),
    }));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/TTS synthesis failed/i);
  });
});

// ---------------------------------------------------------------------------
// SSML-enhanced path (documentContext provided)
// ---------------------------------------------------------------------------
describe("POST /api/tts — SSML-enhanced path", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, GROQ_API_KEY: "test-groq-key" };
  });

  afterAll(() => { process.env = OLD_ENV; });

  const SSML_BODY = {
    ...VALID_BODY,
    documentContext: "Academic paper. Formal tone. Pause after statistics.",
  };

  it("calls rawToStream (SSML path) when documentContext is provided", async () => {
    const res = await POST(makeRequest(SSML_BODY));
    expect(res.status).toBe(200);
    expect(mockRawToStream).toHaveBeenCalledTimes(1);
    // The SSML passed should include the <speak> wrapper
    const ssmlArg: string = mockRawToStream.mock.calls[0][0];
    expect(ssmlArg).toContain("<speak");
    expect(ssmlArg).toContain(VALID_BODY.voiceName);
  });

  it("falls back to toStream if Groq SSML generation fails", async () => {
    mockGroqCreate.mockRejectedValueOnce(new Error("Rate limited"));
    const { MsEdgeTTS } = require("msedge-tts");
    const mockToStream = jest.fn().mockReturnValue({
      audioStream: (() => {
        const { Readable } = require("stream");
        const s = new Readable({ read() {} });
        process.nextTick(() => { s.push(Buffer.from("fallback")); s.push(null); });
        return s;
      })(),
      metadataStream: null,
    });
    MsEdgeTTS.mockImplementationOnce(() => ({
      setMetadata: jest.fn().mockResolvedValue(undefined),
      toStream: mockToStream,
      rawToStream: jest.fn(),
    }));
    const res = await POST(makeRequest(SSML_BODY));
    expect(res.status).toBe(200);
    expect(mockToStream).toHaveBeenCalledTimes(1);
  });

  it("falls back to toStream if sanitiseSSML returns null", async () => {
    // LLM returns empty string → sanitiseSSML returns null → fallback
    mockGroqCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
    });
    const res = await POST(makeRequest(SSML_BODY));
    expect(res.status).toBe(200);
  });
});
