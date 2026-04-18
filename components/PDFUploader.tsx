"use client";

import { useRef, useState, DragEvent } from "react";
import { UploadCloud, FileText, X } from "lucide-react";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export default function PDFUploader({ onFile, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function handleFile(file: File) {
    if (file.type !== "application/pdf") {
      alert("Please upload a PDF file.");
      return;
    }
    setSelectedFile(file);
    onFile(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function clear() {
    setSelectedFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="w-full">
      {!selectedFile ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !disabled && inputRef.current?.click()}
          className={`
            relative flex flex-col items-center justify-center gap-3
            border-2 border-dashed rounded-2xl p-10 cursor-pointer
            transition-colors duration-200
            ${dragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50"}
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          `}
        >
          <UploadCloud className="w-12 h-12 text-slate-400" />
          <p className="text-slate-600 font-medium text-lg">Drop your PDF here</p>
          <p className="text-slate-400 text-sm">or click to browse</p>
          <p className="text-slate-300 text-xs mt-1">English text only — images and tables will be described by AI</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            disabled={disabled}
          />
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
          <FileText className="w-8 h-8 text-blue-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-800 truncate">{selectedFile.name}</p>
            <p className="text-sm text-slate-400">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
          {!disabled && (
            <button
              onClick={clear}
              className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              title="Remove file"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
