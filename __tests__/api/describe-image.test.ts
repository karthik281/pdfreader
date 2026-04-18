/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/describe-image/route";

// ---------------------------------------------------------------------------
// Mock Groq SDK
// ---------------------------------------------------------------------------
const mockCreate = jest.fn().mockResolvedValue({
  choices: [{ message: { content: "On page 1: a table showing quarterly revenue." } }],
});

jest.mock("groq-sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_IMAGE_URL = "data:image/jpeg;base64," + Buffer.from("fake-image").toString("base64");

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/describe-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /api/describe-image", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, GROQ_API_KEY: "test-groq-key" };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("returns a description for a valid request", async () => {
    const res = await POST(makeRequest({ imageDataUrl: VALID_IMAGE_URL, pageNumber: 1 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("description");
    expect(data.description).toMatch(/On page 1/);
  });

  it("returns 500 when GROQ_API_KEY is missing", async () => {
    delete process.env.GROQ_API_KEY;
    const res = await POST(makeRequest({ imageDataUrl: VALID_IMAGE_URL, pageNumber: 1 }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/GROQ_API_KEY/i);
  });

  it("returns 400 when imageDataUrl is missing", async () => {
    const res = await POST(makeRequest({ pageNumber: 1 }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/imageDataUrl is required/i);
  });

  it("returns 400 when imageDataUrl is not a data URL", async () => {
    const res = await POST(makeRequest({ imageDataUrl: "https://example.com/image.jpg", pageNumber: 1 }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/data URL/i);
  });

  it("returns 413 when image payload is too large", async () => {
    const oversized = "data:image/jpeg;base64," + "A".repeat(5_600_000);
    const res = await POST(makeRequest({ imageDataUrl: oversized, pageNumber: 1 }));
    expect(res.status).toBe(413);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/describe-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("defaults pageNumber to 1 when omitted or invalid", async () => {
    const res = await POST(makeRequest({ imageDataUrl: VALID_IMAGE_URL }));
    expect(res.status).toBe(200);
  });

  it("returns 502 when Groq throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API overloaded"));
    const res = await POST(makeRequest({ imageDataUrl: VALID_IMAGE_URL, pageNumber: 2 }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/Image description failed/i);
  });
});
