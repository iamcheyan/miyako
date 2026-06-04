export type NativeAudioEventType =
  | "play"
  | "pause"
  | "stop"
  | "ended"
  | "error"
  | "loadedmetadata"
  | "nexttrack"
  | "previoustrack";

export interface NativeAudioEventDetail {
  type: NativeAudioEventType;
  duration?: number;
}

interface AndroidRadioAudioBridge {
  play(path: string): void;
  pause(): void;
  resume(): void;
  stop(): void;
  seekTo(seconds: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  isPlaying(): boolean;
}

declare global {
  interface Window {
    AndroidRadioAudio?: AndroidRadioAudioBridge;
  }
}

export function isAndroidNativeAudioAvailable(): boolean {
  return typeof window.AndroidRadioAudio !== "undefined";
}

export function playNativeAudio(path: string): void {
  window.AndroidRadioAudio?.play(path);
}

export function pauseNativeAudio(): void {
  window.AndroidRadioAudio?.pause();
}

export function resumeNativeAudio(): void {
  window.AndroidRadioAudio?.resume();
}

export function stopNativeAudio(): void {
  window.AndroidRadioAudio?.stop();
}

export function seekNativeAudio(seconds: number): void {
  window.AndroidRadioAudio?.seekTo(seconds);
}

export function getNativeCurrentTime(): number {
  return window.AndroidRadioAudio?.getCurrentTime() ?? 0;
}

export function getNativeDuration(): number {
  return window.AndroidRadioAudio?.getDuration() ?? 0;
}

export function isNativePlaying(): boolean {
  return window.AndroidRadioAudio?.isPlaying() ?? false;
}

export function bindNativeAudioEvents(
  handler: (detail: NativeAudioEventDetail) => void,
): () => void {
  const listener = (event: Event) => {
    const custom = event as CustomEvent<NativeAudioEventDetail>;
    if (!custom.detail?.type) return;
    handler(custom.detail);
  };

  window.addEventListener("android-native-audio", listener);
  return () => window.removeEventListener("android-native-audio", listener);
}
