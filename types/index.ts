export interface PageContent {
  pageNumber: number;
  text: string;
  hasImages: boolean;
  imageDataUrl?: string;
}

export interface Chapter {
  id: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  content: string;
  status: ChapterStatus;
  audioUrl?: string;
  progress?: number;
}

export type ChapterStatus =
  | "idle"
  | "describing_images"
  | "generating_audio"
  | "ready"
  | "error";

export interface VoiceSettings {
  gender: "MALE" | "FEMALE";
  voiceName: string;
  speakingRate: number; // 0.5 – 2.0
  pitch: number;        // -10 to +10 semitones
}

export const VOICE_OPTIONS: Record<"MALE" | "FEMALE", { name: string; label: string }[]> = {
  MALE: [
    { name: "en-US-GuyNeural",   label: "Guy (Neutral)" },
    { name: "en-US-DavisNeural", label: "Davis (Casual)" },
    { name: "en-US-EricNeural",  label: "Eric (Warm)" },
    { name: "en-US-JasonNeural", label: "Jason (Deep)" },
  ],
  FEMALE: [
    { name: "en-US-JennyNeural",    label: "Jenny (Friendly)" },
    { name: "en-US-AriaNeural",     label: "Aria (Natural)" },
    { name: "en-US-MichelleNeural", label: "Michelle (Warm)" },
    { name: "en-US-MonicaNeural",   label: "Monica (Clear)" },
  ],
};
