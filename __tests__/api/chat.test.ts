/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/route";

// ── Mock Groq ──────────────────────────────────────────────────────────────
async function* fakeStream(tokens: string[]) {
  for (const t of tokens) {
    yield { choices: [{ delta: { content: t } }] };
  }
}

const mockCreate = jest.fn().mockReturnValue(fakeStream(["Hello", " world"]));

jest.mock("groq-sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

// ── Helpers ────────────────────────────────────────────────────────────────
function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/chat", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

const OLD_ENV = process.env;

describe("POST /api/chat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, GROQ_API_KEY: "test-key" };
    mockCreate.mockReturnValue(fakeStream(["Hello", " world"]));
  });

  afterAll(() => { process.env = OLD_ENV; });

  it("returns a text/event-stream response for valid input", async () => {
    const res = await POST(makeRequest({ message: "What is this about?", documentContext: "A test doc.", history: [] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("streams SSE tokens from the Groq response", async () => {
    const res  = await POST(makeRequest({ message: "Hi", documentContext: "", history: [] }));
    const body = await res.text();
    expect(body).toContain("data: ");
    expect(body).toContain("[DONE]");
    expect(body).toContain("Hello");
  });

  it("returns 400 when message is missing", async () => {
    const res = await POST(makeRequest({ message: "", documentContext: "", history: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/message is required/i);
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/chat", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 500 when GROQ_API_KEY is missing", async () => {
    delete process.env.GROQ_API_KEY;
    const res = await POST(makeRequest({ message: "Hi", documentContext: "", history: [] }));
    expect(res.status).toBe(500);
  });

  it("uses compound-beta model when webSearch is true", async () => {
    await POST(makeRequest({ message: "Search for X", documentContext: "", history: [], webSearch: true }));
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.model).toBe("compound-beta");
  });

  it("uses llama model when webSearch is false", async () => {
    await POST(makeRequest({ message: "Tell me about this", documentContext: "", history: [], webSearch: false }));
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.model).toContain("llama");
  });

  it("truncates very long documentContext to MAX_CONTEXT_CHARS", async () => {
    const huge = "word ".repeat(5000);
    await POST(makeRequest({ message: "Hi", documentContext: huge, history: [] }));
    const systemContent = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemContent.length).toBeLessThan(huge.length);
  });

  it("includes history in the messages sent to Groq", async () => {
    const history = [
      { role: "user",      content: "Previous question" },
      { role: "assistant", content: "Previous answer" },
    ];
    await POST(makeRequest({ message: "Follow-up", documentContext: "", history }));
    const messages = mockCreate.mock.calls[0][0].messages as { role: string; content: string }[];
    const roles    = messages.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });

  it("streams an error SSE event when the Groq stream throws mid-iteration", async () => {
    async function* failingStream() {
      yield { choices: [{ delta: { content: "partial" } }] };
      throw new Error("Stream interrupted");
    }
    mockCreate.mockReturnValueOnce(failingStream());
    const res  = await POST(makeRequest({ message: "Hi", documentContext: "", history: [] }));
    expect(res.status).toBe(200); // outer try/catch not reached; error is inside ReadableStream
    const body = await res.text();
    expect(body).toContain("partial");
    expect(body).toContain("error");
  });

  it("returns 502 when groq.chat.completions.create() itself throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Groq unavailable"));
    const res  = await POST(makeRequest({ message: "Hi", documentContext: "", history: [] }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/chat failed/i);
  });

  it("includes documentContext in the system prompt when provided", async () => {
    await POST(makeRequest({ message: "Hi", documentContext: "Interesting content here.", history: [] }));
    const systemContent = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemContent).toContain("Interesting content here.");
  });

  it("uses a generic system prompt when documentContext is empty", async () => {
    await POST(makeRequest({ message: "Hi", documentContext: "", history: [] }));
    const systemContent = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemContent).toBe("You are a helpful assistant.");
  });
});
