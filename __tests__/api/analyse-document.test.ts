/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/analyse-document/route";

// ── Mock Groq SDK ──────────────────────────────────────────────────────────
const mockCreate = jest.fn().mockResolvedValue({
  choices: [
    {
      message: {
        content:
          "This is an academic paper with a formal tone. Pause after statistics and emphasise key findings.",
      },
    },
  ],
});

jest.mock("groq-sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

// ── Helpers ────────────────────────────────────────────────────────────────
function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/analyse-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const OLD_ENV = process.env;

// ── Tests ──────────────────────────────────────────────────────────────────
describe("POST /api/analyse-document", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, GROQ_API_KEY: "test-key" };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("returns a documentContext string for valid input", async () => {
    const res = await POST(makeRequest({ sampleText: "This is a research paper about climate change." }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("documentContext");
    expect(typeof data.documentContext).toBe("string");
    expect(data.documentContext.length).toBeGreaterThan(0);
  });

  it("returns 500 when GROQ_API_KEY is missing", async () => {
    delete process.env.GROQ_API_KEY;
    const res = await POST(makeRequest({ sampleText: "some text" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/GROQ_API_KEY/i);
  });

  it("returns 400 when sampleText is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/sampleText is required/i);
  });

  it("returns 400 when sampleText is whitespace only", async () => {
    const res = await POST(makeRequest({ sampleText: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/analyse-document", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("truncates very long sampleText to avoid huge payloads", async () => {
    const huge = "word ".repeat(5000);
    const res = await POST(makeRequest({ sampleText: huge }));
    expect(res.status).toBe(200);
    // Verify Groq was called with a truncated prompt, not the full string
    const calledWith = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(calledWith.length).toBeLessThan(huge.length);
  });

  it("returns 502 when Groq throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Groq overloaded"));
    const res = await POST(makeRequest({ sampleText: "some text" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Document analysis failed/i);
  });
});
