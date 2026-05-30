// Owner bottom nav: tap sound + best-effort haptic feedback.
// Safe by design — never throws into the UI if audio/vibrate is blocked.

const SOUND_KEY = "owner-nav-sound";
const HAPTIC_KEY = "owner-nav-haptic";
const SOUND_SRC = "/sounds/nav-tap.mp3";

let baseAudio: HTMLAudioElement | null = null;

function getBaseAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (baseAudio) return baseAudio;
  try {
    baseAudio = new Audio(SOUND_SRC);
    baseAudio.preload = "auto";
    baseAudio.volume = 0.5;
  } catch {
    baseAudio = null;
  }
  return baseAudio;
}

function readBool(key: string, dflt = true): boolean {
  if (typeof window === "undefined") return dflt;
  try {
    const v = window.localStorage.getItem(key);
    if (v === null) return dflt;
    return v === "1";
  } catch {
    return dflt;
  }
}

function writeBool(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function isSoundEnabled(): boolean {
  return readBool(SOUND_KEY, true);
}
export function setSoundEnabled(v: boolean): void {
  writeBool(SOUND_KEY, v);
}
export function isHapticEnabled(): boolean {
  return readBool(HAPTIC_KEY, true);
}
export function setHapticEnabled(v: boolean): void {
  writeBool(HAPTIC_KEY, v);
}

export function playTapSound(): void {
  if (!isSoundEnabled()) return;
  const base = getBaseAudio();
  if (!base) return;
  try {
    // Clone so rapid taps don't cut each other off.
    const a = base.cloneNode(true) as HTMLAudioElement;
    a.volume = base.volume;
    const p = a.play();
    if (p && typeof (p as Promise<void>).catch === "function") {
      (p as Promise<void>).catch(() => {
        /* autoplay blocked / silent mode — not a bug */
      });
    }
  } catch {
    /* ignore */
  }
}

export function tapVibrate(ms = 15): void {
  if (!isHapticEnabled()) return;
  if (typeof navigator === "undefined") return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}
