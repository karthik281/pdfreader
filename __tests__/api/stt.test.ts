/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/stt/route";

// ── Mock Groq ──────────────────────────────────────────────────────────────
const mockTranscribe = jest.fn().mockResolvedValue({ text: "Hello world." });

jest.mock("groq-sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    audio: { transcriptions: { create: mockTranscribe } },
  })),
}));

// ── Helpers ────────────────────────────────────────────────────────────────
function makeAudioRequest(body: BodyInit, contentType = "audio/webm") {
  return new NextRequest("http://localhost/api/stt", {
    method:  "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

const OLD_ENV = process.env;

describe("POST /api/stt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, GROQ_API_KEY: "test-key" };
  });

  afterAll(() => { process.env = OLD_ENV; });

  it("returns transcribed text for valid audio", async () => {
    const fakeAudio = new Uint8Array([0, 1, 2, 3]).buffer;
    const res  = await POST(makeAudioRequest(fakeAudio, "audio/webm"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("text", "Hello world.");
  });

  it("returns 400 for non-audio content-type", async () => {
    const req = new NextRequest("http://localhost/api/stt", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/audio/i);
  });

  it("returns 400 for empty body", async () => {
    const req = new NextRequest("http://localhost/api/stt", {
      method:  "POST",
      headers: { "Content-Type": "audio/webm" },
      body:    new ArrayBuffer(0),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  it("returns 500 when GROQ_API_KEY is missing", async () => {
    delete process.env.GROQ_API_KEY;
    const res = await POST(makeAudioRequest(new Uint8Array([1]).buffer));
    expect(res.status).toBe(500);
  });

  it("returns 502 when Whisper throws", async () => {
    mockTranscribe.mockRejectedValueOnce(new Error("Whisper overloaded"));
    const res  = await POST(makeAudioRequest(new Uint8Array([1, 2, 3]).buffer));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/transcription failed/i);
  });

  it("passes the correct model to Groq", async () => {
    await POST(makeAudioRequest(new Uint8Array([1, 2]).buffer));
    expect(mockTranscribe.mock.calls[0][0]).toMatchObject({
      model: "whisper-large-v3-turbo",
    });
  });

  it("returns 400 when audio exceeds 25 MB", async () => {
    // 25 MB + 1 byte — just over the limit
    const bigBuffer = new ArrayBuffer(25 * 1024 * 1024 + 1);
    const res = await POST(makeAudioRequest(bigBuffer, "audio/webm"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/25 MB/i);
  });

  it("passes the correct response_format to Groq", async () => {
    await POST(makeAudioRequest(new Uint8Array([1, 2]).buffer));
    expect(mockTranscribe.mock.calls[0][0]).toMatchObject({
      response_format: "json",
    });
  });

  it("derives the file extension from the MIME type", async () => {
    await POST(makeAudioRequest(new Uint8Array([1, 2]).buffer, "audio/mp4"));
    const file: File = mockTranscribe.mock.calls[0][0].file;
    expect(file.name).toBe("recording.mp4");
    expect(file.type).toBe("audio/mp4");
  });
});
