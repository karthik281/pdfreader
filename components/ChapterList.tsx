"use client";

import { Chapter } from "@/types";
import { Download, Loader2, CheckCircle2, AlertCircle, Play, FileAudio } from "lucide-react";

interface Props {
  chapters: Chapter[];
  onGenerateChapter: (chapterId: string) => void;
  onGenerateAll: () => void;
  anyProcessing: boolean;
}

export default function ChapterList({ chapters, onGenerateChapter, onGenerateAll, anyProcessing }: Props) {
  const allReady = chapters.every((c) => c.status === "ready");
  const anyReady = chapters.some((c) => c.status === "ready");

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <h2 className="font-semibold text-slate-800">
            {chapters.length} {chapters.length === 1 ? "Section" : "Sections"} detected
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Generate audio per section or all at once</p>
        </div>
        <button
          disabled={anyProcessing || allReady}
          onClick={onGenerateAll}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {anyProcessing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileAudio className="w-4 h-4" />
          )}
          {allReady ? "All Generated" : "Generate All"}
        </button>
      </div>

      {/* Chapter rows */}
      <ul className="divide-y divide-slate-50">
        {chapters.map((chapter, idx) => (
          <ChapterRow
            key={chapter.id}
            chapter={chapter}
            index={idx + 1}
            onGenerate={() => onGenerateChapter(chapter.id)}
            anyProcessing={anyProcessing}
          />
        ))}
      </ul>
    </div>
  );
}

function ChapterRow({
  chapter,
  index,
  onGenerate,
  anyProcessing,
}: {
  chapter: Chapter;
  index: number;
  onGenerate: () => void;
  anyProcessing: boolean;
}) {
  const { status, progress, audioUrl, title, pageStart, pageEnd } = chapter;
  const isProcessing = status === "describing_images" || status === "generating_audio";
  const isReady = status === "ready";
  const isError = status === "error";
  const isIdle = status === "idle";

  function statusLabel() {
    if (status === "describing_images") return "Describing images…";
    if (status === "generating_audio") return `Generating audio… ${progress ?? 0}%`;
    if (status === "ready") return "Ready to download";
    if (status === "error") return "Error — try again";
    return `Pages ${pageStart}–${pageEnd}`;
  }

  return (
    <li className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors">
      {/* Index badge */}
      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-500 shrink-0">
        {index}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {isProcessing && (
            <div className="flex-1 max-w-xs">
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress ?? 5}%` }}
                />
              </div>
            </div>
          )}
          <p className={`text-xs ${isError ? "text-red-500" : isReady ? "text-green-600" : "text-slate-400"}`}>
            {statusLabel()}
          </p>
        </div>
      </div>

      {/* Status icon */}
      <div className="shrink-0">
        {isProcessing && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
        {isReady && <CheckCircle2 className="w-5 h-5 text-green-500" />}
        {isError && <AlertCircle className="w-5 h-5 text-red-400" />}
      </div>

      {/* Action button */}
      <div className="shrink-0">
        {isReady && audioUrl ? (
          <a
            href={audioUrl}
            download={`${title.replace(/[^a-z0-9]/gi, "_")}.mp3`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </a>
        ) : (
          <button
            disabled={isProcessing || anyProcessing}
            onClick={onGenerate}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
              ${isError
                ? "bg-red-50 text-red-600 hover:bg-red-100"
                : "bg-blue-50 text-blue-600 hover:bg-blue-100"}
              disabled:opacity-40 disabled:cursor-not-allowed
            `}
          >
            <Play className="w-3.5 h-3.5" />
            {isError ? "Retry" : "Generate"}
          </button>
        )}
      </div>
    </li>
  );
}
