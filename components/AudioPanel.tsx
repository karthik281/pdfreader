"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  Download, FileAudio, Loader2, AlertCircle, RefreshCw,
  Play, Pause, Square,
} from "lucide-react";

export type AudioStatus = "idle" | "processing" | "ready" | "error";

interface Props {
  status: AudioStatus;
  progress: number;
  statusLabel: string;
  audioUrl?: string;
  pdfName: string;
  totalSections: number;
  onGenerate: () => void;
}

function fmt(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AudioPanel({
  status,
  progress,
  statusLabel,
  audioUrl,
  pdfName,
  totalSections,
  onGenerate,
}: Props) {
  // ── Web Audio API refs ────────────────────────────────────────────────────
  // Using AudioContext + AudioBufferSourceNode avoids HTMLMediaElement's
  // "no supported sources" error entirely. decodeAudioData handles any valid
  // audio format and throws a clear error if the data is corrupt.
  const ctxRef    = useRef<AudioContext | null>(null);
  const bufRef    = useRef<AudioBuffer | null>(null);
  const srcRef    = useRef<AudioBufferSourceNode | null>(null);
  const startRef  = useRef(0);   // ctx.currentTime when current segment started
  const offsetRef = useRef(0);   // seconds into the buffer we started from
  const durationRef = useRef(0); // mirrors duration state, accessible in rAF
  const rafRef    = useRef(0);

  const [decoding, setDecoding]       = useState(false);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [ready, setReady]             = useState(false);
  const [playing, setPlaying]         = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]       = useState(0);

  // Keep durationRef in sync so the rAF callback can read it without a stale closure
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // ── Decode audio whenever the blob URL changes ────────────────────────────
  useEffect(() => {
    // Tear down previous instance
    cancelAnimationFrame(rafRef.current);
    if (srcRef.current) { try { srcRef.current.stop(); } catch { /* already stopped */ } srcRef.current = null; }
    if (ctxRef.current) { ctxRef.current.close(); ctxRef.current = null; }
    bufRef.current    = null;
    offsetRef.current = 0;
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setReady(false);
    setDecodeError(null);

    if (!audioUrl) return;

    setDecoding(true);
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    fetch(audioUrl)
      .then((r) => r.arrayBuffer())
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        if (ctxRef.current !== ctx) return; // effect was cleaned up
        bufRef.current = buf;
        durationRef.current = buf.duration;
        setDuration(buf.duration);
        setReady(true);
        setDecoding(false);
      })
      .catch((err) => {
        if (ctxRef.current !== ctx) return;
        console.error("[AudioPanel] decodeAudioData failed:", err);
        setDecodeError(
          "Could not decode the audio. The MP3 data may be corrupt — try regenerating."
        );
        setDecoding(false);
      });

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (srcRef.current) { try { srcRef.current.stop(); } catch { /* already stopped */ } srcRef.current = null; }
      ctx.close();
    };
  }, [audioUrl]);

  // ── rAF loop: track playhead position and detect natural end ─────────────
  useEffect(() => {
    if (!playing) return;

    const tick = () => {
      const ctx = ctxRef.current;
      if (!ctx) return;

      const pos = offsetRef.current + (ctx.currentTime - startRef.current);

      if (pos >= durationRef.current) {
        // Natural end — reset to beginning
        offsetRef.current = 0;
        setCurrentTime(0);
        setPlaying(false);
        return; // stop the loop; setPlaying triggers this effect cleanup
      }

      setCurrentTime(pos);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Builds a new AudioBufferSourceNode from the current buffer. */
  const makeSource = useCallback((): AudioBufferSourceNode | null => {
    const ctx = ctxRef.current;
    const buf = bufRef.current;
    if (!ctx || !buf) return null;
    if (ctx.state === "suspended") ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    return src;
  }, []);

  const handlePlay = useCallback(() => {
    const src = makeSource();
    if (!src) return;

    const from = Math.min(offsetRef.current, durationRef.current);
    src.start(0, from);
    startRef.current  = ctxRef.current!.currentTime;
    offsetRef.current = from;
    srcRef.current    = src;
    setPlaying(true);
  }, [makeSource]);

  const handlePause = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !srcRef.current) return;

    // Snapshot position before stopping
    const elapsed = ctx.currentTime - startRef.current;
    offsetRef.current = Math.min(offsetRef.current + elapsed, durationRef.current);

    try { srcRef.current.stop(); } catch { /* already stopped */ }
    srcRef.current = null;
    setPlaying(false);
  }, []);

  const handleStop = useCallback(() => {
    try { srcRef.current?.stop(); } catch { /* already stopped */ }
    srcRef.current    = null;
    offsetRef.current = 0;
    setPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t        = parseFloat(e.target.value);
    const wasPlaying = playing;

    if (wasPlaying) {
      try { srcRef.current?.stop(); } catch { /* already stopped */ }
      srcRef.current = null;
      setPlaying(false);
    }

    offsetRef.current = t;
    setCurrentTime(t);

    if (wasPlaying) {
      const src = makeSource();
      if (!src) return;
      src.start(0, t);
      startRef.current = ctxRef.current!.currentTime;
      srcRef.current   = src;
      setPlaying(true);
    }
  }, [playing, makeSource]);

  const downloadName = pdfName.replace(/\.pdf$/i, "") + ".mp3";
  const seekPercent  = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">

      {/* ── Top strip ── */}
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 truncate">{pdfName}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {totalSections} section{totalSections !== 1 ? "s" : ""} detected
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {status === "ready" && audioUrl && (
            <a
              href={audioUrl}
              download={downloadName}
              title="Download MP3"
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition-colors"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
          )}

          {status === "idle" && (
            <button
              onClick={onGenerate}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <FileAudio className="w-4 h-4" />
              Generate Audio
            </button>
          )}

          {status === "processing" && (
            <div className="flex items-center gap-2 text-blue-600 text-sm font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              Working…
            </div>
          )}

          {status === "error" && (
            <button
              onClick={onGenerate}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold rounded-xl transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          )}
        </div>
      </div>

      {/* ── Player ── */}
      {status === "ready" && audioUrl && (
        <div className="px-6 py-4 border-b border-slate-100">
          {decoding ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Preparing audio…
            </div>
          ) : decodeError ? (
            <div className="flex items-start gap-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{decodeError}</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {playing ? (
                <button
                  onClick={handlePause}
                  title="Pause"
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  <Pause className="w-4 h-4 fill-white" />
                </button>
              ) : (
                <button
                  onClick={handlePlay}
                  disabled={!ready}
                  title="Play"
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-white" />
                </button>
              )}

              <button
                onClick={handleStop}
                title="Stop"
                className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
              >
                <Square className="w-4 h-4 fill-slate-600" />
              </button>

              <div className="flex-1 flex items-center gap-2 min-w-0">
                <span className="text-xs text-slate-400 w-9 shrink-0 text-right">
                  {fmt(currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeek}
                  aria-label="Seek"
                  className="flex-1 h-1.5 accent-blue-600 cursor-pointer"
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
      )}

      {/* ── Status row ── */}
      <div className="px-6 py-4">
        {status === "processing" && (
          <>
            <div className="flex justify-between items-center mb-2">
              <p className="text-sm text-slate-500 truncate pr-4">{statusLabel}</p>
              <p className="text-sm font-semibold text-blue-600 shrink-0">{progress}%</p>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(2, progress)}%` }}
              />
            </div>
          </>
        )}

        {status === "idle" && (
          <p className="text-sm text-slate-400">
            Choose your voice settings above, then click{" "}
            <strong className="text-slate-600">Generate Audio</strong> to create a
            single MP3 for the entire PDF.
          </p>
        )}

        {status === "ready" && (
          <p className="text-sm text-slate-400">
            Use the player above to listen, or click{" "}
            <strong className="text-slate-600">Download</strong> to save the MP3.
          </p>
        )}

        {status === "error" && (
          <div className="flex items-start gap-2 text-red-600">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="text-sm">{statusLabel}</p>
          </div>
        )}
      </div>
    </div>
  );
}
