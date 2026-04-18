"use client";

import { useState, useCallback, useRef } from "react";
import PDFUploader from "@/components/PDFUploader";
import VoiceSelector from "@/components/VoiceSelector";
import AudioPanel, { type AudioStatus } from "@/components/AudioPanel";
import { parsePDF, detectChapters } from "@/lib/pdf-parser";
import { chunkText, mergeMP3sToBlob } from "@/lib/audio";
import type { Chapter, PageContent, VoiceSettings } from "@/types";
import { BookOpen, Loader2, XCircle, X } from "lucide-react";

const DEFAULT_VOICE: VoiceSettings = {
  gender: "FEMALE",
  voiceName: "en-US-JennyNeural",
  speakingRate: 1.0,
  pitch: 0,
};

interface AudioState {
  status: AudioStatus;
  progress: number;
  statusLabel: string;
  audioUrl?: string;
}

const IDLE_AUDIO: AudioState = {
  status: "idle",
  progress: 0,
  statusLabel: "",
};

export default function Home() {
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [allPages, setAllPages] = useState<PageContent[]>([]);
  const [pdfName, setPdfName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState({ current: 0, total: 0 });
  const [audio, setAudio] = useState<AudioState>(IDLE_AUDIO);
  const [error, setError] = useState<string | null>(null);
  const [documentContext, setDocumentContext] = useState<string | null>(null);

  const cancelRef = useRef(false);

  // -------------------------------------------------------------------------
  // PDF upload → parse → chapter detection (internal only)
  // -------------------------------------------------------------------------
  const handleFile = useCallback(async (file: File) => {
    setParsing(true);
    setChapters([]);
    setAllPages([]);
    setAudio(IDLE_AUDIO);
    setError(null);
    setDocumentContext(null);
    setPdfName(file.name);
    setParseProgress({ current: 0, total: 0 });

    try {
      const pages = await parsePDF(file, (current, total) =>
        setParseProgress({ current, total })
      );
      const detected = detectChapters(pages);
      setAllPages(pages);
      setChapters(detected);

      // Analyse the document style once — result is used to enrich TTS with SSML
      const sampleText = pages
        .slice(0, 5)
        .map((p) => p.text)
        .join("\n\n")
        .slice(0, 4000);

      if (sampleText.trim()) {
        try {
          const res = await fetch("/api/analyse-document", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sampleText }),
          });
          if (res.ok) {
            const { documentContext: ctx } = await res.json();
            setDocumentContext(ctx ?? null);
          }
        } catch {
          // Non-fatal — plain TTS still works without context
        }
      }
    } catch (err) {
      console.error("PDF parse error:", err);
      setError(
        "Failed to parse the PDF. Make sure it contains selectable text (not a scanned image)."
      );
    } finally {
      setParsing(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Generate a single MP3 for the entire PDF
  // -------------------------------------------------------------------------
  const handleGenerate = useCallback(async () => {
    if (!allPages.length || !chapters.length) return;

    cancelRef.current = false;
    setError(null);
    const usingSSML = !!documentContext;
    setAudio({ status: "processing", progress: 0, statusLabel: "Starting…" });

    try {
      const allAudioChunks: string[] = [];
      const totalSections = chapters.length;

      for (let sIdx = 0; sIdx < totalSections; sIdx++) {
        if (cancelRef.current) break;

        const chapter = chapters[sIdx];

        // --- Step 1: describe any image-heavy pages in this section ---
        const sectionPages = allPages.filter(
          (p) => p.pageNumber >= chapter.pageStart && p.pageNumber <= chapter.pageEnd
        );

        let sectionText = "";
        for (const page of sectionPages) {
          if (cancelRef.current) break;

          if (page.hasImages && page.imageDataUrl) {
            setAudio({
              status: "processing",
              progress: sectionProgress(sIdx, totalSections, 0),
              statusLabel: `Describing images on page ${page.pageNumber}…`,
            });

            const res = await fetch("/api/describe-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageDataUrl: page.imageDataUrl,
                pageNumber: page.pageNumber,
              }),
            });
            if (res.ok) {
              const { description } = await res.json();
              sectionText += "\n\n" + description;
            } else {
              sectionText += `\n\nImage on page ${page.pageNumber} could not be described.`;
            }
          } else if (page.text.trim()) {
            sectionText += "\n\n" + page.text;
          }
        }

        sectionText = sectionText.trim();
        if (!sectionText) continue;

        // --- Step 2: synthesise this section's text to audio ---
        const textChunks = chunkText(sectionText);

        for (let cIdx = 0; cIdx < textChunks.length; cIdx++) {
          if (cancelRef.current) break;

          const chunkProgress = (cIdx + 1) / textChunks.length;
          setAudio({
            status: "processing",
            progress: sectionProgress(sIdx, totalSections, chunkProgress),
            statusLabel: usingSSML
              ? `Enhancing intonation — section ${sIdx + 1} of ${totalSections}…`
              : `Generating audio — section ${sIdx + 1} of ${totalSections}…`,
          });

          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: textChunks[cIdx],
              voiceName: voiceSettings.voiceName,
              speakingRate: voiceSettings.speakingRate,
              pitch: voiceSettings.pitch,
              ...(documentContext ? { documentContext } : {}),
            }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail ?? "TTS request failed");
          }

          const { audioContent } = await res.json();
          allAudioChunks.push(audioContent);
        }
      }

      if (cancelRef.current) {
        setAudio(IDLE_AUDIO);
        return;
      }

      // --- Step 3: merge every chunk from every section into one MP3 ---
      const audioUrl = mergeMP3sToBlob(allAudioChunks);
      setAudio({ status: "ready", progress: 100, statusLabel: "Ready", audioUrl });
    } catch (err) {
      console.error("Audio generation error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setAudio({ status: "error", progress: 0, statusLabel: msg });
      setError(`Audio generation failed: ${msg}`);
    }
  }, [allPages, chapters, voiceSettings, documentContext]);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const isGenerating = audio.status === "processing";
  const hasPdf = chapters.length > 0 && !parsing;

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-blue-600" />
          <div>
            <h1 className="font-bold text-slate-900 text-lg leading-tight">PDF to Audio</h1>
            <p className="text-xs text-slate-400">Convert any PDF to a downloadable MP3</p>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Error banner */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl px-4 py-3">
            <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm flex-1">{error}</p>
            <button onClick={() => setError(null)} className="shrink-0 hover:text-red-900">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Upload + Voice */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <PDFUploader onFile={handleFile} disabled={parsing || isGenerating} />
          </div>
          <div>
            <VoiceSelector
              settings={voiceSettings}
              onChange={setVoiceSettings}
              disabled={isGenerating}
            />
          </div>
        </div>

        {/* Parse progress */}
        {parsing && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              <p className="text-sm font-medium text-slate-700">
                Reading PDF… page {parseProgress.current} of {parseProgress.total}
              </p>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{
                  width: parseProgress.total
                    ? `${(parseProgress.current / parseProgress.total) * 100}%`
                    : "5%",
                }}
              />
            </div>
          </div>
        )}

        {/* Audio panel — shown once PDF is loaded */}
        {hasPdf && (
          <AudioPanel
            pdfName={pdfName}
            totalSections={chapters.length}
            status={audio.status}
            progress={audio.progress}
            statusLabel={audio.statusLabel}
            audioUrl={audio.audioUrl}
            onGenerate={handleGenerate}
          />
        )}

        {/* Empty state */}
        {!parsing && !hasPdf && (
          <div className="text-center py-16">
            <BookOpen className="w-16 h-16 mx-auto mb-4 text-slate-200" />
            <p className="text-lg font-medium text-slate-400">Upload a PDF to get started</p>
            <p className="text-sm mt-1 text-slate-300">
              The entire PDF is converted into one MP3 file
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

/** Compute overall progress (0–100) given how far through section sIdx we are. */
function sectionProgress(
  sIdx: number,
  total: number,
  sectionFraction: number
): number {
  return Math.round(((sIdx + sectionFraction) / total) * 100);
}
