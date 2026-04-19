/**
 * Tests for LiveReader component.
 *
 * Strategy: mock the full Web Audio API (AudioContext), fetch, and
 * MediaRecorder so we can drive state transitions without real audio.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import LiveReader from "@/components/LiveReader";
import type { Chapter, PageContent, VoiceSettings } from "@/types";

// ── Mock Web Audio API ────────────────────────────────────────────────────────
const mockStart              = jest.fn();
const mockStop               = jest.fn();
const mockConnect            = jest.fn();
const mockCreateBufferSource = jest.fn();
const mockDecodeAudioData    = jest.fn();
const mockClose              = jest.fn();
const mockResume             = jest.fn().mockResolvedValue(undefined);

function makeMockSource() {
  return {
    buffer: null as unknown as AudioBuffer,
    connect: mockConnect,
    start: mockStart,
    stop: mockStop,
    disconnect: jest.fn(),
    onended: null as (() => void) | null,
  };
}

class MockAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  createBufferSource = mockCreateBufferSource;
  decodeAudioData    = mockDecodeAudioData;
  resume             = mockResume;
  close              = mockClose;
}

// ── Mock URL helpers ──────────────────────────────────────────────────────────
const mockCreateObjectURL = jest.fn(() => "blob:mock-tts-url");
const mockRevokeObjectURL = jest.fn();

// ── Mock MediaRecorder ────────────────────────────────────────────────────────
class MockMediaRecorder {
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null;
  onstop: (() => void) | null = null;
  start = jest.fn();
  stop  = jest.fn(() => { this.onstop?.(); });
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).AudioContext  = MockAudioContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).MediaRecorder = MockMediaRecorder;
  global.URL.createObjectURL = mockCreateObjectURL;
  global.URL.revokeObjectURL = mockRevokeObjectURL;
  global.fetch = jest.fn();
  // jsdom doesn't implement scrollIntoView
  Element.prototype.scrollIntoView = jest.fn();
  // jsdom stub for requestAnimationFrame
  global.requestAnimationFrame  = (cb) => setTimeout(cb, 16) as unknown as number;
  global.cancelAnimationFrame   = (id) => clearTimeout(id);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateBufferSource.mockImplementation(makeMockSource);
  mockDecodeAudioData.mockResolvedValue({ duration: 60 } as unknown as AudioBuffer);
  mockClose.mockResolvedValue(undefined);

  // Default fetch: TTS returns base64 audio, STT returns transcribed text,
  // blob fetch returns an ArrayBuffer.
  (global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (url === "/api/tts") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ audioContent: "AAAA" }),
      });
    }
    if (url === "/api/stt") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ text: "hello" }),
      });
    }
    if (url === "/api/chat") {
      // Manually mock the ReadableStream reader so it works in jsdom
      const encoder = new TextEncoder();
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({ done: false, value: encoder.encode('data: {"content":"Hi there"}\n\ndata: [DONE]\n\n') })
          .mockResolvedValueOnce({ done: true,  value: undefined }),
      };
      return Promise.resolve({
        ok:   true,
        body: { getReader: () => mockReader },
      });
    }
    // Blob URL fetch (for audio buffer)
    return Promise.resolve({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });
  });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAPTERS: Chapter[] = [
  { id: "ch-1", title: "Introduction", pageStart: 1, pageEnd: 3, content: "Intro text.", status: "idle" },
  { id: "ch-2", title: "Chapter One", pageStart: 4, pageEnd: 6, content: "Chapter one text.", status: "idle" },
];

const PAGES: PageContent[] = [
  { pageNumber: 1, text: "Page one text.", hasImages: false },
  { pageNumber: 2, text: "Page two text.", hasImages: false },
  { pageNumber: 3, text: "Page three text.", hasImages: false },
  { pageNumber: 4, text: "Page four text.", hasImages: false },
  { pageNumber: 5, text: "Page five text.", hasImages: false },
  { pageNumber: 6, text: "Page six text.", hasImages: false },
];

const VOICE: VoiceSettings = {
  gender: "FEMALE", voiceName: "en-US-JennyNeural", speakingRate: 1.0, pitch: 0,
};

function renderLiveReader(override: Partial<Parameters<typeof LiveReader>[0]> = {}) {
  const props = {
    chapters:      CHAPTERS,
    allPages:      PAGES,
    voiceSettings: VOICE,
    pdfName:       "test.pdf",
    onExit:        jest.fn(),
    ...override,
  };
  return { ...render(<LiveReader {...props} />), onExit: props.onExit as jest.Mock };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LiveReader — initial idle state", () => {
  it("renders the PDF name in the header", () => {
    renderLiveReader();
    expect(screen.getByText(/test\.pdf.*Live Read/i)).toBeInTheDocument();
  });

  it("shows the first section title", () => {
    renderLiveReader();
    expect(screen.getByText("Introduction")).toBeInTheDocument();
  });

  it("shows section X of Y counter", () => {
    renderLiveReader();
    expect(screen.getByText(/section 1 of 2/i)).toBeInTheDocument();
  });

  it("shows a Start Reading button in idle state", () => {
    renderLiveReader();
    expect(screen.getByRole("button", { name: /start reading/i })).toBeInTheDocument();
  });

  it("calls onExit when Back button is clicked", () => {
    const { onExit } = renderLiveReader();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe("LiveReader — chat panel", () => {
  it("renders the chat heading", () => {
    renderLiveReader();
    expect(screen.getByText(/ask about this document/i)).toBeInTheDocument();
  });

  it("renders the text input", () => {
    renderLiveReader();
    expect(screen.getByPlaceholderText(/ask a question/i)).toBeInTheDocument();
  });

  it("updates input value as user types", () => {
    renderLiveReader();
    const input = screen.getByPlaceholderText(/ask a question/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "What is this about?" } });
    expect(input.value).toBe("What is this about?");
  });

  it("send button is disabled when input is empty", () => {
    renderLiveReader();
    expect(screen.getByTitle("Send")).toBeDisabled();
  });

  it("send button is enabled when input has text", () => {
    renderLiveReader();
    const input = screen.getByPlaceholderText(/ask a question/i);
    fireEvent.change(input, { target: { value: "Hello?" } });
    expect(screen.getByTitle("Send")).not.toBeDisabled();
  });

  it("shows user message in chat after sending", async () => {
    renderLiveReader();
    const input = screen.getByPlaceholderText(/ask a question/i);
    fireEvent.change(input, { target: { value: "What is this?" } });
    fireEvent.click(screen.getByTitle("Send"));
    await waitFor(() =>
      expect(screen.getByText("What is this?")).toBeInTheDocument()
    );
  });

  it("calls /api/chat and shows the user message immediately", async () => {
    renderLiveReader();
    const input = screen.getByPlaceholderText(/ask a question/i);
    fireEvent.change(input, { target: { value: "Tell me more." } });
    fireEvent.click(screen.getByTitle("Send"));
    // User message is set synchronously; fetch to /api/chat follows
    await waitFor(() => {
      expect(screen.getByText("Tell me more.")).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ method: "POST" }));
    });
  });

  it("pressing Enter submits the message", async () => {
    renderLiveReader();
    const input = screen.getByPlaceholderText(/ask a question/i);
    fireEvent.change(input, { target: { value: "Enter test" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    await waitFor(() =>
      expect(screen.getByText("Enter test")).toBeInTheDocument()
    );
  });

  it("shows an error message in chat when the /api/chat call fails", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === "/api/chat") {
        return Promise.resolve(new Response(JSON.stringify({ error: "Service down" }), { status: 500 }));
      }
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    });
    renderLiveReader();
    const input = screen.getByPlaceholderText(/ask a question/i);
    fireEvent.change(input, { target: { value: "Fail?" } });
    fireEvent.click(screen.getByTitle("Send"));
    await waitFor(() =>
      expect(screen.getByText(/sorry, I couldn't answer/i)).toBeInTheDocument()
    );
  });
});

describe("LiveReader — web search toggle", () => {
  it("shows 'Web off' by default", () => {
    renderLiveReader();
    expect(screen.getByText(/web off/i)).toBeInTheDocument();
  });

  it("toggles to 'Web on' when clicked", () => {
    renderLiveReader();
    fireEvent.click(screen.getByTitle(/enable web search/i));
    expect(screen.getByText(/web on/i)).toBeInTheDocument();
  });

  it("passes webSearch=true to /api/chat when web search is on", async () => {
    renderLiveReader();
    fireEvent.click(screen.getByTitle(/enable web search/i));
    const input = screen.getByPlaceholderText(/ask a question/i);
    fireEvent.change(input, { target: { value: "Search this." } });
    fireEvent.click(screen.getByTitle("Send"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/chat",
        expect.objectContaining({
          body: expect.stringContaining('"webSearch":true'),
        })
      )
    );
  });
});

describe("LiveReader — section loading", () => {
  it("transitions to loading state when Start Reading is clicked", async () => {
    renderLiveReader();
    fireEvent.click(screen.getByRole("button", { name: /start reading/i }));
    // Loading state shows a spinner in the transport area
    await waitFor(() =>
      expect(screen.getByTitle(/previous section/i)).toBeInTheDocument()
    );
  });

  it("calls /api/tts when a section starts loading", async () => {
    renderLiveReader();
    fireEvent.click(screen.getByRole("button", { name: /start reading/i }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/tts",
        expect.objectContaining({ method: "POST" })
      )
    );
  });

  it("shows an error state when TTS fetch fails", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === "/api/tts") {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ detail: "TTS down" }) });
      }
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    });
    renderLiveReader();
    fireEvent.click(screen.getByRole("button", { name: /start reading/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /retry section/i })).toBeInTheDocument()
    );
  });
});

describe("LiveReader — reducer", () => {
  it("shows 'All sections read.' when all sections complete", async () => {
    // Single chapter so that onended → DONE immediately
    const single: Chapter[] = [
      { id: "ch-1", title: "Only Section", pageStart: 1, pageEnd: 2, content: "text", status: "idle" },
    ];
    const singlePages: PageContent[] = [
      { pageNumber: 1, text: "Hello.", hasImages: false },
      { pageNumber: 2, text: "World.", hasImages: false },
    ];

    renderLiveReader({ chapters: single, allPages: singlePages });
    fireEvent.click(screen.getByRole("button", { name: /start reading/i }));

    // Wait for playBuffer to be called (section loaded and playing)
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    // Simulate natural end of playback by calling src.onended
    const src = mockCreateBufferSource.mock.results[0].value;
    act(() => { src.onended?.(); });

    await waitFor(() =>
      expect(screen.getByText(/all sections read/i)).toBeInTheDocument()
    );
  });
});
