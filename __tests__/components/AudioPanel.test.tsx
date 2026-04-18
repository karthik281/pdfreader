import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AudioPanel from "@/components/AudioPanel";

// ── Mock Web Audio API (jsdom has no real audio engine) ──────────────────────
const mockStart              = jest.fn();
const mockStop               = jest.fn();
const mockConnect            = jest.fn();
const mockCreateBufferSource = jest.fn();
const mockDecodeAudioData    = jest.fn();
const mockClose              = jest.fn();

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
  resume             = jest.fn().mockResolvedValue(undefined);
  close              = mockClose;
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).AudioContext = MockAudioContext;
  global.fetch = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateBufferSource.mockImplementation(makeMockSource);
  // By default, decoding succeeds and returns a 2-minute buffer
  mockDecodeAudioData.mockResolvedValue({ duration: 120 } as unknown as AudioBuffer);
  mockClose.mockResolvedValue(undefined);
  (global.fetch as jest.Mock).mockResolvedValue({
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
  } as unknown as Response);
});

// ── Shared props ──────────────────────────────────────────────────────────────
const BASE = {
  pdfName: "example.pdf",
  totalSections: 4,
  onGenerate: jest.fn(),
  progress: 0,
  statusLabel: "",
};

const READY_PROPS = {
  ...BASE,
  status: "ready" as const,
  progress: 100,
  statusLabel: "Ready",
  audioUrl: "blob:mock-url",
};

/**
 * Wait until the audio has "decoded" and the Play button is rendered and enabled.
 * The component shows a "Preparing audio…" spinner while fetching + decoding.
 */
async function waitForPlayer() {
  await waitFor(() => {
    const play = screen.queryByTitle("Play");
    expect(play).toBeInTheDocument();
    expect(play).not.toBeDisabled();
  });
}

// ── Idle state ─────────────────────────────────────────────────────────────
describe("idle state", () => {
  it("shows the PDF filename and section count", () => {
    render(<AudioPanel {...BASE} status="idle" />);
    expect(screen.getByText("example.pdf")).toBeInTheDocument();
    expect(screen.getByText(/4 sections detected/i)).toBeInTheDocument();
  });

  it("shows Generate Audio button", () => {
    render(<AudioPanel {...BASE} status="idle" />);
    expect(screen.getByRole("button", { name: /generate audio/i })).toBeInTheDocument();
  });

  it("calls onGenerate when clicked", () => {
    const onGenerate = jest.fn();
    render(<AudioPanel {...BASE} status="idle" onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole("button", { name: /generate audio/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("uses singular 'section' when totalSections is 1", () => {
    render(<AudioPanel {...BASE} status="idle" totalSections={1} />);
    expect(screen.getByText(/1 section detected/i)).toBeInTheDocument();
  });
});

// ── Processing state ────────────────────────────────────────────────────────
describe("processing state", () => {
  it("shows progress percentage and status label", () => {
    render(
      <AudioPanel
        {...BASE}
        status="processing"
        progress={42}
        statusLabel="Generating audio — section 2 of 4…"
      />
    );
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText(/section 2 of 4/i)).toBeInTheDocument();
  });

  it("shows a spinner", () => {
    render(<AudioPanel {...BASE} status="processing" progress={10} statusLabel="…" />);
    expect(screen.getByText(/working/i)).toBeInTheDocument();
  });
});

// ── Ready state — download ───────────────────────────────────────────────────
describe("ready state — download", () => {
  it("shows a Download link with the correct href and filename", () => {
    render(<AudioPanel {...READY_PROPS} />);
    const link = screen.getByRole("link", { name: /download/i });
    expect(link).toHaveAttribute("href", "blob:mock-url");
    expect(link).toHaveAttribute("download", "example.mp3");
  });

  it("strips .pdf from the download filename", () => {
    render(<AudioPanel {...READY_PROPS} pdfName="my-book.pdf" />);
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
      "download", "my-book.mp3"
    );
  });
});

// ── Ready state — player controls ───────────────────────────────────────────
describe("ready state — player", () => {
  it("shows a loading indicator while decoding", () => {
    // Stall decode so we can observe the loading state
    mockDecodeAudioData.mockReturnValueOnce(new Promise(() => {}));
    render(<AudioPanel {...READY_PROPS} />);
    expect(screen.getByText(/preparing audio/i)).toBeInTheDocument();
  });

  it("renders Play, Stop, and a seek bar after decoding", async () => {
    render(<AudioPanel {...READY_PROPS} />);
    await waitForPlayer();
    expect(screen.getByTitle("Play")).toBeInTheDocument();
    expect(screen.getByTitle("Stop")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /seek/i })).toBeInTheDocument();
  });

  it("calls AudioBufferSourceNode.start() when Play is clicked", async () => {
    render(<AudioPanel {...READY_PROPS} />);
    await waitForPlayer();
    fireEvent.click(screen.getByTitle("Play"));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("shows Pause button after clicking Play", async () => {
    render(<AudioPanel {...READY_PROPS} />);
    await waitForPlayer();
    fireEvent.click(screen.getByTitle("Play"));
    expect(screen.getByTitle("Pause")).toBeInTheDocument();
  });

  it("calls stop() and shows Play button again when Pause is clicked", async () => {
    render(<AudioPanel {...READY_PROPS} />);
    await waitForPlayer();
    fireEvent.click(screen.getByTitle("Play"));
    fireEvent.click(screen.getByTitle("Pause"));
    expect(mockStop).toHaveBeenCalled();
    expect(screen.getByTitle("Play")).toBeInTheDocument();
  });

  it("calls stop() and resets time display when Stop is clicked", async () => {
    render(<AudioPanel {...READY_PROPS} />);
    await waitForPlayer();
    fireEvent.click(screen.getByTitle("Play"));
    fireEvent.click(screen.getByTitle("Stop"));
    expect(mockStop).toHaveBeenCalled();
    expect(screen.getAllByText("0:00").length).toBeGreaterThanOrEqual(1);
  });

  it("does not throw when the seek bar is moved", async () => {
    render(<AudioPanel {...READY_PROPS} />);
    await waitForPlayer();
    const slider = screen.getByRole("slider", { name: /seek/i });
    expect(() =>
      fireEvent.change(slider, { target: { value: "45" } })
    ).not.toThrow();
  });

  it("shows 0:00 time display initially", async () => {
    render(<AudioPanel {...READY_PROPS} />);
    await waitForPlayer();
    const times = screen.getAllByText("0:00");
    expect(times.length).toBeGreaterThanOrEqual(1);
  });

  it("shows an error message if audio decoding fails", async () => {
    mockDecodeAudioData.mockRejectedValueOnce(new Error("Invalid audio data"));
    render(<AudioPanel {...READY_PROPS} />);
    await waitFor(() =>
      expect(screen.getByText(/could not decode/i)).toBeInTheDocument()
    );
  });
});

// ── Error state ──────────────────────────────────────────────────────────────
describe("error state", () => {
  it("shows Retry button and the error message", () => {
    render(
      <AudioPanel {...BASE} status="error" statusLabel="TTS request failed" />
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText("TTS request failed")).toBeInTheDocument();
  });

  it("calls onGenerate when Retry is clicked", () => {
    const onGenerate = jest.fn();
    render(
      <AudioPanel {...BASE} status="error" statusLabel="Error" onGenerate={onGenerate} />
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});
