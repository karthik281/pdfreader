"use client";

import {
  useRef, useState, useEffect, useCallback, useReducer,
} from "react";
import {
  ArrowLeft, SkipBack, Play, Pause, SkipForward, Mic, MicOff,
  Send, Loader2, Globe, GlobeOff, AlertCircle, Volume2,
} from "lucide-react";
import { chunkText, mergeMP3sToBlob } from "@/lib/audio";
import type { Chapter, PageContent, VoiceSettings, ChatMessage } from "@/types";

interface Props {
  chapters: Chapter[];
  allPages: PageContent[];
  voiceSettings: VoiceSettings;
  pdfName: string;
  onExit: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/** Keywords that map directly to player controls instead of chat. */
const COMMANDS: Record<string, string> = {
  pause: "pause", stop: "pause",
  play: "play", resume: "play", continue: "play",
  next: "next", skip: "next", forward: "next",
  back: "prev", previous: "prev", rewind: "prev",
};

function parseVoiceCommand(text: string): string | null {
  const lower = text.toLowerCase().trim().replace(/[.!?]$/, "");
  return COMMANDS[lower] ?? null;
}

// ── Reducer for audio playback state ──────────────────────────────────────

type PlayState = "idle" | "loading" | "playing" | "paused" | "error" | "done";

interface AudioState {
  playState: PlayState;
  sectionIdx: number;
  currentTime: number;
  duration: number;
  errorMsg: string | null;
}

type AudioAction =
  | { type: "START_LOAD";  sectionIdx: number }
  | { type: "LOADED";      duration: number }
  | { type: "PLAYING" }
  | { type: "PAUSED" }
  | { type: "TICK";        currentTime: number }
  | { type: "SECTION_END" }
  | { type: "DONE" }
  | { type: "ERROR";       msg: string }
  | { type: "RESET" };

function audioReducer(state: AudioState, action: AudioAction): AudioState {
  switch (action.type) {
    case "START_LOAD":
      return { ...state, playState: "loading", sectionIdx: action.sectionIdx, currentTime: 0, duration: 0, errorMsg: null };
    case "LOADED":
      return { ...state, duration: action.duration };
    case "PLAYING":
      return { ...state, playState: "playing" };
    case "PAUSED":
      return { ...state, playState: "paused" };
    case "TICK":
      return { ...state, currentTime: action.currentTime };
    case "SECTION_END":
      return { ...state, currentTime: 0, duration: 0 };
    case "DONE":
      return { ...state, playState: "done", currentTime: 0 };
    case "ERROR":
      return { ...state, playState: "error", errorMsg: action.msg };
    case "RESET":
      return { playState: "idle", sectionIdx: 0, currentTime: 0, duration: 0, errorMsg: null };
    default:
      return state;
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function LiveReader({
  chapters,
  allPages,
  voiceSettings,
  pdfName,
  onExit,
}: Props) {
  // ── Playback ─────────────────────────────────────────────────────────────
  const [audio, dispatch] = useReducer(audioReducer, {
    playState: "idle", sectionIdx: 0, currentTime: 0, duration: 0, errorMsg: null,
  });

  const ctxRef     = useRef<AudioContext | null>(null);
  const srcRef     = useRef<AudioBufferSourceNode | null>(null);
  const bufRef     = useRef<AudioBuffer | null>(null);
  const offsetRef  = useRef(0);
  const startRef   = useRef(0);
  const durationRef = useRef(0);
  const rafRef     = useRef(0);
  // Tracks whether the section ended naturally vs being stopped manually
  const naturalEndRef = useRef(false);
  // Tracks the latest sectionIdx so the onended handler can read it without stale closure
  const sectionIdxRef = useRef(0);
  sectionIdxRef.current = audio.sectionIdx;

  // ── Chat ──────────────────────────────────────────────────────────────────
  const [messages, setMessages]       = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]     = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [webSearch, setWebSearch]     = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Voice input ───────────────────────────────────────────────────────────
  const [recording, setRecording]       = useState(false);
  const [sttLoading, setSttLoading]     = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);

  // ── Document context for chat (first ~12k chars of PDF text) ─────────────
  const documentContext = allPages.map((p) => p.text).join("\n\n").slice(0, 12_000);

  // ── Section text helper ───────────────────────────────────────────────────
  const getSectionText = useCallback((idx: number): string => {
    const ch = chapters[idx];
    if (!ch) return "";
    return allPages
      .filter((p) => p.pageNumber >= ch.pageStart && p.pageNumber <= ch.pageEnd)
      .map((p) => p.text)
      .join("\n\n")
      .trim();
  }, [chapters, allPages]);

  // ── Audio engine ──────────────────────────────────────────────────────────

  const stopCurrentSource = useCallback((isManualStop = true) => {
    cancelAnimationFrame(rafRef.current);
    if (srcRef.current) {
      naturalEndRef.current = !isManualStop;
      try { srcRef.current.stop(); } catch { /* already stopped */ }
      srcRef.current = null;
    }
  }, []);

  const playBuffer = useCallback(() => {
    const ctx = ctxRef.current;
    const buf = bufRef.current;
    if (!ctx || !buf) return;
    if (ctx.state === "suspended") ctx.resume();

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);

    src.onended = () => {
      cancelAnimationFrame(rafRef.current);
      if (!naturalEndRef.current) return; // manual stop — don't auto-advance

      const next = sectionIdxRef.current + 1;
      if (next < chapters.length) {
        dispatch({ type: "SECTION_END" });
        // loadSection is called via the useEffect below
        dispatch({ type: "START_LOAD", sectionIdx: next });
      } else {
        dispatch({ type: "DONE" });
      }
    };

    const from = Math.min(offsetRef.current, durationRef.current);
    src.start(0, from);
    startRef.current = ctx.currentTime;
    offsetRef.current = from;
    srcRef.current = src;
    naturalEndRef.current = true;
    dispatch({ type: "PLAYING" });
  }, [chapters.length]);

  const loadSection = useCallback(async (idx: number) => {
    const text = getSectionText(idx);
    if (!text) {
      // Empty section — skip it
      const next = idx + 1;
      if (next < chapters.length) {
        dispatch({ type: "START_LOAD", sectionIdx: next });
      } else {
        dispatch({ type: "DONE" });
      }
      return;
    }

    try {
      const textChunks = chunkText(text);
      const b64Chunks: string[] = [];

      for (const chunk of textChunks) {
        const res = await fetch("/api/tts", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            text:         chunk,
            voiceName:    voiceSettings.voiceName,
            speakingRate: voiceSettings.speakingRate,
            pitch:        voiceSettings.pitch,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail ?? "TTS request failed");
        }
        const { audioContent } = await res.json();
        b64Chunks.push(audioContent);
      }

      const blobUrl  = mergeMP3sToBlob(b64Chunks);
      const response = await fetch(blobUrl);
      const ab       = await response.arrayBuffer();
      URL.revokeObjectURL(blobUrl);

      if (!ctxRef.current || ctxRef.current.state === "closed") {
        ctxRef.current = new AudioContext();
      }

      const buffer         = await ctxRef.current.decodeAudioData(ab);
      bufRef.current       = buffer;
      durationRef.current  = buffer.duration;
      offsetRef.current    = 0;
      dispatch({ type: "LOADED", duration: buffer.duration });
      playBuffer();
    } catch (err) {
      console.error("[LiveReader] loadSection failed:", err);
      dispatch({ type: "ERROR", msg: err instanceof Error ? err.message : "Audio failed" });
    }
  }, [chapters.length, getSectionText, voiceSettings, playBuffer]);

  // Auto-trigger loadSection whenever sectionIdx changes (and we're loading)
  useEffect(() => {
    if (audio.playState === "loading") {
      loadSection(audio.sectionIdx);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.sectionIdx, audio.playState]);

  // rAF loop for time tracking
  useEffect(() => {
    if (audio.playState !== "playing") return;
    const tick = () => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const pos = offsetRef.current + (ctx.currentTime - startRef.current);
      if (pos >= durationRef.current) return;
      dispatch({ type: "TICK", currentTime: pos });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [audio.playState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      stopCurrentSource(true);
      ctxRef.current?.close();
    };
  }, [stopCurrentSource]);

  // ── Playback controls ─────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    dispatch({ type: "START_LOAD", sectionIdx: 0 });
  }, []);

  const handlePlay = useCallback(() => {
    offsetRef.current = audio.currentTime;
    playBuffer();
  }, [audio.currentTime, playBuffer]);

  const handlePause = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx) {
      const elapsed = ctx.currentTime - startRef.current;
      offsetRef.current = Math.min(offsetRef.current + elapsed, durationRef.current);
    }
    stopCurrentSource(true);
    dispatch({ type: "PAUSED" });
  }, [stopCurrentSource]);

  const handleNext = useCallback(() => {
    stopCurrentSource(true);
    const next = audio.sectionIdx + 1;
    if (next < chapters.length) {
      dispatch({ type: "START_LOAD", sectionIdx: next });
    } else {
      dispatch({ type: "DONE" });
    }
  }, [audio.sectionIdx, chapters.length, stopCurrentSource]);

  const handlePrev = useCallback(() => {
    stopCurrentSource(true);
    const prev = Math.max(0, audio.sectionIdx - 1);
    dispatch({ type: "START_LOAD", sectionIdx: prev });
  }, [audio.sectionIdx, stopCurrentSource]);

  const handleRetry = useCallback(() => {
    dispatch({ type: "START_LOAD", sectionIdx: audio.sectionIdx });
  }, [audio.sectionIdx]);

  const handleJump = useCallback((idx: number) => {
    stopCurrentSource(true);
    dispatch({ type: "START_LOAD", sectionIdx: idx });
  }, [stopCurrentSource]);

  // ── Chat ──────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const userMsg = text.trim();
    if (!userMsg || chatLoading) return;

    const updated: ChatMessage[] = [...messages, { role: "user", content: userMsg }];
    setMessages(updated);
    setChatInput("");
    setChatLoading(true);

    // Placeholder for streaming assistant reply
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          message:         userMsg,
          documentContext,
          history:         messages.slice(-10),
          webSearch,
        }),
      });

      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? "Chat failed");
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let   partial = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        partial += decoder.decode(value, { stream: true });
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const { content } = JSON.parse(data) as { content?: string };
            if (content) {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  role:    "assistant",
                  content: next[next.length - 1].content + content,
                };
                return next;
              });
            }
          } catch { /* skip malformed line */ }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role:    "assistant",
          content: "Sorry, I couldn't answer that. Please try again.",
        };
        return next;
      });
    } finally {
      setChatLoading(false);
    }
  }, [chatLoading, documentContext, messages, webSearch]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Voice input ───────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob        = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
        const mimeType    = mr.mimeType || "audio/webm";
        setSttLoading(true);
        try {
          const res = await fetch("/api/stt", {
            method:  "POST",
            headers: { "Content-Type": mimeType },
            body:    blob,
          });
          if (!res.ok) throw new Error("STT failed");
          const { text } = await res.json();
          if (text?.trim()) {
            const cmd = parseVoiceCommand(text);
            if (cmd === "pause")  { handlePause(); }
            else if (cmd === "play") { if (audio.playState === "paused") handlePlay(); }
            else if (cmd === "next") { handleNext(); }
            else if (cmd === "prev") { handlePrev(); }
            else { sendMessage(text); }
          }
        } catch { /* ignore STT errors */ }
        finally { setSttLoading(false); }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      alert("Microphone access denied.");
    }
  }, [audio.playState, handlePause, handlePlay, handleNext, handlePrev, sendMessage]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }, []);

  // ── Derived UI values ─────────────────────────────────────────────────────

  const { playState, sectionIdx, currentTime, duration, errorMsg } = audio;
  const chapter      = chapters[sectionIdx];
  const seekPercent  = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isActive     = playState !== "idle" && playState !== "done";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <Volume2 className="w-4 h-4 text-blue-500 shrink-0" />
        <p className="font-medium text-slate-700 text-sm truncate">{pdfName} — Live Read</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

          {/* ── Section card ── */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">

            {/* Section title */}
            <div className="px-5 py-4 border-b border-slate-100">
              <p className="text-xs text-slate-400 mb-0.5">
                Section {sectionIdx + 1} of {chapters.length}
              </p>
              <p className="font-semibold text-slate-800 truncate">
                {chapter?.title ?? "—"}
              </p>
            </div>

            {/* Controls */}
            <div className="px-5 py-4 space-y-3">
              {playState === "idle" && (
                <div className="flex justify-center">
                  <button
                    onClick={handleStart}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    Start Reading
                  </button>
                </div>
              )}

              {playState === "done" && (
                <div className="flex justify-center">
                  <p className="text-sm text-slate-400">All sections read.</p>
                </div>
              )}

              {playState === "error" && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={handleRetry}
                      className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-medium rounded-xl transition-colors"
                    >
                      Retry section
                    </button>
                    {sectionIdx + 1 < chapters.length && (
                      <button
                        onClick={handleNext}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-xl transition-colors"
                      >
                        Skip to next
                      </button>
                    )}
                  </div>
                </div>
              )}

              {isActive && playState !== "error" && (
                <div className="space-y-3">
                  {/* Transport */}
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={handlePrev}
                      disabled={sectionIdx === 0}
                      title="Previous section"
                      className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors disabled:opacity-40"
                    >
                      <SkipBack className="w-4 h-4" />
                    </button>

                    {playState === "loading" ? (
                      <div className="w-11 h-11 flex items-center justify-center rounded-full bg-blue-600 text-white">
                        <Loader2 className="w-5 h-5 animate-spin" />
                      </div>
                    ) : playState === "playing" ? (
                      <button
                        onClick={handlePause}
                        title="Pause"
                        className="w-11 h-11 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                      >
                        <Pause className="w-5 h-5 fill-white" />
                      </button>
                    ) : (
                      <button
                        onClick={handlePlay}
                        disabled={playState === "loading"}
                        title="Play"
                        className="w-11 h-11 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                      >
                        <Play className="w-5 h-5 fill-white" />
                      </button>
                    )}

                    <button
                      onClick={handleNext}
                      disabled={sectionIdx >= chapters.length - 1}
                      title="Next section"
                      className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors disabled:opacity-40"
                    >
                      <SkipForward className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Seek bar */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-9 text-right shrink-0">
                      {fmt(currentTime)}
                    </span>
                    <div
                      className="flex-1 h-1.5 rounded-full"
                      style={{
                        background: `linear-gradient(to right, #2563eb ${seekPercent}%, #e2e8f0 ${seekPercent}%)`,
                      }}
                    />
                    <span className="text-xs text-slate-400 w-9 shrink-0">
                      {fmt(duration)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Section jump menu */}
            {isActive && chapters.length > 1 && (
              <div className="px-5 pb-4">
                <select
                  value={sectionIdx}
                  onChange={(e) => handleJump(Number(e.target.value))}
                  className="w-full text-xs text-slate-600 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {chapters.map((ch, i) => (
                    <option key={ch.id} value={i}>
                      {i + 1}. {ch.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* ── Chat panel ── */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Ask about this document</p>
              <button
                onClick={() => setWebSearch((v) => !v)}
                title={webSearch ? "Web search on (click to disable)" : "Enable web search"}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-colors ${
                  webSearch
                    ? "bg-blue-100 text-blue-700 font-medium"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {webSearch ? <Globe className="w-3.5 h-3.5" /> : <GlobeOff className="w-3.5 h-3.5" />}
                {webSearch ? "Web on" : "Web off"}
              </button>
            </div>

            {/* Message history */}
            {messages.length > 0 && (
              <div className="px-5 py-3 space-y-3 max-h-72 overflow-y-auto border-b border-slate-100">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3.5 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {msg.content || (
                        <Loader2 className="w-3.5 h-3.5 animate-spin opacity-60" />
                      )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}

            {/* Input row */}
            <div className="px-4 py-3 flex items-center gap-2">
              {/* Voice button */}
              <button
                onClick={recording ? stopRecording : startRecording}
                disabled={sttLoading}
                title={recording ? "Stop recording" : "Ask with voice"}
                className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors shrink-0 ${
                  recording
                    ? "bg-red-500 hover:bg-red-600 text-white animate-pulse"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                }`}
              >
                {sttLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : recording ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>

              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(chatInput); } }}
                placeholder="Ask a question or type a command…"
                className="flex-1 text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
              />

              <button
                onClick={() => sendMessage(chatInput)}
                disabled={!chatInput.trim() || chatLoading}
                title="Send"
                className="w-9 h-9 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 shrink-0"
              >
                {chatLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
