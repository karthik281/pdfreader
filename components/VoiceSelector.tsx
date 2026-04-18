"use client";

import { VoiceSettings, VOICE_OPTIONS } from "@/types";

interface Props {
  settings: VoiceSettings;
  onChange: (settings: VoiceSettings) => void;
  disabled?: boolean;
}

export default function VoiceSelector({ settings, onChange, disabled }: Props) {
  const voices = VOICE_OPTIONS[settings.gender];

  function update(partial: Partial<VoiceSettings>) {
    const next = { ...settings, ...partial };
    // Reset voice name when gender changes
    if (partial.gender && partial.gender !== settings.gender) {
      next.voiceName = VOICE_OPTIONS[partial.gender][0].name;
    }
    onChange(next);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
      <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide">Voice Settings</h3>

      {/* Gender */}
      <div>
        <label className="text-xs text-slate-500 mb-1 block">Gender</label>
        <div className="flex gap-2">
          {(["MALE", "FEMALE"] as const).map((g) => (
            <button
              key={g}
              disabled={disabled}
              onClick={() => update({ gender: g })}
              className={`
                flex-1 py-2 rounded-xl text-sm font-medium transition-colors
                ${settings.gender === g
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"}
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
              `}
            >
              {g === "MALE" ? "Male" : "Female"}
            </button>
          ))}
        </div>
      </div>

      {/* Voice */}
      <div>
        <label className="text-xs text-slate-500 mb-1 block">Voice</label>
        <select
          disabled={disabled}
          value={settings.voiceName}
          onChange={(e) => update({ voiceName: e.target.value })}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
        >
          {voices.map((v) => (
            <option key={v.name} value={v.name}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Speed */}
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-xs text-slate-500">Speaking Speed</label>
          <span className="text-xs font-medium text-slate-700">{settings.speakingRate.toFixed(1)}x</span>
        </div>
        <input
          type="range" min="0.5" max="2.0" step="0.1"
          disabled={disabled}
          value={settings.speakingRate}
          onChange={(e) => update({ speakingRate: parseFloat(e.target.value) })}
          className="w-full accent-blue-600 disabled:opacity-50"
        />
        <div className="flex justify-between text-xs text-slate-300 mt-0.5">
          <span>0.5x</span><span>Normal</span><span>2.0x</span>
        </div>
      </div>

      {/* Pitch */}
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-xs text-slate-500">Pitch</label>
          <span className="text-xs font-medium text-slate-700">{settings.pitch > 0 ? "+" : ""}{settings.pitch}</span>
        </div>
        <input
          type="range" min="-10" max="10" step="1"
          disabled={disabled}
          value={settings.pitch}
          onChange={(e) => update({ pitch: parseInt(e.target.value) })}
          className="w-full accent-blue-600 disabled:opacity-50"
        />
        <div className="flex justify-between text-xs text-slate-300 mt-0.5">
          <span>Lower</span><span>Normal</span><span>Higher</span>
        </div>
      </div>
    </div>
  );
}
