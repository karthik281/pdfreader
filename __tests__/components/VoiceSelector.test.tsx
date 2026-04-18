import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import VoiceSelector from "@/components/VoiceSelector";
import { VOICE_OPTIONS } from "@/types";
import type { VoiceSettings } from "@/types";

const DEFAULT_SETTINGS: VoiceSettings = {
  gender: "FEMALE",
  voiceName: "en-US-JennyNeural",
  speakingRate: 1.0,
  pitch: 0,
};

describe("VoiceSelector", () => {
  it("renders the gender toggle buttons", () => {
    render(<VoiceSelector settings={DEFAULT_SETTINGS} onChange={jest.fn()} />);
    expect(screen.getByText("Male")).toBeInTheDocument();
    expect(screen.getByText("Female")).toBeInTheDocument();
  });

  it("shows female voices when gender is FEMALE", () => {
    render(<VoiceSelector settings={DEFAULT_SETTINGS} onChange={jest.fn()} />);
    const select = screen.getByRole("combobox");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    const expectedVoices = VOICE_OPTIONS.FEMALE.map((v) => v.name);
    expect(options).toEqual(expectedVoices);
  });

  it("shows male voices when gender is MALE", () => {
    const maleSettings: VoiceSettings = {
      ...DEFAULT_SETTINGS,
      gender: "MALE",
      voiceName: "en-US-GuyNeural",
    };
    render(<VoiceSelector settings={maleSettings} onChange={jest.fn()} />);
    const select = screen.getByRole("combobox");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    const expectedVoices = VOICE_OPTIONS.MALE.map((v) => v.name);
    expect(options).toEqual(expectedVoices);
  });

  it("calls onChange with MALE gender and first male voice when Male is clicked", () => {
    const onChange = jest.fn();
    render(<VoiceSelector settings={DEFAULT_SETTINGS} onChange={onChange} />);
    fireEvent.click(screen.getByText("Male"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        gender: "MALE",
        voiceName: VOICE_OPTIONS.MALE[0].name,
      })
    );
  });

  it("calls onChange when a different voice is selected", () => {
    const onChange = jest.fn();
    render(<VoiceSelector settings={DEFAULT_SETTINGS} onChange={onChange} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "en-US-AriaNeural" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voiceName: "en-US-AriaNeural" })
    );
  });

  it("calls onChange when speaking rate is changed", () => {
    const onChange = jest.fn();
    render(<VoiceSelector settings={DEFAULT_SETTINGS} onChange={onChange} />);
    const [rateSlider] = screen.getAllByRole("slider");
    fireEvent.change(rateSlider, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ speakingRate: 1.5 })
    );
  });

  it("disables all controls when disabled prop is true", () => {
    render(<VoiceSelector settings={DEFAULT_SETTINGS} onChange={jest.fn()} disabled />);
    screen.getAllByRole("button").forEach((btn) => expect(btn).toBeDisabled());
    expect(screen.getByRole("combobox")).toBeDisabled();
    screen.getAllByRole("slider").forEach((slider) => expect(slider).toBeDisabled());
  });
});
